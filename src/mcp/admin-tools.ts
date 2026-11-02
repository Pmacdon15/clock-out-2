import { clerkClient } from "@clerk/nextjs/server";
import { addDays, format, startOfDay, subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import {
  ALERT_BOUNDS,
  normalizeAlertSettings,
  validateAlertSettings,
} from "@/lib/alerts";
import { dbGetAlertSettings, dbUpdateAlertSettings } from "@/lib/alerts-db";
import {
  dbCancelTimeOffRequest,
  dbCreateScheduledShift,
  dbCreateSite,
  dbCreateTimeOffRequest,
  dbDeleteScheduledShift,
  dbDeleteSite,
  dbGetApprovedTimeOffForPeriod,
  dbGetLocationSettings,
  dbGetOrgTimeEntries,
  dbGetOvertimeSettings,
  dbGetScheduledShiftById,
  dbGetScheduledShifts,
  dbGetSites,
  dbGetTimeEntries,
  dbGetTimeOffRequests,
  dbReviewTimeOffRequest,
  dbUpdateLocationSettings,
  dbUpdateOvertimeSettings,
  dbUpdateScheduledShift,
  dbUpdateSite,
} from "@/lib/db";
import { reverseGeocode, searchAddress } from "@/lib/geoapify";
import {
  describeOvertime,
  isValidOvertimeThreshold,
  MAX_DAILY_OVERTIME_HOURS,
  MAX_WEEKLY_OVERTIME_HOURS,
} from "@/lib/overtime";
import {
  orgHasPlanFeature,
  SCHEDULING_FEATURE,
  SCHEDULING_UPGRADE_REASON,
  TIME_OFF_FEATURE,
  TIME_OFF_UPGRADE_REASON,
} from "@/lib/plan-features";
import { notifyScheduleChange } from "@/lib/schedule-notify";
import {
  evaluateShifts,
  invalidShiftReason,
  SCHEDULE_FUTURE_DAYS,
  SCHEDULE_PAST_DAYS,
  SHIFT_STATUS_LABELS,
} from "@/lib/schedule-utils";
import {
  DEFAULT_TIME_OFF_HOURS_PER_DAY,
  formatTimeOffDates,
  invalidTimeOffReason,
  MAX_TIME_OFF_NOTE_LENGTH,
  shiftCalendarDays,
  TIME_OFF_STATUS_LABELS,
  TIME_OFF_TYPE_LABELS,
  timeOffHoursInRange,
} from "@/lib/time-off-utils";
import type {
  AlertSettingsInput,
  ScheduledShift,
  SiteData,
  TimeOffRequest,
  TimeOffStatus,
} from "@/lib/types";
import {
  fetchOrgMembers,
  formatTimestampInTz,
  type McpCaller,
  type OrgContext,
  type OrgMemberInfo,
  parseFlexibleDateTime,
  resolveMemberFromList,
  resolveOrg,
  type ToolResult,
  validTimezone,
} from "@/mcp/tools";

/*
 * Admin control over the newer features from MCP: the schedule, time off,
 * overtime, alert rules and location/geofence settings. Each tool applies
 * the same rules as the web app: anyone can read what they are allowed to
 * see, and only organization admins ('org:admin') can change things.
 */

/* ---------------------------------------------------------- schemas -- */

const orgIdField = z
  .string()
  .optional()
  .describe(
    "Organization ID (org_...), slug, or name. Optional if the user only belongs to one organization.",
  );

const timezoneField = z
  .string()
  .optional()
  .describe(
    "IANA timezone name (e.g. 'America/Edmonton', 'America/Toronto', 'UTC') used to read and show dates and times. Defaults to 'America/Edmonton'.",
  );

const dateField = (description: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .optional()
    .describe(description);

export const manageScheduleInputSchema = z.object({
  org_id: orgIdField,
  action: z
    .enum(["list", "create", "update", "cancel"])
    .optional()
    .describe(
      "'list' (default) shows scheduled shifts with how each one went (on time, late, not clocked in, no-show). 'create' schedules a new shift for a member, 'update' moves a shift to new times or changes its note, and 'cancel' removes a shift. create/update/cancel are admin-only.",
    ),
  member: z
    .string()
    .optional()
    .describe(
      "Member's name, email, or user_id. Required for 'create'. For 'list', admins can pass it to see one member's shifts (members always see only their own). For 'cancel' without shift_id, the member whose shift on `date` should be cancelled.",
    ),
  shift_id: z
    .number()
    .int()
    .optional()
    .describe(
      "ID of the shift to update or cancel (from 'list'). For 'cancel' it can be omitted if member and date identify exactly one shift.",
    ),
  date: dateField(
    "Day of the shift (YYYY-MM-DD) in `timezone`. Required for 'create'. For 'update', the new day (defaults to the shift's current day).",
  ),
  start_time: z
    .string()
    .optional()
    .describe(
      "Shift start, e.g. '09:00', '9:00 AM', or a full date-time. Required for 'create'; for 'update' defaults to the current start time.",
    ),
  end_time: z
    .string()
    .optional()
    .describe(
      "Shift end, e.g. '17:00' or '5 PM'. An end time at or before the start runs past midnight. Required for 'create'; for 'update' defaults to the current end time.",
    ),
  note: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Note shown with the shift (e.g. 'Front desk'), up to 500 characters. For 'update', pass an empty string or null to clear it; omit to keep it.",
    ),
  start_date: dateField(
    "For 'list': first day to show (defaults to two weeks ago).",
  ),
  end_date: dateField(
    "For 'list': last day to show (defaults to four weeks from today).",
  ),
  timezone: timezoneField,
});

export const manageTimeOffInputSchema = z.object({
  org_id: orgIdField,
  action: z
    .enum(["list", "request", "approve", "deny", "cancel"])
    .optional()
    .describe(
      "'list' (default) shows time off requests. 'request' files vacation or sick time (admins can file it for any member and approve it right away). 'approve' and 'deny' review a pending request (admin-only). 'cancel' withdraws a pending request; admins can also revoke approved time off.",
    ),
  member: z
    .string()
    .optional()
    .describe(
      "Member's name, email, or user_id. For 'request', admins can file time off for this member (defaults to yourself). For 'list', admins can pass it to see one member's requests.",
    ),
  request_id: z
    .number()
    .int()
    .optional()
    .describe("ID of the request to approve, deny, or cancel (from 'list')."),
  type: z
    .enum(["vacation", "sick"])
    .optional()
    .describe("For 'request': 'vacation' (default) or 'sick'."),
  start_date: dateField(
    "For 'request': first day off (YYYY-MM-DD). For 'list': only show requests ending on or after this day (defaults to about 13 months ago).",
  ),
  end_date: dateField(
    "For 'request': last day off (YYYY-MM-DD, inclusive). Defaults to start_date for a single day.",
  ),
  hours_per_day: z
    .number()
    .min(0.5)
    .max(24)
    .optional()
    .describe("For 'request': paid hours per day off (default 8)."),
  note: z
    .string()
    .optional()
    .describe("For 'request': optional note, up to 500 characters."),
  approve: z
    .boolean()
    .optional()
    .describe(
      "For 'request', admin-only: true files the time off already approved. Defaults to true when an admin files time off for another member, otherwise false (pending).",
    ),
  status: z
    .enum(["pending", "approved", "denied", "cancelled"])
    .optional()
    .describe("For 'list': only show requests with this status."),
});

export const manageOvertimeSettingsInputSchema = z.object({
  org_id: orgIdField,
  action: z
    .enum(["get", "update"])
    .optional()
    .describe(
      "'get' (default) shows the overtime rules; 'update' changes them (admin-only).",
    ),
  daily_threshold_hours: z
    .number()
    .min(0)
    .max(MAX_DAILY_OVERTIME_HOURS)
    .nullable()
    .optional()
    .describe(
      "Hours in a day after which time counts as overtime (e.g. 8). null turns daily overtime off; omit to keep the current value.",
    ),
  weekly_threshold_hours: z
    .number()
    .min(0)
    .max(MAX_WEEKLY_OVERTIME_HOURS)
    .nullable()
    .optional()
    .describe(
      "Hours in a week after which time counts as overtime (e.g. 40 or 44). null turns weekly overtime off; omit to keep the current value.",
    ),
});

export const manageAlertSettingsInputSchema = z.object({
  org_id: orgIdField,
  action: z
    .enum(["get", "update"])
    .optional()
    .describe(
      "'get' (default) shows the organization's alert rules; 'update' changes them (admin-only). Only the fields you pass change.",
    ),
  forgot_clock_out_enabled: z
    .boolean()
    .optional()
    .describe(
      "Remind members whose shift has been open for forgot_clock_out_hours.",
    ),
  forgot_clock_out_hours: z
    .number()
    .min(ALERT_BOUNDS.minHours)
    .max(ALERT_BOUNDS.maxHours)
    .optional()
    .describe("Hours on the clock before the forgot-to-clock-out reminder."),
  auto_clock_out_enabled: z
    .boolean()
    .optional()
    .describe(
      "Clock members out automatically after auto_clock_out_hours on the clock.",
    ),
  auto_clock_out_hours: z
    .number()
    .min(ALERT_BOUNDS.minHours)
    .max(ALERT_BOUNDS.maxHours)
    .optional()
    .describe("Hours on the clock before the automatic clock-out."),
  break_reminder_enabled: z
    .boolean()
    .optional()
    .describe("Remind members still on a break after break_reminder_minutes."),
  break_reminder_minutes: z
    .number()
    .int()
    .min(ALERT_BOUNDS.minBreakMinutes)
    .max(ALERT_BOUNDS.maxBreakMinutes)
    .optional()
    .describe("Minutes on a break before the reminder."),
  notify_admins: z
    .boolean()
    .optional()
    .describe("Also send every alert to the organization's admins."),
  schedule_notifications: z
    .boolean()
    .optional()
    .describe(
      "Tell members about their weekly schedule, remind them an hour before each shift, and tell them about shifts added, changed or cancelled.",
    ),
});

export const manageLocationSettingsInputSchema = z.object({
  org_id: orgIdField,
  action: z
    .enum(["get", "update", "add_site", "update_site", "delete_site"])
    .optional()
    .describe(
      "'get' (default) shows location capture settings and work sites. 'update' changes capture_mode / restrict_clock_in; 'add_site', 'update_site' and 'delete_site' manage approved work sites. Changes are admin-only and need a plan with Geofencing.",
    ),
  capture_mode: z
    .enum(["off", "optional", "required"])
    .optional()
    .describe(
      "For 'update': 'off' (no location), 'optional' (recorded when shared) or 'required' (needed to clock in).",
    ),
  restrict_clock_in: z
    .boolean()
    .optional()
    .describe(
      "For 'update': true only allows clock-in inside an approved work site (geofence).",
    ),
  site_id: z
    .number()
    .int()
    .optional()
    .describe(
      "For 'update_site' or 'delete_site': the site's ID (from 'get').",
    ),
  name: z
    .string()
    .optional()
    .describe("Site name for 'add_site' (required) or 'update_site'."),
  address: z
    .string()
    .optional()
    .describe(
      "Street address of the site. Used to look up coordinates when latitude/longitude aren't given.",
    ),
  latitude: z.number().min(-90).max(90).optional().describe("Site latitude."),
  longitude: z
    .number()
    .min(-180)
    .max(180)
    .optional()
    .describe("Site longitude."),
  radius_meters: z
    .number()
    .min(0)
    .max(100_000)
    .optional()
    .describe(
      "Geofence radius in meters (default 150 for a new site; omit to keep the current radius).",
    ),
});

export const manageMemberInputSchema = z.object({
  org_id: orgIdField,
  action: z
    .enum(["set_role", "remove"])
    .describe(
      "'set_role' makes a member an admin or a regular member; 'remove' removes them from the organization (their recorded hours are kept). Admin-only.",
    ),
  member: z.string().describe("The member's name, email, or user_id."),
  role: z
    .enum(["org:member", "org:admin", "member", "admin"])
    .optional()
    .describe("For 'set_role': the new role."),
});

/* ---------------------------------------------------------- helpers -- */

function forbidden(what: string): ToolResult {
  return {
    summary: `Only organization admins (org:admin) can ${what}.`,
    data: { status: "forbidden" },
    isError: true,
  };
}

function invalid(summary: string, data: Record<string, unknown> = {}) {
  return {
    summary,
    data: { status: "invalid_input", ...data },
    isError: true,
  } satisfies ToolResult;
}

function revalidate(...tags: string[]) {
  for (const tag of tags) {
    try {
      revalidateTag(tag, { expire: 0 });
    } catch (error) {
      console.warn("Cache invalidation warning:", error);
    }
  }
}

function orgInfo(org: OrgContext) {
  return { org_id: org.orgId, name: org.orgName };
}

/**
 * The member a tool should act on: yourself when `requested` is empty, or
 * anyone in the org for an admin.
 */
async function resolveTarget(
  caller: McpCaller,
  org: OrgContext,
  requested?: string,
): Promise<
  | { ok: true; member: OrgMemberInfo; members: OrgMemberInfo[] }
  | { ok: false; result: ToolResult }
> {
  const members = await fetchOrgMembers(org.orgId);
  const res = resolveMemberFromList(
    members,
    caller.userId,
    org.isAdmin,
    requested,
  );
  return res.ok ? { ok: true, member: res.member, members } : res;
}

/* --------------------------------------------------------- schedule -- */

const MAX_SHIFT_NOTE_LENGTH = 500;

function formatShift(
  shift: ScheduledShift & { status?: keyof typeof SHIFT_STATUS_LABELS },
  tz: string,
  names: Map<string, string>,
) {
  const start = new Date(shift.shift_start);
  const end = new Date(shift.shift_end);
  return {
    shift_id: shift.id,
    user_id: shift.user_id,
    member: names.get(shift.user_id) ?? "Unknown member",
    shift_start: start.toISOString(),
    shift_start_local: formatTimestampInTz(start, tz),
    shift_end: end.toISOString(),
    shift_end_local: formatTimestampInTz(end, tz),
    hours: Number(((end.getTime() - start.getTime()) / 3_600_000).toFixed(2)),
    note: shift.note,
    ...(shift.status
      ? {
          status: shift.status,
          status_label: SHIFT_STATUS_LABELS[shift.status],
        }
      : {}),
  };
}

function describeShift(shift: ScheduledShift, tz: string) {
  const start = new Date(shift.shift_start);
  const end = new Date(shift.shift_end);
  return `${formatInTimeZone(start, tz, "EEE, MMM d, h:mm a")} – ${formatInTimeZone(end, tz, "h:mm a zzz")}`;
}

/**
 * Turns a day plus start/end times in `tz` into a shift's start and end. An
 * end at or before the start rolls into the next day (an overnight shift).
 */
export function resolveShiftTimes(
  date: string,
  startTime: string,
  endTime: string,
  tz: string,
): { start: Date; end: Date } | null {
  const start = parseFlexibleDateTime(startTime, tz, date);
  let end = parseFlexibleDateTime(endTime, tz, date);
  if (!start || !end) return null;
  if (end.getTime() <= start.getTime()) end = addDays(end, 1);
  return { start, end };
}

/** The shift's calendar days in `tz`, for the time off check. */
function localDaysOf(start: Date, end: Date, tz: string) {
  return {
    start: formatInTimeZone(start, tz, "yyyy-MM-dd"),
    end: formatInTimeZone(new Date(end.getTime() - 1), tz, "yyyy-MM-dd"),
  };
}

async function timeOffConflict(
  userId: string,
  orgId: string,
  start: Date,
  end: Date,
  tz: string,
) {
  const days = shiftCalendarDays(start, end, localDaysOf(start, end, tz));
  const overlapping = await dbGetApprovedTimeOffForPeriod(
    userId,
    orgId,
    days.start,
    days.end,
  );
  return overlapping[0] ?? null;
}

export async function manageScheduleTool(
  caller: McpCaller,
  input: z.infer<typeof manageScheduleInputSchema>,
): Promise<ToolResult> {
  const orgRes = await resolveOrg(caller.userId, input.org_id);
  if (!orgRes.ok) return orgRes.result;
  const { org } = orgRes;
  if (!(await orgHasPlanFeature(org.orgId, SCHEDULING_FEATURE))) {
    return {
      summary: SCHEDULING_UPGRADE_REASON,
      data: { status: "scheduling_not_enabled" },
      isError: true,
    };
  }
  const tz = validTimezone(input.timezone);
  const action = input.action ?? "list";

  if (action === "list") {
    const targetRes =
      input.member || !org.isAdmin
        ? await resolveTarget(caller, org, input.member)
        : null;
    if (targetRes && !targetRes.ok) return targetRes.result;
    const members = targetRes?.members ?? (await fetchOrgMembers(org.orgId));
    const names = new Map(members.map((m) => [m.userId, m.name]));
    const onlyUserId = targetRes?.member.userId ?? null;

    const now = new Date();
    const rangeStart = input.start_date
      ? (parseFlexibleDateTime("00:00", tz, input.start_date) as Date)
      : startOfDay(subDays(now, SCHEDULE_PAST_DAYS));
    const rangeEnd = input.end_date
      ? addDays(parseFlexibleDateTime("00:00", tz, input.end_date) as Date, 1)
      : startOfDay(addDays(now, SCHEDULE_FUTURE_DAYS + 1));
    const entriesStart = subDays(rangeStart, 1);

    const [shifts, entries] = await Promise.all([
      dbGetScheduledShifts(org.orgId, onlyUserId, rangeStart, rangeEnd),
      onlyUserId
        ? dbGetTimeEntries(onlyUserId, org.orgId, entriesStart, rangeEnd)
        : dbGetOrgTimeEntries(org.orgId, entriesStart, rangeEnd),
    ]);
    const evaluated = evaluateShifts(shifts, entries, now);
    const list = evaluated.map((s) => formatShift(s, tz, names));
    const who = onlyUserId
      ? (names.get(onlyUserId) ?? "this member")
      : "everyone";
    return {
      summary:
        list.length === 0
          ? `No scheduled shifts for ${who} between ${formatInTimeZone(rangeStart, tz, "MMM d")} and ${formatInTimeZone(subDays(rangeEnd, 1), tz, "MMM d")}.`
          : `${list.length} scheduled shift${list.length === 1 ? "" : "s"} for ${who} in ${org.orgName}.`,
      data: {
        organization: orgInfo(org),
        range: {
          start: rangeStart.toISOString(),
          end: rangeEnd.toISOString(),
        },
        shifts: list,
      },
    };
  }

  if (!org.isAdmin) {
    return forbidden("schedule, change, or cancel shifts");
  }

  if (action === "create") {
    if (!input.member || !input.date || !input.start_time || !input.end_time) {
      return invalid(
        "To schedule a shift, pass member, date, start_time and end_time.",
      );
    }
    const targetRes = await resolveTarget(caller, org, input.member);
    if (!targetRes.ok) return targetRes.result;
    const { member, members } = targetRes;
    const times = resolveShiftTimes(
      input.date,
      input.start_time,
      input.end_time,
      tz,
    );
    if (!times) {
      return invalid("Couldn't read the shift's start or end time.");
    }
    const reason = invalidShiftReason(times.start, times.end);
    if (reason) return invalid(reason);
    const note = input.note?.trim() || null;
    if (note && note.length > MAX_SHIFT_NOTE_LENGTH) {
      return invalid("Note is too long (500 characters at most).");
    }
    const conflict = await timeOffConflict(
      member.userId,
      org.orgId,
      times.start,
      times.end,
      tz,
    );
    if (conflict) {
      return {
        summary: `${member.name} has approved time off on ${formatTimeOffDates(conflict)}, so they can't be scheduled then.`,
        data: { status: "time_off_conflict", time_off_request_id: conflict.id },
        isError: true,
      };
    }
    const created = await dbCreateScheduledShift(
      org.orgId,
      member.userId,
      times.start,
      times.end,
      note,
      caller.userId,
    );
    revalidate(`scheduled-shifts-${org.orgId}`);
    await notifyScheduleChange("added", created, tz);
    const names = new Map(members.map((m) => [m.userId, m.name]));
    return {
      summary: `Scheduled ${member.name} for ${describeShift(created, tz)}.`,
      data: {
        status: "created",
        organization: orgInfo(org),
        shift: formatShift(created, tz, names),
      },
    };
  }

  // update / cancel: find the shift.
  let shiftId = input.shift_id;
  if (
    shiftId === undefined &&
    action === "cancel" &&
    input.member &&
    input.date
  ) {
    const targetRes = await resolveTarget(caller, org, input.member);
    if (!targetRes.ok) return targetRes.result;
    const dayStart = parseFlexibleDateTime("00:00", tz, input.date) as Date;
    const sameDay = await dbGetScheduledShifts(
      org.orgId,
      targetRes.member.userId,
      dayStart,
      addDays(dayStart, 1),
    );
    if (sameDay.length !== 1) {
      return invalid(
        sameDay.length === 0
          ? `${targetRes.member.name} has no shift on ${input.date}.`
          : `${targetRes.member.name} has ${sameDay.length} shifts on ${input.date}; pass shift_id to pick one.`,
        {
          shifts: sameDay.map((s) => ({
            shift_id: s.id,
            when: describeShift(s, tz),
          })),
        },
      );
    }
    shiftId = sameDay[0]?.id;
  }
  if (shiftId === undefined) {
    return invalid(
      `Pass shift_id (from action 'list') to ${action} a shift${action === "cancel" ? ", or member and date" : ""}.`,
    );
  }
  const existing = await dbGetScheduledShiftById(shiftId, org.orgId);
  if (!existing) {
    return {
      summary: `Shift ${shiftId} wasn't found in ${org.orgName}.`,
      data: { status: "not_found" },
      isError: true,
    };
  }
  const members = await fetchOrgMembers(org.orgId);
  const names = new Map(members.map((m) => [m.userId, m.name]));
  const memberName = names.get(existing.user_id) ?? "the member";

  if (action === "cancel") {
    const deleted = await dbDeleteScheduledShift(shiftId, org.orgId);
    if (!deleted) {
      return {
        summary: `Shift ${shiftId} wasn't found in ${org.orgName}.`,
        data: { status: "not_found" },
        isError: true,
      };
    }
    revalidate(`scheduled-shifts-${org.orgId}`);
    await notifyScheduleChange("removed", deleted, tz);
    return {
      summary: `Cancelled ${memberName}'s shift on ${describeShift(deleted, tz)}.`,
      data: {
        status: "cancelled",
        organization: orgInfo(org),
        shift: formatShift(deleted, tz, names),
      },
    };
  }

  // update
  const oldStart = new Date(existing.shift_start);
  const oldEnd = new Date(existing.shift_end);
  if (
    input.date === undefined &&
    input.start_time === undefined &&
    input.end_time === undefined &&
    input.note === undefined
  ) {
    return invalid(
      "Nothing to change. Pass date, start_time, end_time and/or note.",
    );
  }
  const times = resolveShiftTimes(
    input.date ?? formatInTimeZone(oldStart, tz, "yyyy-MM-dd"),
    input.start_time ?? formatInTimeZone(oldStart, tz, "HH:mm"),
    input.end_time ?? formatInTimeZone(oldEnd, tz, "HH:mm"),
    tz,
  );
  if (!times) {
    return invalid("Couldn't read the shift's start or end time.");
  }
  const reason = invalidShiftReason(times.start, times.end);
  if (reason) return invalid(reason);
  const note =
    input.note === undefined ? existing.note : input.note?.trim() || null;
  if (note && note.length > MAX_SHIFT_NOTE_LENGTH) {
    return invalid("Note is too long (500 characters at most).");
  }
  const conflict = await timeOffConflict(
    existing.user_id,
    org.orgId,
    times.start,
    times.end,
    tz,
  );
  if (conflict) {
    return {
      summary: `${memberName} has approved time off on ${formatTimeOffDates(conflict)}, so the shift can't move there.`,
      data: { status: "time_off_conflict", time_off_request_id: conflict.id },
      isError: true,
    };
  }
  const updated = await dbUpdateScheduledShift(
    shiftId,
    org.orgId,
    times.start,
    times.end,
    note,
  );
  if (!updated) {
    return {
      summary: `Shift ${shiftId} wasn't found in ${org.orgName}.`,
      data: { status: "not_found" },
      isError: true,
    };
  }
  revalidate(`scheduled-shifts-${org.orgId}`);
  await notifyScheduleChange("changed", updated, tz);
  return {
    summary: `Updated ${memberName}'s shift: now ${describeShift(updated, tz)}.`,
    data: {
      status: "updated",
      organization: orgInfo(org),
      previous: formatShift(existing, tz, names),
      shift: formatShift(updated, tz, names),
    },
  };
}

/* --------------------------------------------------------- time off -- */

const TIME_OFF_LOOKBACK_DAYS = 400;

function formatTimeOff(request: TimeOffRequest, names: Map<string, string>) {
  return {
    request_id: request.id,
    user_id: request.user_id,
    member: names.get(request.user_id) ?? "Unknown member",
    type: request.request_type,
    type_label: TIME_OFF_TYPE_LABELS[request.request_type],
    start_date: request.start_date,
    end_date: request.end_date,
    dates: formatTimeOffDates(request),
    hours_per_day: Number(request.hours_per_day),
    total_hours: timeOffHoursInRange(request),
    note: request.note,
    status: request.status,
    status_label: TIME_OFF_STATUS_LABELS[request.status],
    reviewed_by: request.reviewed_by
      ? (names.get(request.reviewed_by) ?? request.reviewed_by)
      : null,
  };
}

export async function manageTimeOffTool(
  caller: McpCaller,
  input: z.infer<typeof manageTimeOffInputSchema>,
): Promise<ToolResult> {
  const orgRes = await resolveOrg(caller.userId, input.org_id);
  if (!orgRes.ok) return orgRes.result;
  const { org } = orgRes;
  if (!(await orgHasPlanFeature(org.orgId, TIME_OFF_FEATURE))) {
    return {
      summary: TIME_OFF_UPGRADE_REASON,
      data: { status: "time_off_not_enabled" },
      isError: true,
    };
  }
  const action = input.action ?? "list";
  const members = await fetchOrgMembers(org.orgId);
  const names = new Map(members.map((m) => [m.userId, m.name]));

  if (action === "list") {
    let onlyUserId: string | null = org.isAdmin ? null : caller.userId;
    if (input.member) {
      const res = resolveMemberFromList(
        members,
        caller.userId,
        org.isAdmin,
        input.member,
      );
      if (!res.ok) return res.result;
      onlyUserId = res.member.userId;
    }
    const since =
      input.start_date ??
      format(subDays(new Date(), TIME_OFF_LOOKBACK_DAYS), "yyyy-MM-dd");
    const requests = (
      await dbGetTimeOffRequests(org.orgId, null, since)
    ).filter(
      (r) =>
        (onlyUserId === null || r.user_id === onlyUserId) &&
        (!input.status || r.status === input.status),
    );
    const pending = requests.filter((r) => r.status === "pending").length;
    return {
      summary:
        requests.length === 0
          ? "No time off requests found."
          : `${requests.length} time off request${requests.length === 1 ? "" : "s"} (${pending} waiting for approval).`,
      data: {
        organization: orgInfo(org),
        requests: requests.map((r) => formatTimeOff(r, names)),
      },
    };
  }

  if (action === "request") {
    const res = resolveMemberFromList(
      members,
      caller.userId,
      org.isAdmin,
      input.member,
    );
    if (!res.ok) return res.result;
    const target = res.member;
    const forSomeoneElse = target.userId !== caller.userId;
    const approve = input.approve ?? (org.isAdmin && forSomeoneElse);
    if (approve && !org.isAdmin) {
      return forbidden("approve time off");
    }
    if (!input.start_date) {
      return invalid("Pass start_date (and end_date for more than one day).");
    }
    const type = input.type ?? "vacation";
    const endDate = input.end_date ?? input.start_date;
    const hoursPerDay = input.hours_per_day ?? DEFAULT_TIME_OFF_HOURS_PER_DAY;
    const reason = invalidTimeOffReason({
      type,
      startDate: input.start_date,
      endDate,
      hoursPerDay,
    });
    if (reason) return invalid(reason);
    const note = input.note?.trim() || null;
    if (note && note.length > MAX_TIME_OFF_NOTE_LENGTH) {
      return invalid("Note is too long (500 characters at most).");
    }
    const created = await dbCreateTimeOffRequest(
      org.orgId,
      target.userId,
      type,
      input.start_date,
      endDate,
      hoursPerDay,
      note,
      approve ? caller.userId : null,
    );
    if (!created) {
      return {
        summary: `${forSomeoneElse ? `${target.name} already has` : "You already have"} pending or approved time off on those dates.`,
        data: { status: "overlapping_time_off" },
        isError: true,
      };
    }
    revalidate(`time-off-${org.orgId}`);
    return {
      summary: `${approve ? "Added approved" : "Requested"} ${TIME_OFF_TYPE_LABELS[type].toLowerCase()} for ${forSomeoneElse ? target.name : "you"} on ${formatTimeOffDates(created)}.`,
      data: {
        status: approve ? "approved" : "pending",
        organization: orgInfo(org),
        request: formatTimeOff(created, names),
      },
    };
  }

  if (input.request_id === undefined) {
    return invalid(`Pass request_id (from action 'list') to ${action} it.`);
  }

  if (action === "approve" || action === "deny") {
    if (!org.isAdmin) return forbidden("approve or deny time off");
    const decision: Extract<TimeOffStatus, "approved" | "denied"> =
      action === "approve" ? "approved" : "denied";
    const updated = await dbReviewTimeOffRequest(
      input.request_id,
      org.orgId,
      decision,
      caller.userId,
    );
    if (!updated) {
      return {
        summary: `Request ${input.request_id} wasn't found or isn't pending.`,
        data: { status: "not_found_or_reviewed" },
        isError: true,
      };
    }
    revalidate(`time-off-${org.orgId}`);
    return {
      summary: `${decision === "approved" ? "Approved" : "Denied"} ${names.get(updated.user_id) ?? "the member"}'s ${TIME_OFF_TYPE_LABELS[updated.request_type].toLowerCase()} on ${formatTimeOffDates(updated)}.`,
      data: {
        status: decision,
        organization: orgInfo(org),
        request: formatTimeOff(updated, names),
      },
    };
  }

  // cancel
  const cancelled = await dbCancelTimeOffRequest(
    input.request_id,
    org.orgId,
    caller.userId,
    org.isAdmin,
  );
  if (!cancelled) {
    return {
      summary: org.isAdmin
        ? `Request ${input.request_id} wasn't found or is already denied or cancelled.`
        : `Request ${input.request_id} wasn't found or can't be cancelled (members can only withdraw their own pending requests).`,
      data: { status: "not_found_or_not_cancellable" },
      isError: true,
    };
  }
  revalidate(`time-off-${org.orgId}`);
  return {
    summary: `Cancelled ${names.get(cancelled.user_id) ?? "the member"}'s ${TIME_OFF_TYPE_LABELS[cancelled.request_type].toLowerCase()} on ${formatTimeOffDates(cancelled)}.`,
    data: {
      status: "cancelled",
      organization: orgInfo(org),
      request: formatTimeOff(cancelled, names),
    },
  };
}

/* --------------------------------------------------------- overtime -- */

export async function manageOvertimeSettingsTool(
  caller: McpCaller,
  input: z.infer<typeof manageOvertimeSettingsInputSchema>,
): Promise<ToolResult> {
  const orgRes = await resolveOrg(caller.userId, input.org_id);
  if (!orgRes.ok) return orgRes.result;
  const { org } = orgRes;

  const current = await dbGetOvertimeSettings(org.orgId);
  const settings = {
    daily_threshold_hours:
      current?.daily_threshold_hours == null
        ? null
        : Number(current.daily_threshold_hours),
    weekly_threshold_hours:
      current?.weekly_threshold_hours == null
        ? null
        : Number(current.weekly_threshold_hours),
  };

  if ((input.action ?? "get") === "get") {
    return {
      summary: `Overtime for ${org.orgName}: ${describeOvertime(settings)}.`,
      data: { organization: orgInfo(org), settings },
    };
  }
  if (!org.isAdmin) return forbidden("change overtime settings");
  if (
    input.daily_threshold_hours === undefined &&
    input.weekly_threshold_hours === undefined
  ) {
    return invalid(
      "Nothing to update. Pass daily_threshold_hours and/or weekly_threshold_hours (null turns one off).",
    );
  }
  const daily =
    input.daily_threshold_hours === undefined
      ? settings.daily_threshold_hours
      : input.daily_threshold_hours;
  const weekly =
    input.weekly_threshold_hours === undefined
      ? settings.weekly_threshold_hours
      : input.weekly_threshold_hours;
  if (
    !isValidOvertimeThreshold(daily, MAX_DAILY_OVERTIME_HOURS) ||
    !isValidOvertimeThreshold(weekly, MAX_WEEKLY_OVERTIME_HOURS)
  ) {
    return invalid("Invalid overtime thresholds.");
  }
  const updated = await dbUpdateOvertimeSettings(org.orgId, daily, weekly);
  revalidate(`overtime-settings-${org.orgId}`);
  const next = {
    daily_threshold_hours: updated.daily_threshold_hours,
    weekly_threshold_hours: updated.weekly_threshold_hours,
  };
  return {
    summary: `Updated overtime for ${org.orgName}: ${describeOvertime(next)}.`,
    data: { status: "updated", organization: orgInfo(org), settings: next },
  };
}

/* ------------------------------------------------------------ alerts -- */

function describeAlerts(s: AlertSettingsInput) {
  const parts = [
    s.forgot_clock_out_enabled
      ? `forgot-to-clock-out reminder after ${s.forgot_clock_out_hours}h`
      : null,
    s.auto_clock_out_enabled
      ? `automatic clock-out after ${s.auto_clock_out_hours}h`
      : null,
    s.break_reminder_enabled
      ? `break reminder after ${s.break_reminder_minutes} min`
      : null,
  ].filter(Boolean);
  return `${parts.length ? parts.join(", ") : "no shift alerts on"}; admins ${s.notify_admins ? "are" : "are not"} copied; schedule notices ${s.schedule_notifications ? "on" : "off"}`;
}

const ALERT_FIELDS = [
  "forgot_clock_out_enabled",
  "forgot_clock_out_hours",
  "auto_clock_out_enabled",
  "auto_clock_out_hours",
  "break_reminder_enabled",
  "break_reminder_minutes",
  "notify_admins",
  "schedule_notifications",
] as const satisfies readonly (keyof AlertSettingsInput)[];

export async function manageAlertSettingsTool(
  caller: McpCaller,
  input: z.infer<typeof manageAlertSettingsInputSchema>,
): Promise<ToolResult> {
  const orgRes = await resolveOrg(caller.userId, input.org_id);
  if (!orgRes.ok) return orgRes.result;
  const { org } = orgRes;

  const current = normalizeAlertSettings(await dbGetAlertSettings(org.orgId));
  if ((input.action ?? "get") === "get") {
    return {
      summary: `Alert rules for ${org.orgName}: ${describeAlerts(current)}.`,
      data: { organization: orgInfo(org), settings: current },
    };
  }
  if (!org.isAdmin) return forbidden("change alert settings");
  if (ALERT_FIELDS.every((field) => input[field] === undefined)) {
    return invalid(
      `Nothing to update. Pass any of: ${ALERT_FIELDS.join(", ")}.`,
    );
  }
  const next: AlertSettingsInput = { ...current };
  for (const field of ALERT_FIELDS) {
    const value = input[field];
    if (value !== undefined) {
      (next as Record<string, unknown>)[field] = value;
    }
  }
  const reason = validateAlertSettings(next);
  if (reason) return invalid(reason);
  const updated = normalizeAlertSettings(
    await dbUpdateAlertSettings(org.orgId, next),
  );
  revalidate(`alert-settings-${org.orgId}`);
  return {
    summary: `Updated alert rules for ${org.orgName}: ${describeAlerts(updated)}.`,
    data: { status: "updated", organization: orgInfo(org), settings: updated },
  };
}

/* ---------------------------------------------------------- location -- */

const DEFAULT_SITE_RADIUS_METERS = 150;

function formatSite(site: SiteData) {
  return {
    site_id: site.id,
    name: site.name,
    address: site.address ?? null,
    latitude: Number(site.latitude),
    longitude: Number(site.longitude),
    radius_meters: Number(site.radius_meters),
  };
}

/** Coordinates from the input, or looked up from its address. */
async function siteCoordinates(input: {
  address?: string;
  latitude?: number;
  longitude?: number;
}): Promise<
  | { ok: true; latitude: number; longitude: number; address: string | null }
  | { ok: false; result: ToolResult }
> {
  if (input.latitude !== undefined && input.longitude !== undefined) {
    let address = input.address?.trim() || null;
    if (!address) {
      address = await reverseGeocode({
        latitude: input.latitude,
        longitude: input.longitude,
      }).catch(() => null);
    }
    return {
      ok: true,
      latitude: input.latitude,
      longitude: input.longitude,
      address,
    };
  }
  if (input.address?.trim()) {
    const [match] = await searchAddress(input.address).catch(() => []);
    if (!match) {
      return {
        ok: false,
        result: invalid(
          `Couldn't find the address "${input.address}". Check it or pass latitude and longitude.`,
        ),
      };
    }
    return {
      ok: true,
      latitude: match.latitude,
      longitude: match.longitude,
      address: match.formatted,
    };
  }
  return {
    ok: false,
    result: invalid("Pass the site's address, or latitude and longitude."),
  };
}

export async function manageLocationSettingsTool(
  caller: McpCaller,
  input: z.infer<typeof manageLocationSettingsInputSchema>,
): Promise<ToolResult> {
  const orgRes = await resolveOrg(caller.userId, input.org_id);
  if (!orgRes.ok) return orgRes.result;
  const { org } = orgRes;
  const action = input.action ?? "get";

  const view = async (summaryPrefix: string, status?: string) => {
    const [settings, sites] = await Promise.all([
      dbGetLocationSettings(org.orgId),
      dbGetSites(org.orgId),
    ]);
    const captureMode = settings?.capture_mode ?? "off";
    const restrict = settings?.restrict_clock_in ?? false;
    return {
      summary: `${summaryPrefix}Location capture for ${org.orgName} is ${captureMode}${restrict ? ", clock-in restricted to approved sites" : ""}; ${sites.length} work site${sites.length === 1 ? "" : "s"}.`,
      data: {
        ...(status ? { status } : {}),
        organization: orgInfo(org),
        settings: { capture_mode: captureMode, restrict_clock_in: restrict },
        sites: sites.map(formatSite),
      },
    } satisfies ToolResult;
  };

  if (action === "get") return view("");

  if (!org.isAdmin) return forbidden("change location settings or work sites");
  if (!(await orgHasPlanFeature(org.orgId, "geofencing"))) {
    return {
      summary:
        "Location and geofence settings need a Clock Out plan that includes Geofencing.",
      data: { status: "geofencing_not_enabled" },
      isError: true,
    };
  }

  if (action === "update") {
    if (
      input.capture_mode === undefined &&
      input.restrict_clock_in === undefined
    ) {
      return invalid(
        "Nothing to update. Pass capture_mode and/or restrict_clock_in.",
      );
    }
    const current = await dbGetLocationSettings(org.orgId);
    await dbUpdateLocationSettings(
      org.orgId,
      input.capture_mode ?? current?.capture_mode ?? "off",
      input.restrict_clock_in ?? current?.restrict_clock_in ?? false,
    );
    revalidate(`location-settings-${org.orgId}`);
    return view("Updated. ", "updated");
  }

  if (action === "add_site") {
    const name = input.name?.trim();
    if (!name) return invalid("Pass a name for the new site.");
    const coords = await siteCoordinates(input);
    if (!coords.ok) return coords.result;
    const site = await dbCreateSite(
      org.orgId,
      name,
      coords.latitude,
      coords.longitude,
      input.radius_meters ?? DEFAULT_SITE_RADIUS_METERS,
      coords.address,
    );
    revalidate(`sites-${org.orgId}`, `location-settings-${org.orgId}`);
    return {
      summary: `Added work site "${site.name}"${site.address ? ` at ${site.address}` : ""} with a ${Number(site.radius_meters)} m radius.`,
      data: {
        status: "created",
        organization: orgInfo(org),
        site: formatSite(site),
      },
    };
  }

  if (input.site_id === undefined) {
    return invalid("Pass site_id (from action 'get').");
  }
  const sites = await dbGetSites(org.orgId);
  const existing = sites.find((s) => s.id === input.site_id);
  if (!existing) {
    return {
      summary: `Site ${input.site_id} wasn't found in ${org.orgName}.`,
      data: { status: "not_found" },
      isError: true,
    };
  }

  if (action === "delete_site") {
    await dbDeleteSite(existing.id, org.orgId);
    revalidate(`sites-${org.orgId}`);
    return {
      summary: `Deleted work site "${existing.name}".`,
      data: {
        status: "deleted",
        organization: orgInfo(org),
        site: formatSite(existing),
      },
    };
  }

  // update_site
  const movesSite =
    input.address !== undefined ||
    (input.latitude !== undefined && input.longitude !== undefined);
  let latitude = Number(existing.latitude);
  let longitude = Number(existing.longitude);
  let address = existing.address ?? null;
  if (movesSite) {
    const coords = await siteCoordinates(input);
    if (!coords.ok) return coords.result;
    ({ latitude, longitude, address } = coords);
  }
  const name = input.name?.trim() || existing.name;
  const updated = await dbUpdateSite(
    existing.id,
    org.orgId,
    name,
    latitude,
    longitude,
    input.radius_meters ?? Number(existing.radius_meters),
    address,
  );
  revalidate(`sites-${org.orgId}`);
  return {
    summary: `Updated work site "${updated?.name ?? name}".`,
    data: {
      status: "updated",
      organization: orgInfo(org),
      site: updated ? formatSite(updated) : null,
    },
  };
}

/* ----------------------------------------------------------- members -- */

/**
 * Change a member's role or remove them, as admins can from the app's
 * organization settings. An admin can't change or remove themselves here,
 * so an organization is never left without an admin by accident.
 */
export async function manageMemberTool(
  caller: McpCaller,
  input: z.infer<typeof manageMemberInputSchema>,
): Promise<ToolResult> {
  const orgRes = await resolveOrg(caller.userId, input.org_id);
  if (!orgRes.ok) return orgRes.result;
  const { org } = orgRes;
  if (!org.isAdmin) return forbidden("change roles or remove members");

  const targetRes = await resolveTarget(caller, org, input.member);
  if (!targetRes.ok) return targetRes.result;
  const { member } = targetRes;
  if (member.userId === caller.userId) {
    return invalid(
      "You can't change your own role or remove yourself here. Ask another admin, or do it in the Clock Out app.",
    );
  }

  const client = await clerkClient();
  if (input.action === "remove") {
    await client.organizations.deleteOrganizationMembership({
      organizationId: org.orgId,
      userId: member.userId,
    });
    return {
      summary: `Removed ${member.name} from ${org.orgName}. Their recorded hours are kept.`,
      data: {
        status: "removed",
        organization: orgInfo(org),
        member: { user_id: member.userId, name: member.name },
      },
    };
  }

  if (!input.role) return invalid("Pass role: 'org:admin' or 'org:member'.");
  const role =
    input.role === "admin" || input.role === "org:admin"
      ? "org:admin"
      : "org:member";
  if (member.role === role) {
    return {
      summary: `${member.name} is already ${role === "org:admin" ? "an admin" : "a member"}.`,
      data: { status: "unchanged", role },
    };
  }
  await client.organizations.updateOrganizationMembership({
    organizationId: org.orgId,
    userId: member.userId,
    role,
  });
  return {
    summary: `${member.name} is now ${role === "org:admin" ? "an admin" : "a regular member"} of ${org.orgName}.`,
    data: {
      status: "updated",
      organization: orgInfo(org),
      member: { user_id: member.userId, name: member.name, role },
    },
  };
}
