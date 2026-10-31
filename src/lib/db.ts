import { neon } from "@neondatabase/serverless";
import { cacheLife, cacheTag } from "next/cache";
import type {
  BreakSettingsData,
  BreakType,
  ReportingSettingsData,
  TimeEntry,
  TimeEntryBreak,
} from "./types";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not defined");
}

export const sql = neon(process.env.DATABASE_URL);

export async function dbGetTimeEntries(
  userId: string,
  orgId: string,
  startDate?: Date,
  endDate?: Date,
) {
  "use cache";
  cacheTag(
    `time-entries-${userId}-${orgId}-${startDate}-${endDate}`,
    `time-entries-${userId}-${orgId}`,
  );
  cacheLife("hours");

  if (startDate && endDate) {
    const rows = await sql`
            SELECT * FROM time_entries 
            WHERE user_id = ${userId} AND org_id = ${orgId}
            AND clock_in >= ${startDate} AND clock_in < ${endDate}
            ORDER BY clock_in DESC
        `;
    return await attachBreaks(rows as unknown as TimeEntry[]);
  }

  const rows = await sql`
        SELECT * FROM time_entries 
        WHERE user_id = ${userId} AND org_id = ${orgId}
        ORDER BY clock_in DESC
    `;
  return await attachBreaks(rows as unknown as TimeEntry[]);
}

export async function dbGetOrgTimeEntries(
  orgId: string,
  startDate?: Date,
  endDate?: Date,
) {
  "use cache";
  const startStr = startDate?.toISOString() ?? "all";
  const endStr = endDate?.toISOString() ?? "all";
  cacheTag(
    `org-time-entries-${orgId}`,
    `org-time-entries-${orgId}-${startStr}-${endStr}`,
  );
  cacheLife("hours");

  if (startDate && endDate) {
    const rows = await sql`
            SELECT * FROM time_entries 
            WHERE org_id = ${orgId}
            AND clock_in >= ${startDate} AND clock_in < ${endDate}
            ORDER BY clock_in DESC
        `;
    return await attachBreaks(rows as unknown as TimeEntry[]);
  }

  const rows = await sql`
        SELECT * FROM time_entries 
        WHERE org_id = ${orgId}
        ORDER BY clock_in DESC
    `;
  return await attachBreaks(rows as unknown as TimeEntry[]);
}

export async function dbCheckActiveEntry(userId: string, orgId: string) {
  const activeEntry = await sql`
        SELECT id FROM time_entries 
        WHERE user_id = ${userId} AND org_id = ${orgId} AND clock_out IS NULL
        LIMIT 1
    `;
  return activeEntry;
}

export async function dbGetActiveEntry(userId: string, orgId: string) {
  const [activeEntry] = await sql`
        SELECT * FROM time_entries 
        WHERE user_id = ${userId} AND org_id = ${orgId} AND clock_out IS NULL
        LIMIT 1
    `;
  if (!activeEntry) return null;
  const [withBreaks] = await attachBreaks([
    activeEntry as unknown as TimeEntry,
  ]);
  return withBreaks as TimeEntry;
}

/**
 * Opens a new entry only if the user has no open entry in the org.
 * The advisory lock serialises concurrent clock-ins for the same user/org,
 * so two simultaneous requests cannot both insert. Returns undefined when
 * an open entry already exists.
 */
export async function dbClockIn(userId: string, orgId: string) {
  const [, inserted] = await sql.transaction([
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${userId}:${orgId}`}::text, 0))`,
    sql`
        INSERT INTO time_entries (user_id, org_id, clock_in)
        SELECT ${userId}, ${orgId}, NOW()
        WHERE NOT EXISTS (
            SELECT 1 FROM time_entries
            WHERE user_id = ${userId} AND org_id = ${orgId} AND clock_out IS NULL
        )
        RETURNING *
    `,
  ]);
  return inserted[0] as unknown as TimeEntry | undefined;
}

export async function dbClockOut(userId: string, orgId: string) {
  const [activeEntry] = await sql`
        UPDATE time_entries
        SET clock_out = NOW(), updated_at = NOW()
        WHERE user_id = ${userId} AND org_id = ${orgId} AND clock_out IS NULL
        RETURNING *
    `;
  return activeEntry as unknown as TimeEntry | undefined;
}

export async function dbDeleteTimeEntry(
  id: number,
  orgId: string,
  // isAdmin: boolean,
) {
  const [deleted] = await sql`
      DELETE FROM time_entries 
      WHERE id = ${id} AND org_id = ${orgId}     
      RETURNING *
    `;
  return deleted as unknown as TimeEntry | undefined;
}

export async function dbUpdateTimeEntry(
  id: number,
  clock_in: Date,
  clock_out: Date | null,
  orgId: string,
  isAdmin: boolean,
  skip_lunch?: boolean,
) {
  if (skip_lunch !== undefined) {
    const [updated] = await sql`
      UPDATE time_entries
      SET clock_in = ${clock_in},
          clock_out = ${clock_out},
          skip_lunch = ${skip_lunch},
          updated_at = NOW()
      WHERE id = ${id} AND org_id = ${orgId}
      AND ${isAdmin}
      RETURNING *
    `;
    return updated as unknown as TimeEntry | undefined;
  }

  const [updated] = await sql`
      UPDATE time_entries
      SET clock_in = ${clock_in},
          clock_out = ${clock_out},
          updated_at = NOW()
      WHERE id = ${id} AND org_id = ${orgId}
      AND ${isAdmin}
      RETURNING *
    `;
  return updated as unknown as TimeEntry | undefined;
}

export async function dbGetTimeEntriesForPeriod(
  userId: string,
  orgId: string,
  startDate: Date,
  endDate: Date,
) {
  const rows = await sql`
        SELECT * FROM time_entries 
        WHERE user_id = ${userId} AND org_id = ${orgId}
        AND clock_in >= ${startDate} AND clock_in < ${endDate}
        ORDER BY clock_in ASC
    `;
  return await attachBreaks(rows as unknown as TimeEntry[]);
}

export async function dbGetReportingSettings(orgId: string) {
  "use cache";
  cacheTag(`reporting-settings-${orgId}`);
  cacheLife("hours");
  const [settings] = await sql`
		SELECT * FROM reporting_settings WHERE org_id = ${orgId}
	`;
  return settings as ReportingSettingsData | undefined;
}

export async function dbUpdateReportingSettings(
  orgId: string,
  frequency: string,
  day: string | null,
  interval: number,
) {
  // Ensure main settings entry exists
  await sql`
		INSERT INTO settings (org_id, updated_at)
		VALUES (${orgId}, NOW())
		ON CONFLICT (org_id) DO UPDATE SET updated_at = NOW()
	`;

  const [updated] = await sql`
		INSERT INTO reporting_settings (org_id, report_frequency, report_day, report_interval, updated_at)
		VALUES (${orgId}, ${frequency}, ${day}, ${interval}, NOW())
		ON CONFLICT (org_id) 
		DO UPDATE SET 
            report_frequency = ${frequency}, 
            report_day = ${day}, 
            report_interval = ${interval}, 
            updated_at = NOW()
		RETURNING *
	`;
  return updated as ReportingSettingsData;
}

let breakSettingsTableReady: Promise<void> | null = null;

/**
 * Lunch-break settings are free for every admin. Production databases that
 * predate `break_settings` in schema.sql don't have the table, so create it
 * (and the `settings` parent it references) on first use. Runs once per
 * server instance; a failure is not cached, so the next call retries.
 */
export function ensureBreakSettingsTable(): Promise<void> {
  breakSettingsTableReady ??= (async () => {
    await sql`
		CREATE TABLE IF NOT EXISTS settings (
			org_id TEXT PRIMARY KEY,
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)
	`;
    await sql`
		CREATE TABLE IF NOT EXISTS break_settings (
			org_id TEXT PRIMARY KEY REFERENCES settings(org_id) ON DELETE CASCADE,
			dock_lunch BOOLEAN NOT NULL DEFAULT FALSE,
			lunch_duration_minutes INTEGER NOT NULL DEFAULT 30,
			lunch_min_shift_hours DOUBLE PRECISION NOT NULL DEFAULT 5,
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)
	`;
  })().catch((error) => {
    breakSettingsTableReady = null;
    throw error;
  });
  return breakSettingsTableReady;
}

/** Test-only: forget that the table check ran. */
export function resetBreakSettingsTableCheck() {
  breakSettingsTableReady = null;
}

export async function dbGetBreakSettings(orgId: string) {
  "use cache";
  cacheTag(`break-settings-${orgId}`);
  cacheLife("hours");
  await ensureBreakSettingsTable();
  const [settings] = await sql`
		SELECT * FROM break_settings WHERE org_id = ${orgId}
	`;
  return settings as BreakSettingsData | undefined;
}

export async function dbUpdateBreakSettings(
  orgId: string,
  dockLunch: boolean,
  durationMinutes: number,
  minShiftHours: number,
) {
  await ensureBreakSettingsTable();
  await sql`
		INSERT INTO settings (org_id, updated_at)
		VALUES (${orgId}, NOW())
		ON CONFLICT (org_id) DO UPDATE SET updated_at = NOW()
	`;

  const [updated] = await sql`
		INSERT INTO break_settings (org_id, dock_lunch, lunch_duration_minutes, lunch_min_shift_hours, updated_at)
		VALUES (${orgId}, ${dockLunch}, ${durationMinutes}, ${minShiftHours}, NOW())
		ON CONFLICT (org_id)
		DO UPDATE SET
            dock_lunch = ${dockLunch},
            lunch_duration_minutes = ${durationMinutes},
            lunch_min_shift_hours = ${minShiftHours},
            updated_at = NOW()
		RETURNING *
	`;
  return updated as BreakSettingsData;
}

/* ----------------------------------------------------------- breaks -- */

let timeEntryBreaksTableReady: Promise<void> | null = null;

/**
 * Break records live in their own table. Production databases that predate
 * `time_entry_breaks` in schema.sql don't have it, so create it on first use
 * (same approach as `ensureBreakSettingsTable`). Runs once per server
 * instance; a failure is not cached, so the next call retries.
 */
export function ensureTimeEntryBreaksTable(): Promise<void> {
  timeEntryBreaksTableReady ??= (async () => {
    await sql`
		CREATE TABLE IF NOT EXISTS time_entry_breaks (
			id SERIAL PRIMARY KEY,
			time_entry_id INTEGER NOT NULL REFERENCES time_entries(id) ON DELETE CASCADE,
			break_type TEXT NOT NULL DEFAULT 'unpaid_meal'
				CHECK (break_type IN ('unpaid_meal', 'unpaid_rest', 'paid_rest')),
			break_start TIMESTAMP WITH TIME ZONE NOT NULL,
			break_end TIMESTAMP WITH TIME ZONE,
			CHECK (break_end IS NULL OR break_end > break_start),
			created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
		)
	`;
    await sql`
		CREATE INDEX IF NOT EXISTS idx_time_entry_breaks_entry
			ON time_entry_breaks (time_entry_id, break_start)
	`;
    await sql`
		CREATE UNIQUE INDEX IF NOT EXISTS idx_time_entry_breaks_one_open
			ON time_entry_breaks (time_entry_id)
			WHERE break_end IS NULL
	`;
  })().catch((error) => {
    timeEntryBreaksTableReady = null;
    throw error;
  });
  return timeEntryBreaksTableReady;
}

/** Test-only: forget that the table check ran. */
export function resetTimeEntryBreaksTableCheck() {
  timeEntryBreaksTableReady = null;
}

export async function dbGetBreaksForEntries(entryIds: number[]) {
  if (entryIds.length === 0) return [] as TimeEntryBreak[];
  await ensureTimeEntryBreaksTable();
  const rows = await sql`
		SELECT * FROM time_entry_breaks
		WHERE time_entry_id = ANY(${entryIds})
		ORDER BY break_start ASC, id ASC
	`;
  return rows as unknown as TimeEntryBreak[];
}

/**
 * Loads the breaks of the given entries and hangs them off each one, so an
 * entry always arrives with its (possibly empty) compliance record.
 */
export async function attachBreaks<T extends TimeEntry>(
  entries: T[],
): Promise<T[]> {
  const breaks = await dbGetBreaksForEntries(entries.map((entry) => entry.id));
  const byEntry = new Map<number, TimeEntryBreak[]>();
  for (const brk of breaks) {
    const existing = byEntry.get(brk.time_entry_id);
    if (existing) existing.push(brk);
    else byEntry.set(brk.time_entry_id, [brk]);
  }
  return entries.map((entry) => ({
    ...entry,
    breaks: byEntry.get(entry.id) ?? [],
  }));
}

/**
 * Breaks for a set of entries, restricted to one organization and — unless
 * the caller is an admin — to the entries of one member.
 */
export async function dbGetBreaksForEntriesInOrg(
  entryIds: number[],
  orgId: string,
  userId: string,
  isAdmin: boolean,
) {
  if (entryIds.length === 0) return [] as TimeEntryBreak[];
  await ensureTimeEntryBreaksTable();
  const rows = await sql`
		SELECT b.* FROM time_entry_breaks b
		JOIN time_entries e ON e.id = b.time_entry_id
		WHERE b.time_entry_id = ANY(${entryIds})
		AND e.org_id = ${orgId}
		AND (${isAdmin} OR e.user_id = ${userId})
		ORDER BY b.break_start ASC, b.id ASC
	`;
  return rows as unknown as TimeEntryBreak[];
}

/** A break joined to the shift it belongs to, for validation and tagging. */
export type BreakWithEntry = TimeEntryBreak & {
  user_id: string;
  org_id: string;
  clock_in: Date;
  clock_out: Date | null;
};

export async function dbGetBreakWithEntry(id: number, orgId: string) {
  await ensureTimeEntryBreaksTable();
  const [row] = await sql`
		SELECT b.*, e.user_id, e.org_id, e.clock_in, e.clock_out
		FROM time_entry_breaks b
		JOIN time_entries e ON e.id = b.time_entry_id
		WHERE b.id = ${id} AND e.org_id = ${orgId}
	`;
  return row as unknown as BreakWithEntry | undefined;
}

export async function dbGetEntryBreaks(entryId: number) {
  await ensureTimeEntryBreaksTable();
  const rows = await sql`
		SELECT * FROM time_entry_breaks
		WHERE time_entry_id = ${entryId}
		ORDER BY break_start ASC, id ASC
	`;
  return rows as unknown as TimeEntryBreak[];
}

/**
 * Opens a break on the user's running shift, but only when that shift has no
 * break open already. The advisory lock serialises concurrent requests for
 * the same user/org the way `dbClockIn` does, so two taps cannot both insert.
 * Returns undefined when there is no open shift, or a break is already running.
 */
export async function dbStartBreak(
  userId: string,
  orgId: string,
  breakType: BreakType,
) {
  await ensureTimeEntryBreaksTable();
  const [, inserted] = await sql.transaction([
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${userId}:${orgId}:break`}::text, 0))`,
    sql`
		INSERT INTO time_entry_breaks (time_entry_id, break_type, break_start)
		SELECT e.id, ${breakType}, NOW()
		FROM time_entries e
		WHERE e.user_id = ${userId} AND e.org_id = ${orgId} AND e.clock_out IS NULL
		AND NOT EXISTS (
			SELECT 1 FROM time_entry_breaks b
			WHERE b.time_entry_id = e.id AND b.break_end IS NULL
		)
		ORDER BY e.clock_in DESC
		LIMIT 1
		RETURNING *
	`,
  ]);
  return inserted[0] as unknown as TimeEntryBreak | undefined;
}

/**
 * Closes the break running on the user's open shift. Returns undefined when
 * no break is open.
 */
export async function dbEndOpenBreak(userId: string, orgId: string) {
  await ensureTimeEntryBreaksTable();
  const [updated] = await sql`
		UPDATE time_entry_breaks
		SET break_end = NOW(), updated_at = NOW()
		WHERE break_end IS NULL
		AND time_entry_id IN (
			SELECT id FROM time_entries
			WHERE user_id = ${userId} AND org_id = ${orgId} AND clock_out IS NULL
		)
		RETURNING *
	`;
  return updated as unknown as TimeEntryBreak | undefined;
}

export async function dbUpdateBreak(
  id: number,
  orgId: string,
  breakStart: Date,
  breakEnd: Date | null,
  breakType: BreakType,
) {
  await ensureTimeEntryBreaksTable();
  const [updated] = await sql`
		UPDATE time_entry_breaks b
		SET break_start = ${breakStart},
			break_end = ${breakEnd},
			break_type = ${breakType},
			updated_at = NOW()
		WHERE b.id = ${id}
		AND EXISTS (
			SELECT 1 FROM time_entries e
			WHERE e.id = b.time_entry_id AND e.org_id = ${orgId}
		)
		RETURNING *
	`;
  return updated as unknown as TimeEntryBreak | undefined;
}

export async function dbDeleteBreak(id: number, orgId: string) {
  await ensureTimeEntryBreaksTable();
  const [deleted] = await sql`
		DELETE FROM time_entry_breaks b
		WHERE b.id = ${id}
		AND EXISTS (
			SELECT 1 FROM time_entries e
			WHERE e.id = b.time_entry_id AND e.org_id = ${orgId}
		)
		RETURNING *
	`;
  return deleted as unknown as TimeEntryBreak | undefined;
}
