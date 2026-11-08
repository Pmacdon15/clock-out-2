"use server";

import { auth } from "@clerk/nextjs/server";
import { startOfDay, subDays } from "date-fns";
import type { Result } from "neverthrow";
import { updateTag } from "next/cache";
import { after } from "next/server";
import { queueShiftAlertSync, syncShiftReminderJob } from "./alert-jobs";
import {
  cancelTimeOffRequestDal as dalCancelTimeOffRequest,
  clockIn as dalClockIn,
  clockOut as dalClockOut,
  createScheduledShiftDal as dalCreateScheduledShift,
  createSiteDal as dalCreateSite,
  createTimeOffRequestDal as dalCreateTimeOffRequest,
  deleteBreakDal as dalDeleteBreak,
  deleteScheduledShiftDal as dalDeleteScheduledShift,
  deleteSiteDal as dalDeleteSite,
  deleteTimeEntry as dalDeleteTimeEntry,
  endBreak as dalEndBreak,
  reviewTimeOffRequestDal as dalReviewTimeOffRequest,
  setTimeOffAllowanceDal as dalSetTimeOffAllowance,
  startBreak as dalStartBreak,
  syncMyShiftsToGoogleCalendarDal as dalSyncMyShiftsToGoogleCalendar,
  updateBreakDal as dalUpdateBreak,
  updateScheduledShiftDal as dalUpdateScheduledShift,
  updateSiteDal as dalUpdateSite,
  updateTimeEntry as dalUpdateTimeEntry,
  updateBreakSettingsDal,
  updateLocationSettingsDal,
  updateMemberPayRateDal,
  updateOvertimeSettingsDal,
  updatePayPeriodSettingsDal,
  updateReportingSettingsDal,
} from "./dal";
import type { Coordinates } from "./geo";
import { reverseGeocode, searchAddress } from "./geoapify";
import { mirrorShiftChange } from "./google-calendar";
import { sendWeeklyReports } from "./reports";
import { notifyScheduleChange } from "./schedule-notify";
import type {
  BreakCountLimits,
  BreakLimits,
  BreakType,
  PayPeriodSettingsData,
  TimeOffType,
} from "./types";

/**
 * `coordinates` is whatever the browser's Geolocation API gave the client, or
 * undefined when it gave nothing. It is only ever evidence: the DAL reads the
 * org's settings and sites and makes the geofence decision server-side.
 */
export async function clockInAction(coordinates?: Coordinates | null) {
  const result = await dalClockIn(coordinates);

  return result.match(
    (entry) => {
      if (entry) {
        updateTag(`time-entries-${entry.user_id}-${entry.org_id}`);
        // The admin schedule compares shifts with the org-wide list, so a
        // clock-in has to show there right away, not only at clock-out.
        updateTag(`org-time-entries-${entry.org_id}`);
        // When this shift's next alert is due may have changed.
        queueShiftAlertSync(entry.org_id);
      }
      return { success: true, data: entry };
    },
    (err) => {
      return { success: false, error: err.reason };
    },
  );
}

export async function clockOutAction(coordinates?: Coordinates | null) {
  const result = await dalClockOut(coordinates);

  return result.match(
    (entry) => {
      if (entry) {
        updateTag(`time-entries-${entry.user_id}-${entry.org_id}`);
        updateTag(`org-time-entries-${entry.org_id}`);
        // When this shift's next alert is due may have changed.
        queueShiftAlertSync(entry.org_id);
      }
      return { success: true, data: entry };
    },
    (err) => {
      return { success: false, error: err.reason };
    },
  );
}

export async function deleteTimeEntryAction(id: number) {
  const result = await dalDeleteTimeEntry(id);

  return result.match(
    (entry) => {
      if (entry) {
        updateTag(`time-entries-${entry.user_id}-${entry.org_id}`);
        updateTag(`org-time-entries-${entry.org_id}`);
        // When this shift's next alert is due may have changed.
        queueShiftAlertSync(entry.org_id);
      }
      return { success: true };
    },
    (err) => {
      return { success: false, error: err.reason };
    },
  );
}

export async function updateTimeEntryAction(
  id: number,
  clock_in: string,
  clock_out: string | null,
  skip_lunch?: boolean,
) {
  const clockInDate = new Date(clock_in);
  const clockOutDate = clock_out ? new Date(clock_out) : null;
  const result =
    skip_lunch === undefined
      ? await dalUpdateTimeEntry(id, clockInDate, clockOutDate)
      : await dalUpdateTimeEntry(id, clockInDate, clockOutDate, skip_lunch);

  return result.match(
    (entry) => {
      if (entry) {
        updateTag(`time-entries-${entry.user_id}-${entry.org_id}`);
        updateTag(`org-time-entries-${entry.org_id}`);
        // When this shift's next alert is due may have changed.
        queueShiftAlertSync(entry.org_id);
      }
      return { success: true, data: entry };
    },
    (err) => {
      return { success: false, error: err.reason };
    },
  );
}

export async function sendCurrentWeekReportAction() {
  const { userId, orgId, orgRole } = await auth.protect();
  if (!userId || !orgId) {
    return { success: false, error: "Unauthorized" };
  }
  const isAdmin = orgRole === "org:admin";
  if (!isAdmin) {
    return { success: false, error: "Only admins can test reports" };
  }

  const endDate = new Date();
  const startDate = startOfDay(subDays(endDate, 7));

  await sendWeeklyReports(startDate, endDate, orgId);
  return { success: true };
}

export async function updateOrgSettingAction(
  frequency: string,
  day: string | null = null,
  interval: number = 1,
) {
  const result = await updateReportingSettingsDal(frequency, day, interval);

  return result.match(
    (entry) => {
      // updateTag(`settings-${entry.org_id}`)
      updateTag(`reporting-settings-${entry.org_id}`);
      return { success: true, data: entry };
    },
    (err) => {
      return { success: false, error: err.reason };
    },
  );
}

export async function updateBreakSettingAction(
  dockLunch: boolean,
  durationMinutes: number = 30,
  minShiftHours: number = 5,
  limits?: BreakLimits,
  paidLunch?: boolean,
  countLimits?: BreakCountLimits,
) {
  const result = await updateBreakSettingsDal(
    dockLunch,
    durationMinutes,
    minShiftHours,
    limits,
    paidLunch,
    countLimits,
  );

  return result.match(
    (entry) => {
      updateTag(`break-settings-${entry.org_id}`);
      // Break time limits decide when "your break is over" is sent.
      queueShiftAlertSync(entry.org_id);
      return { success: true, data: entry };
    },
    (err) => {
      return { success: false, error: err.reason };
    },
  );
}

export async function updateOvertimeSettingsAction(
  dailyThresholdHours: number | null,
  weeklyThresholdHours: number | null,
) {
  const result = await updateOvertimeSettingsDal(
    dailyThresholdHours,
    weeklyThresholdHours,
  );

  return result.match(
    (entry) => {
      updateTag(`overtime-settings-${entry.org_id}`);
      return { success: true, data: entry };
    },
    (err) => {
      return { success: false, error: err.reason };
    },
  );
}

export async function updatePayPeriodSettingsAction(
  enabled: boolean,
  frequency: PayPeriodSettingsData["frequency"],
  anchorPayday: string,
  holdbackDays: number,
) {
  const result = await updatePayPeriodSettingsDal(
    enabled,
    frequency,
    anchorPayday,
    holdbackDays,
  );

  return result.match(
    (entry) => {
      updateTag(`pay-period-settings-${entry.org_id}`);
      return { success: true, data: entry };
    },
    (err) => {
      return { success: false, error: err.reason };
    },
  );
}

/**
 * Break records change the hours a shift is worth, so every break mutation
 * invalidates the member's entries and the org-wide list the Hours view and
 * the exports read from.
 */
function updateBreakTags(entry: { user_id: string; org_id: string }) {
  if (entry.user_id) {
    updateTag(`time-entries-${entry.user_id}-${entry.org_id}`);
  }
  updateTag(`org-time-entries-${entry.org_id}`);
  // A break starting, ending or moving changes when its reminder is due.
  queueShiftAlertSync(entry.org_id);
}

export async function startBreakAction(breakType?: BreakType) {
  const result = await dalStartBreak(breakType);

  return result.match(
    (brk) => {
      updateBreakTags(brk);
      return { success: true, data: brk };
    },
    (err) => {
      return { success: false, error: err.reason };
    },
  );
}

export async function endBreakAction() {
  const result = await dalEndBreak();

  return result.match(
    (brk) => {
      updateBreakTags(brk);
      return { success: true, data: brk };
    },
    (err) => {
      return { success: false, error: err.reason };
    },
  );
}

export async function updateBreakAction(
  id: number,
  break_start: string,
  break_end: string | null,
  break_type: BreakType,
) {
  const result = await dalUpdateBreak(
    id,
    new Date(break_start),
    break_end ? new Date(break_end) : null,
    break_type,
  );

  return result.match(
    (brk) => {
      updateBreakTags(brk);
      return { success: true, data: brk };
    },
    (err) => {
      return { success: false, error: err.reason };
    },
  );
}

export async function updateLocationSettingsAction(
  captureMode: string,
  restrictClockIn: boolean,
) {
  const result = await updateLocationSettingsDal(captureMode, restrictClockIn);

  return result.match(
    (entry) => {
      updateTag(`location-settings-${entry.org_id}`);
      return { success: true, data: entry };
    },
    (err) => {
      return { success: false, error: err.reason };
    },
  );
}

export async function createSiteAction(
  name: string,
  latitude: number,
  longitude: number,
  radiusMeters: number,
  address?: string | null,
) {
  const result =
    address === undefined
      ? await dalCreateSite(name, latitude, longitude, radiusMeters)
      : await dalCreateSite(name, latitude, longitude, radiusMeters, address);

  return result.match(
    (site) => {
      updateTag(`sites-${site.org_id}`);
      return { success: true, data: site };
    },
    (err) => {
      return { success: false, error: err.reason };
    },
  );
}

export async function updateSiteAction(
  id: number,
  name: string,
  latitude: number,
  longitude: number,
  radiusMeters: number,
  address?: string | null,
) {
  const result =
    address === undefined
      ? await dalUpdateSite(id, name, latitude, longitude, radiusMeters)
      : await dalUpdateSite(
          id,
          name,
          latitude,
          longitude,
          radiusMeters,
          address,
        );

  return result.match(
    (site) => {
      updateTag(`sites-${site.org_id}`);
      return { success: true, data: site };
    },
    (err) => {
      return { success: false, error: err.reason };
    },
  );
}

export async function searchAddressAction(query: string) {
  const authUser = await auth.protect();
  if (
    !authUser.userId ||
    !authUser.orgId ||
    authUser.orgRole !== "org:admin" ||
    !authUser.has({ feature: "geofencing" })
  ) {
    return { success: false as const, error: "Unauthorized" };
  }
  const results = await searchAddress(query);
  return { success: true as const, data: results };
}

export async function reverseGeocodeAction(
  latitude: number,
  longitude: number,
) {
  const authUser = await auth.protect();
  if (!authUser.userId || !authUser.orgId) {
    return { success: false as const, error: "Unauthorized" };
  }
  const address = await reverseGeocode({ latitude, longitude });
  return { success: true as const, data: address };
}

export async function deleteBreakAction(id: number) {
  const result = await dalDeleteBreak(id);

  return result.match(
    (brk) => {
      updateBreakTags(brk);
      return { success: true };
    },
    (err) => {
      return { success: false, error: err.reason };
    },
  );
}

export async function deleteSiteAction(id: number) {
  const result = await dalDeleteSite(id);

  return result.match(
    (site) => {
      updateTag(`sites-${site.org_id}`);
      return { success: true, data: site };
    },
    (err) => {
      return { success: false, error: err.reason };
    },
  );
}

export async function createScheduledShiftAction(
  memberId: string,
  shiftStart: string,
  shiftEnd: string,
  note?: string | null,
  /** The admin's browser zone: wording fallback for the member's notice. */
  timezone?: string | null,
  /** The shift's days on the admin's calendar, for the time off check. */
  localDays?: { start: string; end: string } | null,
) {
  const result = await dalCreateScheduledShift(
    memberId,
    new Date(shiftStart),
    new Date(shiftEnd),
    note,
    localDays,
  );

  return result.match(
    (shift) => {
      updateTag(`scheduled-shifts-${shift.org_id}`);
      after(() => notifyScheduleChange("added", shift, timezone));
      after(() => syncShiftReminderJob("added", shift).catch(logJobError));
      after(() => mirrorShiftChange("added", shift).catch(logCalendarError));
      return { success: true as const, data: shift };
    },
    (err) => {
      return { success: false as const, error: err.reason };
    },
  );
}

export async function updateScheduledShiftAction(
  id: number,
  shiftStart: string,
  shiftEnd: string,
  note?: string | null,
  timezone?: string | null,
  localDays?: { start: string; end: string } | null,
) {
  const result = await dalUpdateScheduledShift(
    id,
    new Date(shiftStart),
    new Date(shiftEnd),
    note,
    localDays,
  );

  return result.match(
    (shift) => {
      updateTag(`scheduled-shifts-${shift.org_id}`);
      after(() => notifyScheduleChange("changed", shift, timezone));
      after(() => syncShiftReminderJob("changed", shift).catch(logJobError));
      after(() => mirrorShiftChange("changed", shift).catch(logCalendarError));
      return { success: true as const, data: shift };
    },
    (err) => {
      return { success: false as const, error: err.reason };
    },
  );
}

export async function deleteScheduledShiftAction(
  id: number,
  timezone?: string | null,
) {
  const result = await dalDeleteScheduledShift(id);

  return result.match(
    (shift) => {
      updateTag(`scheduled-shifts-${shift.org_id}`);
      after(() => notifyScheduleChange("removed", shift, timezone));
      after(() => syncShiftReminderJob("removed", shift).catch(logJobError));
      after(() => mirrorShiftChange("removed", shift).catch(logCalendarError));
      return { success: true as const };
    },
    (err) => {
      return { success: false as const, error: err.reason };
    },
  );
}

function logCalendarError(error: unknown) {
  console.error("[Google Calendar] Failed to update a shift event:", error);
}

/** Adds the signed-in member's shifts to their own Google Calendar. */
export async function syncMyShiftsToGoogleCalendarAction() {
  return await dalSyncMyShiftsToGoogleCalendar();
}

function logJobError(error: unknown) {
  console.error("[Jobs] Failed to schedule shift reminder:", error);
}

/** Time off shows in the time off tab, the Hours view and reports. */
function timeOffResult<T extends { org_id: string }>(
  result: Result<T, { reason: string }>,
) {
  return result.match(
    (request) => {
      updateTag(`time-off-${request.org_id}`);
      return { success: true as const, data: request };
    },
    (err) => ({ success: false as const, error: err.reason }),
  );
}

export async function createTimeOffRequestAction(
  type: TimeOffType,
  startDate: string,
  endDate: string,
  hoursPerDay: number,
  note?: string | null,
  /** Admins only: record it for another member and/or approve it now. */
  options?: { memberId?: string | null; approve?: boolean },
) {
  return timeOffResult(
    options === undefined
      ? await dalCreateTimeOffRequest(
          type,
          startDate,
          endDate,
          hoursPerDay,
          note,
        )
      : await dalCreateTimeOffRequest(
          type,
          startDate,
          endDate,
          hoursPerDay,
          note,
          options,
        ),
  );
}

export async function reviewTimeOffRequestAction(
  id: number,
  decision: "approved" | "denied",
) {
  return timeOffResult(await dalReviewTimeOffRequest(id, decision));
}

export async function cancelTimeOffRequestAction(id: number) {
  return timeOffResult(await dalCancelTimeOffRequest(id));
}

/** Sets a member's yearly PTO days; null removes the limit. */
export async function setTimeOffAllowanceAction(
  memberId: string,
  ptoDays: number | null,
) {
  return timeOffResult(await dalSetTimeOffAllowance(memberId, ptoDays));
}

export async function updateMemberPayRateAction(
  memberId: string,
  hourlyRate: number | null,
  overtimeMultiplier: number,
) {
  const result = await updateMemberPayRateDal(
    memberId,
    hourlyRate,
    overtimeMultiplier,
  );

  return result.match(
    (rate) => {
      updateTag(`pay-rates-${rate.org_id}`);
      return { success: true, data: rate };
    },
    (err) => {
      return { success: false, error: err.reason };
    },
  );
}
