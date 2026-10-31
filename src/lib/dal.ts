import { auth, clerkClient } from "@clerk/nextjs/server";
import { fromZonedTime } from "date-fns-tz";
import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import { isBreakType, validateBreak } from "./break-utils";
import { fetchAllPages } from "./clerk-pagination";
import {
  dbCheckActiveEntry,
  dbClockIn,
  dbClockOut,
  dbDeleteBreak,
  dbDeleteTimeEntry,
  dbEndOpenBreak,
  dbGetActiveEntry,
  dbGetBreakSettings,
  dbGetBreaksForEntriesInOrg,
  dbGetBreakWithEntry,
  dbGetEntryBreaks,
  dbGetOrgTimeEntries,
  dbGetReportingSettings,
  dbGetTimeEntries,
  dbStartBreak,
  dbUpdateBreak,
  dbUpdateBreakSettings,
  dbUpdateReportingSettings,
  dbUpdateTimeEntry,
} from "./db";
import type {
  BreakSettingsData,
  BreakType,
  ReportingSettingsData,
  SerializableResult,
  TimeEntry,
  TimeEntryBreak,
} from "./types";
import { getProcessedMembers, isOverMemberShipLimit } from "./utils-clerk";

export type { SerializableResult, TimeEntry, TimeEntryBreak };

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
      fetchAllPages(
        (params) =>
          client.organizations.getOrganizationMembershipList({
            organizationId: orgId,
            ...params,
          }),
        { label: `members of ${orgId}` },
      ),
    )
    .then((members) => getProcessedMembers(orgId, members))
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
    .then(
      (
        newEntry,
      ): ResultAsync<TimeEntry, { readonly reason: "Already clocked in" }> => {
        // A concurrent request may have clocked in between check and insert.
        if (!newEntry) {
          return errAsync({ reason: "Already clocked in" } as const);
        }
        return okAsync(newEntry);
      },
    )
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
  skip_lunch?: boolean,
) {
  const { userId, orgId, orgRole } = await auth.protect();
  if (!userId || !orgId) {
    return errAsync({ reason: "Unauthorized" } as const);
  }

  const hasInvalidTime =
    Number.isNaN(clock_in.getTime()) ||
    (clock_out !== null && Number.isNaN(clock_out.getTime()));
  if (hasInvalidTime) {
    return errAsync({ reason: "Invalid clock-in or clock-out time" } as const);
  }
  if (clock_out !== null && clock_out.getTime() <= clock_in.getTime()) {
    return errAsync({ reason: "Clock out must be after clock in" } as const);
  }

  const isAdmin = orgRole === "org:admin";
  const updatePromise =
    skip_lunch === undefined
      ? dbUpdateTimeEntry(id, clock_in, clock_out, orgId, isAdmin)
      : dbUpdateTimeEntry(id, clock_in, clock_out, orgId, isAdmin, skip_lunch);

  return await updatePromise
    .then(
      (
        updated,
      ): ResultAsync<
        TimeEntry,
        { readonly reason: "Time entry not found" }
      > => {
        // No row matched: unknown id, another org's entry, or not an admin.
        if (!updated) {
          return errAsync({ reason: "Time entry not found" } as const);
        }
        return okAsync(updated);
      },
    )
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

export async function updateBreakSettingsDal(
  dockLunch: boolean,
  durationMinutes: number = 30,
  minShiftHours: number = 5,
) {
  const authUser = await auth.protect();
  if (!authUser.userId || !authUser.orgId || authUser.orgRole !== "org:admin") {
    return errAsync({ reason: "Unauthorized" } as const);
  }
  if (
    !Number.isFinite(durationMinutes) ||
    durationMinutes < 0 ||
    durationMinutes > 480 ||
    !Number.isFinite(minShiftHours) ||
    minShiftHours < 0 ||
    minShiftHours > 24
  ) {
    return errAsync({ reason: "Invalid break settings" } as const);
  }
  return await dbUpdateBreakSettings(
    authUser.orgId,
    dockLunch,
    durationMinutes,
    minShiftHours,
  )
    .then((updated) => {
      return okAsync(updated);
    })
    .catch((e) => {
      console.error("Update break settings error: ", e);
      return errAsync({
        reason: "Failed to update break settings",
      } as const);
    });
}

export async function getOrgBreakSettings(): Promise<
  SerializableResult<BreakSettingsData | null, { reason: string }>
> {
  const { userId, orgId } = await auth.protect();
  if (!userId || !orgId) {
    return {
      error: { reason: "Unauthorized or no organization selected" },
      ok: false,
    };
  }

  return await dbGetBreakSettings(orgId)
    .then((settings) => {
      return {
        value: (settings as BreakSettingsData) || null,
        ok: true as const,
      };
    })
    .catch((e) => {
      console.error("Error fetching break settings.: ", e);
      return { error: { reason: "Error fetching break settings." }, ok: false };
    });
}

/* -------------------------------------------------------------- breaks -- */

/** A break plus the ids the server actions need for cache invalidation. */
export type BreakWithOwner = TimeEntryBreak & {
  user_id: string;
  org_id: string;
};

/**
 * Starts a break on the caller's running shift. Breaks only exist inside a
 * shift, so this fails when the member is not clocked in, and refuses a
 * second break while one is still running.
 */
export async function startBreak(breakType: BreakType = "unpaid_meal") {
  const { userId, orgId } = await auth.protect();
  if (!userId || !orgId) {
    return errAsync({
      reason: "Unauthorized or no organization selected",
    } as const);
  }

  if (!isBreakType(breakType)) {
    return errAsync({ reason: "Unknown break type" } as const);
  }

  const activeEntry = await dbGetActiveEntry(userId, orgId).catch((e) => {
    console.error("Error checking active clock-in entry: ", e);
    return undefined;
  });

  if (activeEntry === undefined) {
    return errAsync({
      reason: "Error checking active clock-in entry",
    } as const);
  }
  if (activeEntry === null) {
    return errAsync({ reason: "Not clocked in" } as const);
  }
  if ((activeEntry.breaks ?? []).some((brk) => !brk.break_end)) {
    return errAsync({ reason: "A break is already running" } as const);
  }

  return await dbStartBreak(userId, orgId, breakType)
    .then(
      (
        started,
      ): ResultAsync<
        BreakWithOwner,
        { readonly reason: "A break is already running" }
      > => {
        // A concurrent request may have opened a break between check and insert.
        if (!started) {
          return errAsync({ reason: "A break is already running" } as const);
        }
        return okAsync({ ...started, user_id: userId, org_id: orgId });
      },
    )
    .catch((e) => {
      console.error("Error starting break: ", e);
      return errAsync({ reason: "Error starting break." } as const);
    });
}

/** Ends the break running on the caller's open shift. */
export async function endBreak() {
  const { userId, orgId } = await auth.protect();
  if (!userId || !orgId) {
    return errAsync({
      reason: "Unauthorized or no organization selected",
    } as const);
  }

  return await dbEndOpenBreak(userId, orgId)
    .then(
      (
        ended,
      ): ResultAsync<
        BreakWithOwner,
        { readonly reason: "No break is running" }
      > => {
        if (!ended) {
          return errAsync({ reason: "No break is running" } as const);
        }
        return okAsync({ ...ended, user_id: userId, org_id: orgId });
      },
    )
    .catch((e) => {
      console.error("Error ending break: ", e);
      return errAsync({ reason: "Error ending break." } as const);
    });
}

/**
 * Lists the breaks recorded against the given entries. Members see their own
 * entries' breaks; admins see every member's.
 */
export async function getBreaksForEntries(
  entryIds: number[],
): Promise<SerializableResult<TimeEntryBreak[], { reason: string }>> {
  const { userId, orgId, orgRole } = await auth.protect();
  if (!userId || !orgId) {
    return {
      error: { reason: "Unauthorized or no organization selected" },
      ok: false,
    };
  }

  const ids = entryIds.filter((id) => Number.isFinite(id));

  return await dbGetBreaksForEntriesInOrg(
    ids,
    orgId,
    userId,
    orgRole === "org:admin",
  )
    .then((breaks) => ({ value: breaks, ok: true as const }))
    .catch((e) => {
      console.error("Error fetching breaks: ", e);
      return { error: { reason: "Error fetching breaks" }, ok: false };
    });
}

/**
 * Edits a recorded break. Admin-only, like editing the shift itself, and
 * checked against the shift window and the entry's other breaks.
 */
export async function updateBreakDal(
  id: number,
  breakStart: Date,
  breakEnd: Date | null,
  breakType: BreakType,
) {
  const { userId, orgId, orgRole } = await auth.protect();
  if (!userId || !orgId || orgRole !== "org:admin") {
    return errAsync({ reason: "Unauthorized" } as const);
  }

  const existing = await dbGetBreakWithEntry(id, orgId).catch((e) => {
    console.error("Error fetching break: ", e);
    return undefined;
  });
  if (!existing) {
    return errAsync({ reason: "Break not found" } as const);
  }

  const siblings = await dbGetEntryBreaks(existing.time_entry_id).catch((e) => {
    console.error("Error fetching breaks: ", e);
    return undefined;
  });
  if (!siblings) {
    return errAsync({ reason: "Error fetching breaks" } as const);
  }

  const invalid = validateBreak({
    entry: { clock_in: existing.clock_in, clock_out: existing.clock_out },
    breaks: siblings,
    break_start: breakStart,
    break_end: breakEnd,
    break_type: breakType,
    excludeBreakId: id,
  });
  if (invalid) {
    return errAsync({ reason: invalid } as const);
  }

  return await dbUpdateBreak(id, orgId, breakStart, breakEnd, breakType)
    .then(
      (
        updated,
      ): ResultAsync<
        BreakWithOwner,
        { readonly reason: "Break not found" }
      > => {
        if (!updated) {
          return errAsync({ reason: "Break not found" } as const);
        }
        return okAsync({
          ...updated,
          user_id: existing.user_id,
          org_id: orgId,
        });
      },
    )
    .catch((e) => {
      console.error("Error updating break: ", e);
      return errAsync({ reason: "Failed to update break" } as const);
    });
}

/** Deletes a recorded break. Admin-only, like deleting the shift itself. */
export async function deleteBreakDal(id: number) {
  const { userId, orgId, orgRole } = await auth.protect();
  if (!userId || !orgId || orgRole !== "org:admin") {
    return errAsync({ reason: "Unauthorized" } as const);
  }

  const existing = await dbGetBreakWithEntry(id, orgId).catch((e) => {
    console.error("Error fetching break: ", e);
    return undefined;
  });
  if (!existing) {
    return errAsync({ reason: "Break not found" } as const);
  }

  return await dbDeleteBreak(id, orgId)
    .then(
      (
        deleted,
      ): ResultAsync<
        BreakWithOwner,
        { readonly reason: "Break not found" }
      > => {
        if (!deleted) {
          return errAsync({ reason: "Break not found" } as const);
        }
        return okAsync({
          ...deleted,
          user_id: existing.user_id,
          org_id: orgId,
        });
      },
    )
    .catch((e) => {
      console.error("Error deleting break: ", e);
      return errAsync({ reason: "Failed to delete break" } as const);
    });
}
