import { neon } from "@neondatabase/serverless";
import { revalidateTag } from "next/cache";
import {
  attachBreaks,
  dbClockIn,
  dbClockOut,
  dbDeleteBreak,
  dbDeleteTimeEntry,
  dbEndOpenBreak,
  dbGetActiveEntry,
  dbGetBreakSettings,
  dbGetBreakWithEntry,
  dbGetEntryBreaks,
  dbGetOrgTimeEntries,
  dbGetReportingSettings,
  dbGetSites,
  dbGetTimeEntries,
  dbStartBreak,
  dbUpdateBreak,
  dbUpdateBreakSettings,
  dbUpdateReportingSettings,
  dbUpdateTimeEntry,
  ensureTimeEntryBreaksTable,
} from "@/lib/db";
import type { StoredLocation } from "@/lib/geo";
import type { BreakType, TimeEntry, TimeEntryBreak } from "@/lib/types";

export {
  attachBreaks,
  dbClockIn,
  dbClockOut,
  dbDeleteBreak,
  dbDeleteTimeEntry,
  dbEndOpenBreak,
  dbGetActiveEntry,
  dbGetBreakSettings,
  dbGetBreakWithEntry,
  dbGetEntryBreaks,
  dbGetOrgTimeEntries,
  dbGetReportingSettings,
  dbGetSites,
  dbGetTimeEntries,
  dbStartBreak,
  dbUpdateBreak,
  dbUpdateBreakSettings,
  dbUpdateReportingSettings,
  dbUpdateTimeEntry,
};

function getSql() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not defined");
  }
  return neon(process.env.DATABASE_URL);
}

export async function dbGetOrgActiveEntries(orgId: string) {
  const sql = getSql();
  const rows = await sql`
    SELECT * FROM time_entries
    WHERE org_id = ${orgId} AND clock_out IS NULL
    ORDER BY clock_in ASC
  `;
  return await attachBreaks(rows as unknown as TimeEntry[]);
}

export async function dbGetTimeEntryById(id: number, orgId: string) {
  const sql = getSql();
  const [row] = await sql`
    SELECT * FROM time_entries
    WHERE id = ${id} AND org_id = ${orgId}
    LIMIT 1
  `;
  if (!row) return null;
  const [withBreaks] = await attachBreaks([row as unknown as TimeEntry]);
  return (withBreaks as TimeEntry) || null;
}

export async function dbInsertBreak(
  timeEntryId: number,
  orgId: string,
  breakStart: Date,
  breakEnd: Date | null,
  breakType: BreakType,
) {
  await ensureTimeEntryBreaksTable();
  const sql = getSql();
  const [inserted] = await sql`
    INSERT INTO time_entry_breaks (time_entry_id, break_type, break_start, break_end)
    SELECT e.id, ${breakType}, ${breakStart}, ${breakEnd}
    FROM time_entries e
    WHERE e.id = ${timeEntryId} AND e.org_id = ${orgId}
    RETURNING *
  `;
  return inserted as unknown as TimeEntryBreak | undefined;
}

export async function dbInsertTimeEntry(
  userId: string,
  orgId: string,
  clockIn: Date,
  clockOut: Date | null,
  location?: StoredLocation | null,
) {
  const sql = getSql();
  const [inserted] = await sql`
    INSERT INTO time_entries (
      user_id, org_id, clock_in, clock_out,
      clock_in_latitude, clock_in_longitude, clock_in_accuracy_m, clock_in_site_name,
      clock_in_address
    )
    VALUES (
      ${userId}, ${orgId}, ${clockIn}, ${clockOut},
      ${location?.latitude ?? null}, ${location?.longitude ?? null},
      ${location?.accuracy ?? null}, ${location?.siteName ?? null},
      ${location?.address ?? null}
    )
    RETURNING *
  `;
  return inserted as unknown as TimeEntry;
}

export async function dbClockInAt(
  userId: string,
  orgId: string,
  clockIn?: Date,
  location?: StoredLocation | null,
) {
  if (clockIn) {
    const sql = getSql();
    const [newEntry] = await sql`
      INSERT INTO time_entries (
        user_id, org_id, clock_in,
        clock_in_latitude, clock_in_longitude, clock_in_accuracy_m, clock_in_site_name,
        clock_in_address
      )
      VALUES (
        ${userId}, ${orgId}, ${clockIn},
        ${location?.latitude ?? null}, ${location?.longitude ?? null},
        ${location?.accuracy ?? null}, ${location?.siteName ?? null},
        ${location?.address ?? null}
      )
      RETURNING *
    `;
    return newEntry as unknown as TimeEntry;
  }
  return dbClockIn(userId, orgId, location);
}

export async function dbClockOutAt(
  userId: string,
  orgId: string,
  clockOut?: Date,
  location?: StoredLocation | null,
) {
  if (clockOut) {
    const sql = getSql();
    const [activeEntry] = await sql`
      UPDATE time_entries
      SET
        clock_out = ${clockOut},
        clock_out_latitude = ${location?.latitude ?? null},
        clock_out_longitude = ${location?.longitude ?? null},
        clock_out_accuracy_m = ${location?.accuracy ?? null},
        clock_out_site_name = ${location?.siteName ?? null},
        clock_out_address = ${location?.address ?? null},
        updated_at = NOW()
      WHERE user_id = ${userId} AND org_id = ${orgId} AND clock_out IS NULL
      RETURNING *
    `;
    return activeEntry as unknown as TimeEntry | undefined;
  }
  return dbClockOut(userId, orgId, location);
}

export async function dbFindOverlappingTimeEntries(
  userId: string,
  orgId: string,
  clockIn: Date,
  clockOut: Date | null,
  excludeEntryId?: number,
) {
  const sql = getSql();
  const effectiveEnd = clockOut ?? new Date();
  if (excludeEntryId !== undefined) {
    const rows = await sql`
      SELECT * FROM time_entries
      WHERE user_id = ${userId}
        AND org_id = ${orgId}
        AND id != ${excludeEntryId}
        AND clock_in < ${effectiveEnd}
        AND COALESCE(clock_out, NOW()) > ${clockIn}
      ORDER BY clock_in ASC
    `;
    return rows as unknown as TimeEntry[];
  }
  const rows = await sql`
    SELECT * FROM time_entries
    WHERE user_id = ${userId}
      AND org_id = ${orgId}
      AND clock_in < ${effectiveEnd}
      AND COALESCE(clock_out, NOW()) > ${clockIn}
    ORDER BY clock_in ASC
  `;
  return rows as unknown as TimeEntry[];
}

export function invalidateTimeEntryCache(userId: string, orgId: string) {
  try {
    revalidateTag(`time-entries-${userId}-${orgId}`, { expire: 0 });
    revalidateTag(`org-time-entries-${orgId}`, { expire: 0 });
  } catch (error) {
    console.warn("Cache invalidation warning:", error);
  }
}

export function invalidateReportingSettingsCache(orgId: string) {
  try {
    revalidateTag(`reporting-settings-${orgId}`, { expire: 0 });
  } catch (error) {
    console.warn("Cache invalidation warning:", error);
  }
}

export function invalidateBreakSettingsCache(orgId: string) {
  try {
    revalidateTag(`break-settings-${orgId}`, { expire: 0 });
  } catch (error) {
    console.warn("Cache invalidation warning:", error);
  }
}
