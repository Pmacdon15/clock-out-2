import { neon } from "@neondatabase/serverless";
import { cacheLife, cacheTag } from "next/cache";
import type { StoredLocation } from "./geo";
import type {
  BreakSettingsData,
  LocationSettingsData,
  ReportingSettingsData,
  SiteData,
  TimeEntry,
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
    return rows as unknown as TimeEntry[];
  }

  const rows = await sql`
        SELECT * FROM time_entries 
        WHERE user_id = ${userId} AND org_id = ${orgId}
        ORDER BY clock_in DESC
    `;
  return rows as unknown as TimeEntry[];
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
    return rows as unknown as TimeEntry[];
  }

  const rows = await sql`
        SELECT * FROM time_entries 
        WHERE org_id = ${orgId}
        ORDER BY clock_in DESC
    `;
  return rows as unknown as TimeEntry[];
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
  return (activeEntry as unknown as TimeEntry) || null;
}

/**
 * Opens a new entry only if the user has no open entry in the org.
 * The advisory lock serialises concurrent clock-ins for the same user/org,
 * so two simultaneous requests cannot both insert. Returns undefined when
 * an open entry already exists.
 */
export async function dbClockIn(
  userId: string,
  orgId: string,
  location?: StoredLocation | null,
) {
  const [, inserted] = await sql.transaction([
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${userId}:${orgId}`}::text, 0))`,
    sql`
        INSERT INTO time_entries (
            user_id, org_id, clock_in,
            clock_in_latitude, clock_in_longitude, clock_in_accuracy_m, clock_in_site_name
        )
        SELECT ${userId}, ${orgId}, NOW(),
            ${location?.latitude ?? null}, ${location?.longitude ?? null},
            ${location?.accuracy ?? null}, ${location?.siteName ?? null}
        WHERE NOT EXISTS (
            SELECT 1 FROM time_entries
            WHERE user_id = ${userId} AND org_id = ${orgId} AND clock_out IS NULL
        )
        RETURNING *
    `,
  ]);
  return inserted[0] as unknown as TimeEntry | undefined;
}

export async function dbClockOut(
  userId: string,
  orgId: string,
  location?: StoredLocation | null,
) {
  const [activeEntry] = await sql`
        UPDATE time_entries
        SET clock_out = NOW(),
            updated_at = NOW(),
            clock_out_latitude = ${location?.latitude ?? null},
            clock_out_longitude = ${location?.longitude ?? null},
            clock_out_accuracy_m = ${location?.accuracy ?? null},
            clock_out_site_name = ${location?.siteName ?? null}
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
  return rows as unknown as TimeEntry[];
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

let locationTablesReady: Promise<void> | null = null;

/**
 * Location capture is opt-in per org. Production databases that predate
 * `location_settings` / `sites` in schema.sql don't have them (nor the
 * location columns on `time_entries`), so create them on first use, the same
 * way `ensureBreakSettingsTable` does. Runs once per server instance; a
 * failure is not cached, so the next call retries.
 */
export function ensureLocationTables(): Promise<void> {
  locationTablesReady ??= (async () => {
    await sql`
		CREATE TABLE IF NOT EXISTS settings (
			org_id TEXT PRIMARY KEY,
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)
	`;
    await sql`
		CREATE TABLE IF NOT EXISTS location_settings (
			org_id TEXT PRIMARY KEY REFERENCES settings(org_id) ON DELETE CASCADE,
			capture_mode TEXT NOT NULL DEFAULT 'off',
			restrict_clock_in BOOLEAN NOT NULL DEFAULT FALSE,
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)
	`;
    await sql`
		CREATE TABLE IF NOT EXISTS sites (
			id SERIAL PRIMARY KEY,
			org_id TEXT NOT NULL REFERENCES settings(org_id) ON DELETE CASCADE,
			name TEXT NOT NULL,
			latitude DOUBLE PRECISION NOT NULL,
			longitude DOUBLE PRECISION NOT NULL,
			radius_meters DOUBLE PRECISION NOT NULL DEFAULT 150,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)
	`;
    await sql`
		ALTER TABLE time_entries
			ADD COLUMN IF NOT EXISTS clock_in_latitude DOUBLE PRECISION,
			ADD COLUMN IF NOT EXISTS clock_in_longitude DOUBLE PRECISION,
			ADD COLUMN IF NOT EXISTS clock_in_accuracy_m DOUBLE PRECISION,
			ADD COLUMN IF NOT EXISTS clock_in_site_name TEXT,
			ADD COLUMN IF NOT EXISTS clock_out_latitude DOUBLE PRECISION,
			ADD COLUMN IF NOT EXISTS clock_out_longitude DOUBLE PRECISION,
			ADD COLUMN IF NOT EXISTS clock_out_accuracy_m DOUBLE PRECISION,
			ADD COLUMN IF NOT EXISTS clock_out_site_name TEXT
	`;
  })().catch((error) => {
    locationTablesReady = null;
    throw error;
  });
  return locationTablesReady;
}

/** Test-only: forget that the table check ran. */
export function resetLocationTablesCheck() {
  locationTablesReady = null;
}

export async function dbGetLocationSettings(orgId: string) {
  "use cache";
  cacheTag(`location-settings-${orgId}`);
  cacheLife("hours");
  await ensureLocationTables();
  const [settings] = await sql`
		SELECT * FROM location_settings WHERE org_id = ${orgId}
	`;
  return settings as LocationSettingsData | undefined;
}

export async function dbUpdateLocationSettings(
  orgId: string,
  captureMode: string,
  restrictClockIn: boolean,
) {
  await ensureLocationTables();
  await sql`
		INSERT INTO settings (org_id, updated_at)
		VALUES (${orgId}, NOW())
		ON CONFLICT (org_id) DO UPDATE SET updated_at = NOW()
	`;

  const [updated] = await sql`
		INSERT INTO location_settings (org_id, capture_mode, restrict_clock_in, updated_at)
		VALUES (${orgId}, ${captureMode}, ${restrictClockIn}, NOW())
		ON CONFLICT (org_id)
		DO UPDATE SET
            capture_mode = ${captureMode},
            restrict_clock_in = ${restrictClockIn},
            updated_at = NOW()
		RETURNING *
	`;
  return updated as LocationSettingsData;
}

export async function dbGetSites(orgId: string) {
  "use cache";
  cacheTag(`sites-${orgId}`);
  cacheLife("hours");
  await ensureLocationTables();
  const rows = await sql`
		SELECT * FROM sites WHERE org_id = ${orgId} ORDER BY name ASC, id ASC
	`;
  return rows as unknown as SiteData[];
}

/**
 * Sites are read on every clock-in, where a cached read would let a member
 * clock in against a site an admin has just removed. This uncached read is the
 * one the enforcement path uses.
 */
export async function dbGetSitesForEnforcement(orgId: string) {
  await ensureLocationTables();
  const rows = await sql`
		SELECT * FROM sites WHERE org_id = ${orgId}
	`;
  return rows as unknown as SiteData[];
}

export async function dbCreateSite(
  orgId: string,
  name: string,
  latitude: number,
  longitude: number,
  radiusMeters: number,
) {
  await ensureLocationTables();
  await sql`
		INSERT INTO settings (org_id, updated_at)
		VALUES (${orgId}, NOW())
		ON CONFLICT (org_id) DO UPDATE SET updated_at = NOW()
	`;

  const [created] = await sql`
		INSERT INTO sites (org_id, name, latitude, longitude, radius_meters)
		VALUES (${orgId}, ${name}, ${latitude}, ${longitude}, ${radiusMeters})
		RETURNING *
	`;
  return created as unknown as SiteData;
}

export async function dbUpdateSite(
  id: number,
  orgId: string,
  name: string,
  latitude: number,
  longitude: number,
  radiusMeters: number,
) {
  await ensureLocationTables();
  const [updated] = await sql`
		UPDATE sites
		SET name = ${name},
			latitude = ${latitude},
			longitude = ${longitude},
			radius_meters = ${radiusMeters},
			updated_at = NOW()
		WHERE id = ${id} AND org_id = ${orgId}
		RETURNING *
	`;
  return updated as unknown as SiteData | undefined;
}

export async function dbDeleteSite(id: number, orgId: string) {
  await ensureLocationTables();
  const [deleted] = await sql`
		DELETE FROM sites WHERE id = ${id} AND org_id = ${orgId}
		RETURNING *
	`;
  return deleted as unknown as SiteData | undefined;
}
