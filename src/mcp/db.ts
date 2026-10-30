import { neon } from "@neondatabase/serverless";
import { revalidateTag } from "next/cache";
import {
  dbClockIn,
  dbClockOut,
  dbDeleteTimeEntry,
  dbGetActiveEntry,
  dbGetBreakSettings,
  dbGetOrgTimeEntries,
  dbGetReportingSettings,
  dbGetTimeEntries,
  dbUpdateReportingSettings,
  dbUpdateTimeEntry,
} from "@/lib/db";
import type { TimeEntry } from "@/lib/types";

export {
  dbClockIn,
  dbClockOut,
  dbDeleteTimeEntry,
  dbGetActiveEntry,
  dbGetBreakSettings,
  dbGetOrgTimeEntries,
  dbGetReportingSettings,
  dbGetTimeEntries,
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
  return rows as unknown as TimeEntry[];
}

export async function dbGetTimeEntryById(id: number, orgId: string) {
  const sql = getSql();
  const [row] = await sql`
    SELECT * FROM time_entries
    WHERE id = ${id} AND org_id = ${orgId}
    LIMIT 1
  `;
  return (row as unknown as TimeEntry) || null;
}

export async function dbInsertTimeEntry(
  userId: string,
  orgId: string,
  clockIn: Date,
  clockOut: Date | null,
) {
  const sql = getSql();
  const [inserted] = await sql`
    INSERT INTO time_entries (user_id, org_id, clock_in, clock_out)
    VALUES (${userId}, ${orgId}, ${clockIn}, ${clockOut})
    RETURNING *
  `;
  return inserted as unknown as TimeEntry;
}

export async function dbClockInAt(
  userId: string,
  orgId: string,
  clockIn?: Date,
) {
  if (clockIn) {
    const sql = getSql();
    const [newEntry] = await sql`
      INSERT INTO time_entries (user_id, org_id, clock_in)
      VALUES (${userId}, ${orgId}, ${clockIn})
      RETURNING *
    `;
    return newEntry as unknown as TimeEntry;
  }
  return dbClockIn(userId, orgId);
}

export async function dbClockOutAt(
  userId: string,
  orgId: string,
  clockOut?: Date,
) {
  if (clockOut) {
    const sql = getSql();
    const [activeEntry] = await sql`
      UPDATE time_entries
      SET clock_out = ${clockOut}, updated_at = NOW()
      WHERE user_id = ${userId} AND org_id = ${orgId} AND clock_out IS NULL
      RETURNING *
    `;
    return activeEntry as unknown as TimeEntry | undefined;
  }
  return dbClockOut(userId, orgId);
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
