import { auth } from "@clerk/nextjs/server";
import { err, errAsync, okAsync } from "neverthrow";
import { sql } from "./db";

export type TimeEntry = {
  id: number;
  user_id: string;
  org_id: string;
  clock_in: Date;
  clock_out: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type SerializableResult<T, E> =
  | { value: T; ok: true }
  | { error: E; ok: false };

export async function getAuthSession() {
  const { userId, orgId } = await auth();
  if (!userId || !orgId) {
    return errAsync({ reason: "Unauthorized or no organization selected" });
  }
  return okAsync({ userId, orgId });
}

export async function getTimeEntries(): Promise<
  SerializableResult<TimeEntry[], { reason: string }>
> {
  const { userId, orgId } = await auth.protect();
  if (!userId || !orgId) {
    return {
      error: { reason: "Unauthorized or no organization selected" },
      ok: false,
    };
  }
  try {
    const rows = await sql`
                SELECT * FROM time_entries 
                WHERE user_id = ${userId} AND org_id = ${orgId}
                ORDER BY clock_in DESC
            `;
    console.log("Hours: ", rows);
    return { value: rows as unknown as TimeEntry[], ok: true };
  } catch (error) {
    console.error("DB error: ", error);
    return { error: { reason: "Unknown DB error" }, ok: false };
  }
}

export async function clockIn() {
  const { userId, orgId } = await auth.protect();
  if (!userId || !orgId) {
    return errAsync({
      reason: "Unauthorized or no organization selected",
    } as const);
  }

  try {
    // Check if already clocked in
    const activeEntry = await sql`
                SELECT id FROM time_entries 
                WHERE user_id = ${userId} AND org_id = ${orgId} AND clock_out IS NULL
                LIMIT 1
            `;

    if (activeEntry.length > 0) {
      return errAsync({ reason: "Already clocked in" } as const);
    }

    const [newEntry] = await sql`
                INSERT INTO time_entries (user_id, org_id, clock_in)
                VALUES (${userId}, ${orgId}, NOW())
                RETURNING *
            `;

    return okAsync(newEntry as unknown as TimeEntry);
  } catch (error) {
    console.error("DB error: ", error);
    return errAsync({ reason: "Unknown DB error" } as const);
  }
}

export async function clockOut() {
  const { userId, orgId } = await auth.protect();
  if (!userId || !orgId) {
    return errAsync({
      reason: "Unauthorized or no organization selected",
    } as const);
  }
  try {
    const [activeEntry] = await sql`
                UPDATE time_entries
                SET clock_out = NOW(), updated_at = NOW()
                WHERE user_id = ${userId} AND org_id = ${orgId} AND clock_out IS NULL
                RETURNING *
            `;

    if (!activeEntry) {
      return errAsync({ reason: "No active clock-in found" } as const);
    }

    return okAsync(activeEntry as unknown as TimeEntry);
  } catch (error) {
    console.error("DB error: ", error);
    return errAsync({ reason: "Unknown DB error" } as const);
  }
}

export async function deleteTimeEntry(id: number) {
  const { userId, orgId } = await auth.protect();
  if (!userId || !orgId) {
    return errAsync({
      reason: "Unauthorized or no organization selected",
    } as const);
  }
  try {
    const [deleted] = await sql`
      DELETE FROM time_entries 
      WHERE id = ${id} AND user_id = ${userId} AND org_id = ${orgId}
      RETURNING *
    `;
    return deleted
      ? okAsync(deleted as unknown as TimeEntry)
      : errAsync({ reason: "Entry not found" } as const);
  } catch (error) {
    console.error("Delete error: ", error);
    return errAsync({ reason: "Failed to delete entry" } as const);
  }
}

export async function updateTimeEntry(
  id: number,
  clock_in: Date,
  clock_out: Date | null,
) {
  const { userId, orgId } = await auth.protect();
  if (!userId || !orgId) {
    return errAsync({
      reason: "Unauthorized or no organization selected",
    } as const);
  }
  try {
    const [updated] = await sql`
      UPDATE time_entries
      SET clock_in = ${clock_in},
          clock_out = ${clock_out},
          updated_at = NOW()
      WHERE id = ${id} AND user_id = ${userId} AND org_id = ${orgId}
      RETURNING *
    `;
    return updated
      ? okAsync(updated as unknown as TimeEntry)
      : errAsync({ reason: "Entry not found" } as const);
  } catch (error) {
    console.error("Update error: ", error);
    return err({ reason: "Failed to update entry" } as const);
  }
}
