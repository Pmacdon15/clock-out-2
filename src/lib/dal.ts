import { auth, clerkClient } from "@clerk/nextjs/server";
import { errAsync, okAsync } from "neverthrow";
import {
  dbCheckActiveEntry,
  dbClockIn,
  dbClockOut,
  dbDeleteTimeEntry,
  dbGetOrgTimeEntries,
  dbGetReportingSettings,
  dbGetTimeEntries,
  dbUpdateReportingSettings,
  dbUpdateTimeEntry,
  sql,
} from "./db";
import type {
  ReportingSettingsData,
  SerializableResult,
  TimeEntry,
} from "./types";
import { getProcessedMembers, isOverMemberShipLimit } from "./utils-clerk";

export type { SerializableResult, TimeEntry };

export async function getOrgMembers() {
  const { orgId, orgRole } = await auth.protect();

  if (!orgId || orgRole !== "org:admin") {
    return [];
  }

  return clerkClient()
    .then((client) =>
      client.organizations.getOrganizationMembershipList({
        organizationId: orgId,
      }),
    )
    .then((response) => getProcessedMembers(orgId, response.data))
    .catch((error) => {
      console.error("Error fetching members:", error);
      return [];
    });
}
export async function getTimeEntries(
  targetUserId?: string,
  filters?: { start?: string; end?: string },
): Promise<SerializableResult<TimeEntry[], { reason: string }>> {
  const { userId, orgId, orgRole } = await auth.protect();

  if (!userId || !orgId) {
    return {
      ok: false,
      error: { reason: "Unauthorized or no organization selected" },
    };
  }

  const queryUserId = targetUserId || userId;
  const isAdmin = orgRole === "org:admin";

  if (queryUserId !== userId && !isAdmin) {
    return {
      ok: false,
      error: {
        reason: "Forbidden: You do not have permission to view these entries",
      },
    };
  }

  const startDate = filters?.start ? new Date(filters.start) : undefined;
  const endDate = filters?.end ? new Date(filters.end) : undefined;

  return await dbGetTimeEntries(queryUserId, orgId, startDate, endDate)
    .then((data) => {
      return { ok: true as const, value: data };
    })
    .catch((e) => {
      console.error("Error fetching entries: ", e);
      return { ok: false, error: { reason: "Unknown DB error" } };
    });
}

export async function getOrgTimeEntries(filters?: {
  start?: string;
  end?: string;
}): Promise<SerializableResult<TimeEntry[], { reason: string }>> {
  const { userId, orgId, orgRole } = await auth.protect();
  const isAdmin = orgRole === "org:admin";

  if (!userId || !orgId || !isAdmin) {
    return {
      error: {
        reason: "Unauthorized: You must be an admin to view organization stats",
      },
      ok: false,
    };
  }

  const startDate = filters?.start ? new Date(filters.start) : undefined;
  const endDate = filters?.end ? new Date(filters.end) : undefined;

  try {
    const rows = await dbGetOrgTimeEntries(orgId, startDate, endDate);
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
  const isAdmin = orgRole === "org:admin";
  if (!userId || !orgId || !isAdmin) {
    return errAsync({ reason: "Unauthorized" } as const);
  }

  try {
    const deleted = await dbDeleteTimeEntry(id, orgId);

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

export async function getActiveEntry(): Promise<
  SerializableResult<TimeEntry | null, { reason: string }>
> {
  const { userId, orgId } = await auth.protect();
  if (!userId || !orgId) {
    return {
      error: { reason: "Unauthorized or no organization selected" },
      ok: false,
    };
  }

  try {
    const [activeEntry] = await sql`
            SELECT * FROM time_entries 
            WHERE user_id = ${userId} AND org_id = ${orgId} AND clock_out IS NULL
            LIMIT 1
        `;
    return {
      value: (activeEntry as unknown as TimeEntry) || null,
      ok: true,
    };
  } catch (error) {
    console.error("DB error: ", error);
    return { error: { reason: "Unknown DB error" }, ok: false };
  }
}

export async function updateReportingSettingsDal(
  frequency: string,
  day: string | null = null,
  interval: number = 1,
) {
  const { userId, orgId, orgRole, has } = await auth.protect();
  const isAdmin = orgRole === "org:admin";
  const hasReporting = has({ feature: "reporting" });

  if (!userId || !orgId || !isAdmin || !hasReporting) {
    return errAsync({ reason: "Unauthorized" } as const);
  }

  // const isPaidPlan = !has({ plan: 'free' })

  // if (!isPaidPlan) {
  // 	return errAsync({
  // 		reason: 'Reports settings are only available on paid plans',
  // 	} as const)
  // }

  try {
    const updated = await dbUpdateReportingSettings(
      orgId,
      frequency,
      day,
      interval,
    );
    return okAsync(updated);
  } catch (error) {
    console.error("Update settings error: ", error);
    return errAsync({ reason: "Failed to update settings" } as const);
  }
}

export async function getOrgReportingSettings(): Promise<
  SerializableResult<ReportingSettingsData | null, { reason: string }>
> {
  const { userId, orgId } = await auth.protect();
  if (!userId || !orgId) {
    return {
      error: { reason: "Unauthorized or no organization selected" },
      ok: false,
    };
  }

  try {
    const settings = await dbGetReportingSettings(orgId);
    return {
      value: (settings as unknown as ReportingSettingsData) || null,
      ok: true,
    };
  } catch (error) {
    console.error("DB error: ", error);
    return { error: { reason: "Unknown DB error" }, ok: false };
  }
}
