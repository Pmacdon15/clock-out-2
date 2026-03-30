import { auth, clerkClient } from "@clerk/nextjs/server";
import { errAsync, okAsync } from "neverthrow";
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
  const { userId, orgId, orgRole } = await auth();
  if (!userId || !orgId) {
    return errAsync({ reason: "Unauthorized or no organization selected" });
  }
  return okAsync({ userId, orgId, isAdmin: orgRole === "org:admin" });
}

export async function getOrgMembers() {
  const { orgId, orgRole } = await auth();
  if (!orgId || orgRole !== "org:admin") {
    return [];
  }

  try {
    const client = await clerkClient();
    const members = await client.organizations.getOrganizationMembershipList({
      organizationId: orgId,
    });

    return members.data.map((m) => ({
      id: m.publicUserData?.userId || "",
      name: m.publicUserData?.firstName 
        ? `${m.publicUserData.firstName} ${m.publicUserData.lastName || ""}`.trim()
        : m.publicUserData?.identifier || "Unknown Member",
    }));
  } catch (error) {
    console.error("Error fetching members:", error);
    return [];
  }
}

export async function getTimeEntries(targetUserId?: string): Promise<
  SerializableResult<TimeEntry[], { reason: string }>
> {
  const { userId, orgId, orgRole } = await auth();
  if (!userId || !orgId) {
    return {
      error: { reason: "Unauthorized or no organization selected" },
      ok: false,
    };
  }

  const queryUserId = targetUserId || userId;
  const isAdmin = orgRole === "org:admin";

  if (queryUserId !== userId && !isAdmin) {
    return {
      error: { reason: "Forbidden: You do not have permission to view these entries" },
      ok: false,
    };
  }

  try {
    const rows = await sql`
                SELECT * FROM time_entries 
                WHERE user_id = ${queryUserId} AND org_id = ${orgId}
                ORDER BY clock_in DESC
            `;
    return { value: rows as unknown as TimeEntry[], ok: true };
  } catch (error) {
    console.error("DB error: ", error);
    return { error: { reason: "Unknown DB error" }, ok: false };
  }
}

export async function clockIn() {
  const { userId, orgId } = await auth();
  if (!userId || !orgId) {
    return errAsync({
      reason: "Unauthorized or no organization selected",
    } as const);
  }

  try {
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
  const { userId, orgId } = await auth();
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
  const { userId, orgId, orgRole } = await auth();
  if (!userId || !orgId) {
    return errAsync({ reason: "Unauthorized" } as const);
  }
  const isAdmin = orgRole === "org:admin";

  try {
    const [deleted] = await sql`
      DELETE FROM time_entries 
      WHERE id = ${id} AND org_id = ${orgId}
      AND ${isAdmin}
      RETURNING *
    `;
    
    return deleted
      ? okAsync(deleted as unknown as TimeEntry)
      : errAsync({ reason: "Entry not found or unauthorized" } as const);
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
  const { userId, orgId, orgRole } = await auth();
  if (!userId || !orgId) {
    return errAsync({ reason: "Unauthorized" } as const);
  }
  const isAdmin = orgRole === "org:admin";

  try {
    const [updated] = await sql`
      UPDATE time_entries
      SET clock_in = ${clock_in},
          clock_out = ${clock_out},
          updated_at = NOW()
      WHERE id = ${id} AND org_id = ${orgId}
      AND ${isAdmin}
      RETURNING *
    `;
    return updated
      ? okAsync(updated as unknown as TimeEntry)
      : errAsync({ reason: "Entry not found or unauthorized" } as const);
  } catch (error) {
    console.error("Update error: ", error);
    return errAsync({ reason: "Failed to update entry" } as const);
  }
}
