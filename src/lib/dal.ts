import { auth, clerkClient } from "@clerk/nextjs/server";
import { errAsync, okAsync } from "neverthrow";
import {
  dbCheckActiveEntry,
  dbClockIn,
  dbClockOut,
  dbDeleteTimeEntry,
  dbGetTimeEntries,
  dbUpdateTimeEntry,
} from "./db";
import type { SerializableResult, TimeEntry } from "./types";
import { getProcessedMembers, isOverMemberShipLimit } from "./utils-clerk";

export type { TimeEntry, SerializableResult };

export async function getAuthSession(): Promise<
  SerializableResult<
    { userId: string; orgId: string; isAdmin: boolean },
    { reason: string }
  >
> {
  const { userId, orgId, orgRole } = await auth.protect();
  if (!userId || !orgId) {
    return {
      error: { reason: "Unauthorized or no organization selected" },
      ok: false,
    };
  }
  return {
    value: { userId, orgId, isAdmin: orgRole === "org:admin" },
    ok: true,
  };
}

export async function getOrgMembers() {
  const { orgId, orgRole } = await auth();

  if (!orgId || orgRole !== "org:admin") {
    return [];
  }

  const client = await clerkClient();
  const response = await client.organizations.getOrganizationMembershipList({
    organizationId: orgId,
  });

  const plainMembers = JSON.parse(JSON.stringify(response.data));

  return await getProcessedMembers(orgId, plainMembers);
}
export async function getTimeEntries(
  targetUserId?: string,
): Promise<SerializableResult<TimeEntry[], { reason: string }>> {
  const { userId, orgId, orgRole } = await auth.protect();
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
      error: {
        reason: "Forbidden: You do not have permission to view these entries",
      },
      ok: false,
    };
  }

  try {
    const rows = await dbGetTimeEntries(queryUserId, orgId);
    return { value: rows, ok: true };
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

  const isOverMemberShipLimitValue = await isOverMemberShipLimit(orgId);
  if (isOverMemberShipLimitValue)
    return errAsync({
      reason: "Over organization membership limit.",
    } as const);

  try {
    const activeEntry = await dbCheckActiveEntry(userId, orgId);

    if (activeEntry.length > 0) {
      return errAsync({ reason: "Already clocked in" } as const);
    }

    const newEntry = await dbClockIn(userId, orgId);

    return okAsync(newEntry);
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
    const activeEntry = await dbClockOut(userId, orgId);

    if (!activeEntry) {
      return errAsync({ reason: "No active clock-in found" } as const);
    }

    return okAsync(activeEntry);
  } catch (error) {
    console.error("DB error: ", error);
    return errAsync({ reason: "Unknown DB error" } as const);
  }
}

export async function deleteTimeEntry(id: number) {
  const { userId, orgId, orgRole } = await auth.protect();
  if (!userId || !orgId) {
    return errAsync({ reason: "Unauthorized" } as const);
  }
  const isAdmin = orgRole === "org:admin";

  try {
    const deleted = await dbDeleteTimeEntry(id, orgId, isAdmin);

    return deleted
      ? okAsync(deleted)
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
  const { userId, orgId, orgRole } = await auth.protect();
  if (!userId || !orgId) {
    return errAsync({ reason: "Unauthorized" } as const);
  }
  const isAdmin = orgRole === "org:admin";

  try {
    const updated = await dbUpdateTimeEntry(
      id,
      clock_in,
      clock_out,
      orgId,
      isAdmin,
    );

    return updated
      ? okAsync(updated)
      : errAsync({ reason: "Entry not found or unauthorized" } as const);
  } catch (error) {
    console.error("Update error: ", error);
    return errAsync({ reason: "Failed to update entry" } as const);
  }
}
