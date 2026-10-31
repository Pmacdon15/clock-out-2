import { auth, clerkClient } from "@clerk/nextjs/server";
import { fromZonedTime } from "date-fns-tz";
import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import {
  BREAK_TYPE_VALUES,
  getBreakLimits,
  isBreakOverLimit,
  isBreakType,
  isValidBreakLimit,
  validateBreak,
} from "./break-utils";
import { fetchAllPages } from "./clerk-pagination";
import {
  dbCheckActiveEntry,
  dbClockIn,
  dbClockOut,
  dbCreateSite,
  dbDeleteBreak,
  dbDeleteSite,
  dbDeleteTimeEntry,
  dbEndOpenBreak,
  dbGetActiveEntry,
  dbGetBreakSettings,
  dbGetBreaksForEntriesInOrg,
  dbGetBreakWithEntry,
  dbGetEntryBreaks,
  dbGetLocationSettings,
  dbGetOrgTimeEntries,
  dbGetReportingSettings,
  dbGetSites,
  dbGetSitesForEnforcement,
  dbGetTimeEntries,
  dbStartBreak,
  dbUpdateBreak,
  dbUpdateBreakSettings,
  dbUpdateLocationSettings,
  dbUpdateReportingSettings,
  dbUpdateSite,
  dbUpdateTimeEntry,
} from "./db";
import {
  type Coordinates,
  evaluateClockLocation,
  isCaptureEnabled,
  type StoredLocation,
} from "./geo";
import { reverseGeocode } from "./geoapify";
import type {
  BreakLimits,
  BreakSettingsData,
  BreakType,
  LocationSettingsData,
  ReportingSettingsData,
  SerializableResult,
  SiteData,
  TimeEntry,
  TimeEntryBreak,
} from "./types";
import { getProcessedMembers, isOverMemberShipLimit } from "./utils-clerk";

export type { SerializableResult, TimeEntry, TimeEntryBreak };

/** Clerk billing feature slug that unlocks location capture and geofencing. */
const GEOFENCING_FEATURE = "geofencing" as const;

/**
 * Resolves what should be stored with a punch, and whether the punch is
 * allowed at all. The client sends coordinates but never the verdict: the
 * org's entitlement, settings and sites are read here, server-side, on every
 * punch.
 *
 * An org without the `geofencing` feature is treated as having location off —
 * never as a punch to refuse — so losing the entitlement can't lock anyone out
 * of the clock.
 */
async function resolvePunchLocation(
  orgId: string,
  coordinates: Coordinates | null | undefined,
  enforceGeofence: boolean,
  hasGeofencing: boolean,
): Promise<
  { ok: true; location: StoredLocation | null } | { ok: false; reason: string }
> {
  if (!hasGeofencing) {
    return { ok: true, location: null };
  }

  const settings = await dbGetLocationSettings(orgId);

  // Nothing switched on: behave exactly as before and store no coordinates.
  if (!isCaptureEnabled(settings)) {
    return { ok: true, location: null };
  }

  const sites = await dbGetSitesForEnforcement(orgId);
  const decision = evaluateClockLocation({
    coordinates,
    sites,
    settings,
    enforceGeofence,
  });

  if (!decision.allowed) {
    return { ok: false, reason: decision.reason };
  }

  if (!decision.location) {
    return { ok: true, location: null };
  }

  let address: string | null = null;
  try {
    address = await reverseGeocode({
      latitude: decision.location.latitude,
      longitude: decision.location.longitude,
    });
  } catch (err) {
    console.error("Error reverse geocoding punch location: ", err);
  }

  if (!address && decision.location.siteName && sites?.length) {
    const matched = sites.find((s) => s.name === decision.location?.siteName);
    if (matched?.address) {
      address = matched.address;
    }
  }

  return {
    ok: true,
    location: {
      ...decision.location,
      address,
    },
  };
}

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

export async function clockIn(coordinates?: Coordinates | null) {
  const { userId, orgId, has } = await auth.protect();
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

  const punchLocation = await resolvePunchLocation(
    orgId,
    coordinates,
    true,
    has({ feature: GEOFENCING_FEATURE }),
  ).catch((e) => {
    console.error("Error verifying clock-in location: ", e);
    return { ok: false as const, reason: "Unable to verify your location." };
  });

  if (!punchLocation.ok) {
    return errAsync({ reason: punchLocation.reason } as const);
  }

  return await dbClockIn(userId, orgId, punchLocation.location)
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

export async function clockOut(coordinates?: Coordinates | null) {
  const { userId, orgId, has } = await auth.protect();
  if (!userId || !orgId) {
    return errAsync({
      reason: "Unauthorized or no organization selected",
    } as const);
  }

  // Clocking out is never geofenced — leaving a site must not trap anyone on
  // the clock — but it still records where it happened when capture is on.
  const punchLocation = await resolvePunchLocation(
    orgId,
    coordinates,
    false,
    has({ feature: GEOFENCING_FEATURE }),
  ).catch((e) => {
    console.error("Error resolving clock-out location: ", e);
    return { ok: true as const, location: null };
  });

  // Close a break still running at clock-out, capped at its type's limit,
  // so the shift never ends with an open (and ever-growing) break on it.
  const breakSettings = await loadBreakSettings(orgId);
  await Promise.resolve()
    .then(() => dbEndOpenBreak(userId, orgId, getBreakLimits(breakSettings)))
    .catch((e) => {
      console.error("Error closing break at clock-out: ", e);
    });

  return await dbClockOut(
    userId,
    orgId,
    // Resolving without enforcement never refuses, so this cannot be a
    // refusal — but the union still has to be narrowed.
    /* v8 ignore next -- @preserve */
    punchLocation.ok ? punchLocation.location : null,
  )
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
  /** Per-break-type limits in minutes (null = none); undefined keeps them. */
  limits?: BreakLimits,
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
    minShiftHours > 24 ||
    (limits !== undefined &&
      !BREAK_TYPE_VALUES.every((type) => isValidBreakLimit(limits[type])))
  ) {
    return errAsync({ reason: "Invalid break settings" } as const);
  }
  return await dbUpdateBreakSettings(
    authUser.orgId,
    dockLunch,
    durationMinutes,
    minShiftHours,
    limits,
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
 * The org's break settings for internal checks. A lookup failure degrades to
 * "no settings" (no paid-break limit) rather than blocking the punch.
 */
async function loadBreakSettings(
  orgId: string,
): Promise<BreakSettingsData | null> {
  return await Promise.resolve()
    .then(() => dbGetBreakSettings(orgId))
    .then(
      (settings) => settings ?? null,
      (e) => {
        console.error("Error fetching break settings: ", e);
        return null;
      },
    );
}

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
  const runningBreak = (activeEntry.breaks ?? []).find((brk) => !brk.break_end);
  if (runningBreak) {
    // A break past its type's limit is already over in all but the record:
    // close it at its deadline, then let the new break start.
    const breakSettings = await loadBreakSettings(orgId);
    if (!isBreakOverLimit(runningBreak, breakSettings)) {
      return errAsync({ reason: "A break is already running" } as const);
    }
    const closed = await dbEndOpenBreak(
      userId,
      orgId,
      getBreakLimits(breakSettings),
    ).then(
      () => true,
      (e) => {
        console.error("Error closing expired paid break: ", e);
        return false;
      },
    );
    if (!closed) {
      return errAsync({ reason: "Error starting break." } as const);
    }
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

/**
 * Ends the break running on the caller's open shift. The break is capped at
 * its type's limit, so ending it late (or automatically, once the limit runs
 * out) records it as ending exactly at the limit.
 */
export async function endBreak() {
  const { userId, orgId } = await auth.protect();
  if (!userId || !orgId) {
    return errAsync({
      reason: "Unauthorized or no organization selected",
    } as const);
  }

  const breakSettings = await loadBreakSettings(orgId);

  return await dbEndOpenBreak(userId, orgId, getBreakLimits(breakSettings))
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

/** Valid values for `location_settings.capture_mode`. */
const CAPTURE_MODES = ["off", "optional", "required"];

export async function getOrgLocationSettings(): Promise<
  SerializableResult<LocationSettingsData | null, { reason: string }>
> {
  const { userId, orgId } = await auth.protect();
  if (!userId || !orgId) {
    return {
      error: { reason: "Unauthorized or no organization selected" },
      ok: false,
    };
  }

  return await dbGetLocationSettings(orgId)
    .then((settings) => {
      return {
        value: (settings as LocationSettingsData) || null,
        ok: true as const,
      };
    })
    .catch((e) => {
      console.error("Error fetching location settings.: ", e);
      return {
        error: { reason: "Error fetching location settings." },
        ok: false,
      };
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

export async function updateLocationSettingsDal(
  captureMode: string,
  restrictClockIn: boolean,
) {
  const authUser = await auth.protect();
  if (
    !authUser.userId ||
    !authUser.orgId ||
    authUser.orgRole !== "org:admin" ||
    !authUser.has({ feature: GEOFENCING_FEATURE })
  ) {
    return errAsync({ reason: "Unauthorized" } as const);
  }
  if (!CAPTURE_MODES.includes(captureMode)) {
    return errAsync({ reason: "Invalid location settings" } as const);
  }
  return await dbUpdateLocationSettings(
    authUser.orgId,
    captureMode,
    restrictClockIn,
  )
    .then((updated) => {
      return okAsync(updated);
    })
    .catch((e) => {
      console.error("Update location settings error: ", e);
      return errAsync({
        reason: "Failed to update location settings",
      } as const);
    });
}

/** Every member needs the site list; only admins can change it. */
export async function getOrgSites(): Promise<
  SerializableResult<SiteData[], { reason: string }>
> {
  const { userId, orgId } = await auth.protect();
  if (!userId || !orgId) {
    return {
      error: { reason: "Unauthorized or no organization selected" },
      ok: false,
    };
  }

  return await dbGetSites(orgId)
    .then((sites) => {
      return { value: sites, ok: true as const };
    })
    .catch((e) => {
      console.error("Error fetching sites.: ", e);
      return { error: { reason: "Error fetching sites." }, ok: false };
    });
}

/** Shared validation for the site form. Returns null when the input is fine. */
function invalidSiteReason(
  name: string,
  latitude: number,
  longitude: number,
  radiusMeters: number,
) {
  if (!name.trim()) return "Site name is required";
  if (
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    return "Invalid site coordinates";
  }
  if (
    !Number.isFinite(radiusMeters) ||
    radiusMeters < 0 ||
    radiusMeters > 100_000
  ) {
    return "Invalid site radius";
  }
  return null;
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

export async function createSiteDal(
  name: string,
  latitude: number,
  longitude: number,
  radiusMeters: number,
  address?: string | null,
) {
  const authUser = await auth.protect();
  if (
    !authUser.userId ||
    !authUser.orgId ||
    authUser.orgRole !== "org:admin" ||
    !authUser.has({ feature: GEOFENCING_FEATURE })
  ) {
    return errAsync({ reason: "Unauthorized" } as const);
  }
  const invalid = invalidSiteReason(name, latitude, longitude, radiusMeters);
  if (invalid) {
    return errAsync({ reason: invalid } as const);
  }

  return await (address === undefined
    ? dbCreateSite(
        authUser.orgId,
        name.trim(),
        latitude,
        longitude,
        radiusMeters,
      )
    : dbCreateSite(
        authUser.orgId,
        name.trim(),
        latitude,
        longitude,
        radiusMeters,
        address,
      )
  )
    .then((created) => {
      return okAsync(created);
    })
    .catch((e) => {
      console.error("Create site error: ", e);
      return errAsync({ reason: "Failed to create site" } as const);
    });
}

export async function updateSiteDal(
  id: number,
  name: string,
  latitude: number,
  longitude: number,
  radiusMeters: number,
  address?: string | null,
) {
  const authUser = await auth.protect();
  if (
    !authUser.userId ||
    !authUser.orgId ||
    authUser.orgRole !== "org:admin" ||
    !authUser.has({ feature: GEOFENCING_FEATURE })
  ) {
    return errAsync({ reason: "Unauthorized" } as const);
  }
  const invalid = invalidSiteReason(name, latitude, longitude, radiusMeters);
  if (invalid) {
    return errAsync({ reason: invalid } as const);
  }

  return await (address === undefined
    ? dbUpdateSite(
        id,
        authUser.orgId,
        name.trim(),
        latitude,
        longitude,
        radiusMeters,
      )
    : dbUpdateSite(
        id,
        authUser.orgId,
        name.trim(),
        latitude,
        longitude,
        radiusMeters,
        address,
      )
  )
    .then(
      (
        updated,
      ): ResultAsync<SiteData, { readonly reason: "Site not found" }> => {
        // No row matched: unknown id, or a site belonging to another org.
        if (!updated) {
          return errAsync({ reason: "Site not found" } as const);
        }
        return okAsync(updated);
      },
    )
    .catch((e) => {
      console.error("Update site error: ", e);
      return errAsync({ reason: "Failed to update site" } as const);
    });
}

export async function deleteSiteDal(id: number) {
  const authUser = await auth.protect();
  if (
    !authUser.userId ||
    !authUser.orgId ||
    authUser.orgRole !== "org:admin" ||
    !authUser.has({ feature: GEOFENCING_FEATURE })
  ) {
    return errAsync({ reason: "Unauthorized" } as const);
  }

  return await dbDeleteSite(id, authUser.orgId)
    .then(
      (
        deleted,
      ): ResultAsync<SiteData, { readonly reason: "Site not found" }> => {
        if (!deleted) {
          return errAsync({ reason: "Site not found" } as const);
        }
        return okAsync(deleted);
      },
    )
    .catch((e) => {
      console.error("Delete site error: ", e);
      return errAsync({ reason: "Failed to delete site" } as const);
    });
}
