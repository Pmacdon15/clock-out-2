import { auth, clerkClient } from "@clerk/nextjs/server";
import { fromZonedTime } from "date-fns-tz";
import { errAsync, okAsync } from "neverthrow";
import {
  dbCheckActiveEntry,
  dbClockIn,
  dbClockOut,
  dbDeleteTimeEntry,
  dbGetActiveEntry,
  dbGetOrgTimeEntries,
  dbGetReportingSettings,
  dbGetTimeEntries,
  dbUpdateReportingSettings,
  dbUpdateTimeEntry,
} from "./db";
import type {
  ReportingSettingsData,
  SerializableResult,
  TimeEntry,
} from "./types";
import { getProcessedMembers, isOverMemberShipLimit } from "./utils-clerk";

export type { SerializableResult, TimeEntry };

function parseFilterDate(
  dateStr: string | undefined,
  tz: string,
  isEnd: boolean = false,
) {
  if (!dateStr) return undefined;
  // If the date is just YYYY-MM-DD, and it's the end date, make it the end of that day.
  if (isEnd && dateStr.length === 10) {
    return fromZonedTime(`${dateStr}T23:59:59.999`, tz);
  }
  return fromZonedTime(dateStr, tz);
}

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
  filters?: { start?: string; end?: string; timezone?: string },
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

  const tz = filters?.timezone || "UTC";
  const startDate = parseFilterDate(filters?.start, tz, false);
  const endDate = parseFilterDate(filters?.end, tz, true);

  return await dbGetTimeEntries(queryUserId, orgId, startDate, endDate)
    .then((data) => {
      return { ok: true as const, value: data };
    })
    .catch((e) => {
      console.error("Error user fetching entries: ", e);
      return {
        ok: false,
        error: { reason: "Error user fetching entries" },
      };
    });
}

export async function getOrgTimeEntries(filters?: {
  start?: string;
  end?: string;
  timezone?: string;
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

  const tz = filters?.timezone || "UTC";
  const startDate = parseFilterDate(filters?.start, tz, false);
  const endDate = parseFilterDate(filters?.end, tz, true);

  return await dbGetOrgTimeEntries(orgId, startDate, endDate)
    .then((data) => {
      return { value: data, ok: true as const };
    })
    .catch((e) => {
      console.error("Error fetching org entries: ", e);
      return {
        error: { reason: "Error fetching org entries" },
        ok: false,
      };
    });
}

export async function clockIn() {
  const { userId, orgId } = await auth.protect();
  if (!userId || !orgId) {
    return errAsync({
      reason: "Unauthorized or no organization selected",
    } as const);
  }

  const [membershipLimitResult, activeEntry] = await Promise.all([
    isOverMemberShipLimit(orgId)
      .then((membershipLimit) => {
        if (membershipLimit) {
          return Promise.resolve(
            errAsync({
              reason: "Over organization membership limit.",
            } as const),
          );
        }
      })
      .catch((e) => {
        console.error("Unable to verify organization membership limit: ", e);
        return Promise.resolve(
          errAsync({
            reason: "Unable to verify organization membership limit.",
          } as const),
        );
      }),
    //////////////
    dbCheckActiveEntry(userId, orgId).catch((e) => {
      console.error("Error checking active clock-in entry: ", e);
      return errAsync({
        reason: "Error checking active clock-in entry",
      } as const);
    }),
  ]);

  if (membershipLimitResult) {
    return membershipLimitResult;
  }

  if (!Array.isArray(activeEntry)) {
    return activeEntry;
  }

  if (activeEntry.length > 0) {
    return errAsync({ reason: "Already clocked in" } as const);
  }

  return await dbClockIn(userId, orgId)
    .then((activeEntry) => {
      return okAsync(activeEntry);
    })
    .catch((e) => {
      console.error("Error clocking in: ", e);
      return errAsync({ reason: "Error clocking in." } as const);
    });
}

export async function clockOut() {
  const { userId, orgId } = await auth.protect();
  if (!userId || !orgId) {
    return errAsync({
      reason: "Unauthorized or no organization selected",
    } as const);
  }

  return await dbClockOut(userId, orgId)
    .then((clockedOutEntry) => {
      return okAsync(clockedOutEntry);
    })
    .catch((e) => {
      console.error("Error clocking out entry: ", e);
      return errAsync({
        reason: "Error clocking out.",
      } as const);
    });
}

export async function deleteTimeEntry(id: number) {
  const { userId, orgId, orgRole } = await auth.protect();
  const isAdmin = orgRole === "org:admin";
  if (!userId || !orgId || !isAdmin) {
    return errAsync({ reason: "Unauthorized" } as const);
  }

  return await dbDeleteTimeEntry(id, orgId)
    .then((deleted) => {
      return okAsync(deleted);
    })
    .catch((e) => {
      console.error("Delete error: ", e);
      return errAsync({ reason: "Failed to delete entry" } as const);
    });
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

  return await dbUpdateTimeEntry(
    id,
    clock_in,
    clock_out,
    orgId,
    orgRole === "org:admin",
  )
    .then((updated) => {
      return okAsync(updated);
    })
    .catch((e) => {
      console.error("Update error: ", e);
      return errAsync({ reason: "Failed to update entry" } as const);
    });
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

  return await dbGetActiveEntry(userId, orgId)
    .then((activeEntry) => {
      return {
        value: activeEntry || null,
        ok: true as const,
      };
    })
    .catch((error) => {
      console.error("Error fetching active entries: ", error);
      return {
        error: { reason: "Error fetching active entries" },
        ok: false,
      };
    });
}

export async function updateReportingSettingsDal(
  frequency: string,
  day: string | null = null,
  interval: number = 1,
) {
  const authUser = await auth.protect();
  if (
    !authUser.userId ||
    !authUser.orgId ||
    authUser.orgRole !== "org:admin" ||
    !authUser.has({ feature: "reporting" })
  ) {
    return errAsync({ reason: "Unauthorized" } as const);
  }
  return await dbUpdateReportingSettings(
    authUser.orgId,
    frequency,
    day,
    interval,
  )
    .then((updated) => {
      return okAsync(updated);
    })
    .catch((e) => {
      console.error("Update settings error: ", e);
      return errAsync({
        reason: "Failed to update settings",
      } as const);
    });
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

  return await dbGetReportingSettings(orgId)
    .then((settings) => {
      return {
        value: (settings as ReportingSettingsData) || null,
        ok: true as const,
      };
    })
    .catch((e) => {
      console.error("Error fetching settings.: ", e);
      return { error: { reason: "Error fetching settings." }, ok: false };
    });
}
