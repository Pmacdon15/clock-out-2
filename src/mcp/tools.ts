import { clerkClient } from "@clerk/nextjs/server";
import {
  addDays,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  startOfDay,
  startOfWeek,
  subDays,
} from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { z } from "zod";
import {
  breakTypeLabel,
  DEFAULT_BREAK_TYPE,
  getBreakDurationMs,
  getEffectiveDurationMs,
  getOpenBreak,
  getPaidBreakMs,
  getUnpaidBreakMs,
  isBreakType,
  isPaidBreakType,
  validateBreak,
} from "@/lib/break-utils";
import { fetchAllPages } from "@/lib/clerk-pagination";
import {
  findMatchingSite,
  findNearestSite,
  formatMeters,
  isCaptureEnabled,
  isLocationRequired,
  isRestricted,
  isValidCoordinates,
  type SiteLike,
  type StoredLocation,
} from "@/lib/geo";
import { reverseGeocode, searchAddress } from "@/lib/geoapify";
import { loadPdfImage } from "@/lib/pdf-image";
import { orgHasReportingFeature, sendWeeklyReports } from "@/lib/reports";
import {
  buildEmployeeSummary,
  buildExportRows,
  buildPeriodSections,
  CSV_MIME,
  type ExportFormat,
  type ExportGrouping,
  type ExportMeta,
  exportFileName,
  formatHours,
  formatPeriod,
  toCsv,
  toPdf,
  totalHours,
  toXlsx,
  XLSX_MIME,
} from "@/lib/timesheet-export";
import type {
  BreakType,
  LocationSettingsData,
  SiteData,
  TimeEntry,
  TimeEntryBreak,
} from "@/lib/types";
import { isOverMemberShipLimit } from "@/lib/utils-clerk";
import {
  dbClockInAt,
  dbClockOutAt,
  dbDeleteBreak,
  dbDeleteTimeEntry,
  dbEndOpenBreak,
  dbFindOverlappingTimeEntries,
  dbGetActiveEntry,
  dbGetBreakSettings,
  dbGetBreakWithEntry,
  dbGetEntryBreaks,
  dbGetLocationSettings,
  dbGetOrgActiveEntries,
  dbGetOrgTimeEntries,
  dbGetReportingSettings,
  dbGetSites,
  dbGetTimeEntries,
  dbGetTimeEntryById,
  dbInsertBreak,
  dbInsertTimeEntry,
  dbStartBreak,
  dbUpdateBreak,
  dbUpdateBreakSettings,
  dbUpdateReportingSettings,
  dbUpdateTimeEntry,
  invalidateBreakSettingsCache,
  invalidateReportingSettingsCache,
  invalidateTimeEntryCache,
} from "@/mcp/db";

export type McpCaller = {
  userId: string;
  client: string | null;
};

export type ToolResource = {
  uri: string;
  mimeType: string;
  blob: string;
};

export type ToolResult = {
  summary: string;
  data: Record<string, unknown>;
  resource?: ToolResource;
  resources?: ToolResource[];
  isError?: boolean;
};

const DEFAULT_TIMEZONE = "America/Edmonton";

/*
 * ============================================================================
 * Zod Input Schemas (wrapped with `portable()` in `src/mcp/server.ts`)
 * ============================================================================
 */

const orgIdField = z
  .string()
  .optional()
  .describe(
    "Organization ID (org_...), slug, or name. Optional if the user only belongs to one organization.",
  );

const memberField = z
  .string()
  .optional()
  .describe(
    "Target member's user_id (user_...), full/first name, or email. Omit to act on yourself. Admins can specify any member in the organization.",
  );

const timezoneField = z
  .string()
  .optional()
  .describe(
    "IANA timezone name (e.g. 'America/Edmonton', 'America/Toronto', 'UTC'). Defaults to 'America/Edmonton'.",
  );

export const listOrganizationsInputSchema = z.object({});

export const listMembersInputSchema = z.object({
  org_id: orgIdField,
});

export const whoIsWorkingInputSchema = z.object({
  org_id: orgIdField,
  timezone: timezoneField,
});

export const getClockStatusInputSchema = z.object({
  org_id: orgIdField,
  member: memberField,
  timezone: timezoneField,
});

const siteField = z
  .string()
  .optional()
  .describe(
    "Work site name or address. Required if the organization requires location capture and no other location is provided.",
  );

const addressField = z
  .string()
  .optional()
  .describe(
    "Optional street address or location name to record with the punch. Required if the organization requires location and no site or coordinates are given.",
  );

const latitudeField = z
  .number()
  .optional()
  .describe("Optional latitude coordinate of the punch location.");

const longitudeField = z
  .number()
  .optional()
  .describe("Optional longitude coordinate of the punch location.");

const accuracyField = z
  .number()
  .optional()
  .describe("Optional accuracy in meters.");

export const clockInInputSchema = z.object({
  org_id: orgIdField,
  member: memberField,
  clock_in: z
    .string()
    .optional()
    .describe(
      "Optional ISO 8601 or 'YYYY-MM-DD HH:mm' start time if clocking in as of a specific time. Defaults to right now.",
    ),
  site: siteField,
  address: addressField,
  latitude: latitudeField,
  longitude: longitudeField,
  accuracy: accuracyField,
  timezone: timezoneField,
});

export const clockOutInputSchema = z.object({
  org_id: orgIdField,
  member: memberField,
  clock_out: z
    .string()
    .optional()
    .describe(
      "Optional ISO 8601 or 'YYYY-MM-DD HH:mm' end time if clocking out as of a specific time. Defaults to right now.",
    ),
  site: siteField,
  address: addressField,
  latitude: latitudeField,
  longitude: longitudeField,
  accuracy: accuracyField,
  timezone: timezoneField,
});

export const getLocationSettingsInputSchema = z.object({
  org_id: orgIdField,
});

const singleShiftInputSchema = z.object({
  member: z
    .string()
    .optional()
    .describe(
      "Member name, email, or user_id for this specific shift (overrides top-level member if provided).",
    ),
  date: z
    .string()
    .optional()
    .describe(
      "Shift date as YYYY-MM-DD (used when clock_in/clock_out are given as HH:mm or 9:00 AM, or when hours_worked is provided).",
    ),
  clock_in: z
    .string()
    .optional()
    .describe(
      "Clock-in time as ISO 8601 ('2026-10-26T09:00:00'), 'YYYY-MM-DD HH:mm', or time of day ('09:00' / '9:00 AM' when date is set).",
    ),
  clock_out: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Clock-out time as ISO 8601, 'YYYY-MM-DD HH:mm', or time of day ('17:00' / '5:00 PM' when date is set). Omit or null if only hours_worked is given or if starting an active shift.",
    ),
  hours_worked: z
    .number()
    .positive()
    .optional()
    .describe(
      "If a timecard image only lists total hours for a date (e.g. 8 or 7.5) without start/end times, provide date + hours_worked (starts at 09:00 local time unless clock_in is also given).",
    ),
});

export const addTimeEntryInputSchema = z.object({
  org_id: orgIdField,
  member: memberField,
  timezone: timezoneField,
  date: z
    .string()
    .optional()
    .describe("Shift date as YYYY-MM-DD (for a single shift)."),
  clock_in: z
    .string()
    .optional()
    .describe(
      "Clock-in time for a single shift (ISO 8601, 'YYYY-MM-DD HH:mm', or '09:00'/'9:00 AM' with date).",
    ),
  clock_out: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Clock-out time for a single shift (ISO 8601, 'YYYY-MM-DD HH:mm', or '17:00'/'5:00 PM' with date).",
    ),
  hours_worked: z
    .number()
    .positive()
    .optional()
    .describe(
      "Total hours worked for a single shift when only date + duration are known (e.g. from a weekly timecard photo).",
    ),
  entries: z
    .array(singleShiftInputSchema)
    .optional()
    .describe(
      "Batch of multiple shifts to add at once (e.g. extracted from a photo/image of a weekly timecard). Every shift is checked to prevent double or overlapping times.",
    ),
});

export const listTimeEntriesInputSchema = z.object({
  org_id: orgIdField,
  member: z
    .string()
    .optional()
    .describe(
      "Filter by a specific member (name, email, or user_id), or pass 'all' (admins only) to list entries for everyone in the organization. Defaults to yourself (or 'all' if you are an admin and ask for org entries).",
    ),
  start_date: z
    .string()
    .optional()
    .describe(
      "Start date (YYYY-MM-DD or ISO timestamp). Defaults to 7 days ago.",
    ),
  end_date: z
    .string()
    .optional()
    .describe("End date (YYYY-MM-DD or ISO timestamp). Defaults to today."),
  timezone: timezoneField,
});

export const getWeeklyTimecardInputSchema = z.object({
  org_id: orgIdField,
  member: z
    .string()
    .optional()
    .describe(
      "Target member (name, email, or user_id), or 'all' (admins only) to see the weekly timecard and hours for everyone in the organization. Admins default to 'all'; members default to themselves.",
    ),
  week_of: z
    .string()
    .optional()
    .describe(
      "Any YYYY-MM-DD date within the target 7-day Monday–Sunday week. Ignored if start_date/end_date or year/month/week are given.",
    ),
  start_date: z
    .string()
    .optional()
    .describe("Explicit period start date (YYYY-MM-DD)."),
  end_date: z
    .string()
    .optional()
    .describe("Explicit period inclusive end date (YYYY-MM-DD)."),
  year: z
    .number()
    .int()
    .optional()
    .describe(
      "Year (e.g. 2026) when using Clock Out's month-week 1–4 selector.",
    ),
  month: z
    .number()
    .int()
    .min(1)
    .max(12)
    .optional()
    .describe(
      "Month 1–12 (e.g. 10 for October) when using Clock Out's month-week 1–4 selector.",
    ),
  week: z
    .number()
    .int()
    .min(1)
    .max(4)
    .optional()
    .describe(
      "Clock Out month-week number (1 = days 1–7, 2 = days 8–14, 3 = days 15–21, 4 = day 22 to end of month).",
    ),
  timezone: timezoneField,
});

export const exportTimesheetInputSchema = z.object({
  org_id: orgIdField,
  member: z
    .string()
    .optional()
    .describe(
      "Target member (name, email, or user_id), or 'all' (admins only) to export a timesheet for everyone in the organization. Admins default to 'all'; regular members default to themselves.",
    ),
  format: z
    .enum(["pdf", "xlsx", "csv"])
    .optional()
    .describe(
      "Preferred file format ('pdf', 'xlsx', or 'csv'). Note: export_timesheet always provides download links for the PDF, the Excel spreadsheet (.xlsx) and the flat CSV.",
    ),
  group_by: z
    .enum(["auto", "week", "month", "none"])
    .optional()
    .describe(
      "How to group shifts and subtotal rows in the exported PDF and spreadsheet: 'week' (weekly sections with subtotals), 'month' (monthly sections with subtotals), 'none' (flat list), or 'auto' (default: groups by week or month based on date range). The CSV is always a flat table; grouping only changes its subtotal rows.",
    ),
  week_of: z
    .string()
    .optional()
    .describe(
      "Any YYYY-MM-DD date within the target 7-day Monday–Sunday week. Ignored if start_date/end_date or year/month/week are given.",
    ),
  start_date: z
    .string()
    .optional()
    .describe("Explicit period start date (YYYY-MM-DD)."),
  end_date: z
    .string()
    .optional()
    .describe("Explicit period inclusive end date (YYYY-MM-DD)."),
  year: z
    .number()
    .int()
    .optional()
    .describe(
      "Year (e.g. 2026) when exporting a full month (year + month) or Clock Out's month-week 1–4 selector (year + month + week).",
    ),
  month: z
    .number()
    .int()
    .min(1)
    .max(12)
    .optional()
    .describe(
      "Month 1–12 (e.g. 10 for October) when exporting a full month or Clock Out's month-week 1–4 selector.",
    ),
  week: z
    .number()
    .int()
    .min(1)
    .max(4)
    .optional()
    .describe(
      "Optional Clock Out month-week number (1 = days 1–7, 2 = days 8–14, 3 = days 15–21, 4 = day 22 to end of month). Omit when year + month are set to export the entire month.",
    ),
  timezone: timezoneField,
});

export const updateTimeEntryInputSchema = z.object({
  org_id: orgIdField,
  entry_id: z
    .number()
    .int()
    .optional()
    .describe(
      "The numeric ID of the time entry to update (from list_time_entries or get_weekly_timecard). Can be omitted if member/self + date uniquely identify a single entry on that day.",
    ),
  member: memberField,
  date: z
    .string()
    .optional()
    .describe(
      "Date of the shift as YYYY-MM-DD (used to locate the entry if entry_id is omitted, and to resolve time-of-day strings like '09:00').",
    ),
  clock_in: z
    .string()
    .optional()
    .describe(
      "New clock-in time (ISO 8601, 'YYYY-MM-DD HH:mm', or '09:00'/'9:00 AM' when date is known).",
    ),
  clock_out: z
    .string()
    .nullable()
    .optional()
    .describe(
      "New clock-out time (ISO 8601, 'YYYY-MM-DD HH:mm', '17:00'/'5:00 PM', or null to leave the shift open/active).",
    ),
  hours_worked: z
    .number()
    .positive()
    .optional()
    .describe(
      "Alternatively, set the shift's total hours worked (adjusts clock_out relative to clock_in).",
    ),
  skip_lunch: z
    .boolean()
    .optional()
    .describe(
      "Set to true to mark this shift as 'Skipped lunch / break (do not dock)' so automatic lunch deduction is not subtracted, or false to allow automatic lunch deduction.",
    ),
  timezone: timezoneField,
});

export const deleteTimeEntryInputSchema = z.object({
  org_id: orgIdField,
  entry_id: z
    .number()
    .int()
    .describe("The numeric ID of the time entry to delete."),
});

export const toggleBreakInputSchema = z.object({
  org_id: orgIdField,
  member: memberField,
  action: z
    .enum(["toggle", "start", "end"])
    .optional()
    .describe(
      "Action to perform on the active shift's break: 'toggle' (starts a break if none is running, or ends the running break if one is open; default), 'start' (starts a break of break_type), or 'end' (ends the currently running break).",
    ),
  break_type: z
    .enum(["unpaid_meal", "unpaid_rest", "paid_rest"])
    .optional()
    .describe(
      "Kind of break when starting a break (one of the 3 supported kinds): 'unpaid_meal' (Meal period — unpaid, deducted from hours; default), 'unpaid_rest' (Unpaid rest break — unpaid, deducted from hours), or 'paid_rest' (Paid rest break — paid, recorded for compliance and not deducted).",
    ),
  timezone: timezoneField,
});

export const manageBreaksInputSchema = z.object({
  org_id: orgIdField,
  action: z
    .enum(["add", "update", "delete", "list", "start", "end", "toggle"])
    .optional()
    .describe(
      "Action to perform: 'add' (admin: add a break of one of the 3 kinds — 'unpaid_meal', 'unpaid_rest', or 'paid_rest' — to a shift), 'update' (admin: edit an existing break's break_type, break_start, break_end, or duration_minutes), 'delete' (admin: remove a break), 'list' (list breaks recorded on a shift), or 'start'/'end'/'toggle' (start, end, or toggle a live break on an active shift). Defaults to 'list'.",
    ),
  break_id: z
    .number()
    .int()
    .optional()
    .describe(
      "Numeric ID of the break record to update or delete (from list_time_entries, get_weekly_timecard, or manage_breaks). Optional if entry_id or member + date identifies a shift with a single break.",
    ),
  entry_id: z
    .number()
    .int()
    .optional()
    .describe(
      "Numeric ID of the time entry (shift) to add a break to, list breaks for, or locate a single break on. Optional if member + date (or an active shift) identifies the shift.",
    ),
  member: memberField,
  date: z
    .string()
    .optional()
    .describe(
      "Shift date as YYYY-MM-DD (used to locate the time entry when entry_id is omitted, and to resolve time-of-day strings like '12:00' or '12:30 PM').",
    ),
  break_type: z
    .enum(["unpaid_meal", "unpaid_rest", "paid_rest"])
    .optional()
    .describe(
      "Break kind (one of the 3 supported kinds): 'unpaid_meal' (Meal period — unpaid, deducted from hours; default when adding/starting), 'unpaid_rest' (Unpaid rest break — unpaid, deducted from hours), or 'paid_rest' (Paid rest break — paid, recorded for compliance and not deducted).",
    ),
  break_start: z
    .string()
    .optional()
    .describe(
      "Break start time as ISO 8601, 'YYYY-MM-DD HH:mm', or time of day ('12:00' / '12:00 PM' relative to the shift's date).",
    ),
  break_end: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Break end time as ISO 8601, 'YYYY-MM-DD HH:mm', or time of day ('12:30' / '12:30 PM' relative to the shift's date), or null for a running break on an active shift.",
    ),
  duration_minutes: z
    .number()
    .positive()
    .max(480)
    .optional()
    .describe(
      "Break duration in minutes (e.g. 30 or 15). When adding or updating a break, can be provided instead of break_end (or without break_start to place a break of that duration inside the shift).",
    ),
  timezone: timezoneField,
});

export const manageReportingSettingsInputSchema = z.object({
  org_id: orgIdField,
  action: z
    .enum(["get", "update", "send_test_report"])
    .optional()
    .describe(
      "Action to perform: 'get' (view current settings), 'update' (change reporting schedule), or 'send_test_report' (email the last 7 days report to org admins now). Defaults to 'get', or 'update' if schedule settings are provided.",
    ),
  report_frequency: z
    .enum(["off", "weekly", "twice-monthly", "custom", "bi-weekly", "biweekly"])
    .optional()
    .describe(
      "Report frequency when action is 'update': 'off' (no emailed reports), 'weekly' (sent on the 1st, 8th, 16th and 24th), 'twice-monthly' (pay periods, sent on the 1st and 16th), 'bi-weekly' (sent every 2 weeks on report_day, e.g. Friday), or 'custom' (a chosen weekday, every 1 or 2 weeks). If omitted, it becomes 'custom' (or 'bi-weekly' if interval is 2) when report_day or report_interval is given, otherwise the current frequency is kept.",
    ),
  report_day: z
    .enum([
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ])
    .nullable()
    .optional()
    .describe(
      "Day of the week when report_frequency is 'custom' or 'bi-weekly'.",
    ),
  report_interval: z
    .number()
    .int()
    .min(1)
    .max(2)
    .optional()
    .describe(
      "Interval in weeks (1 or 2) when report_frequency is 'custom'. Bi-weekly always uses interval 2.",
    ),
});

export const manageBreakSettingsInputSchema = z.object({
  org_id: orgIdField,
  action: z
    .enum(["get", "update", "toggle"])
    .optional()
    .describe(
      "Action to perform: 'get' (view the current lunch/break deduction settings), 'update' (change them), or 'toggle' (toggle dock_lunch on or off). Defaults to 'get'.",
    ),
  dock_lunch: z
    .boolean()
    .optional()
    .describe(
      "When action is 'update' or 'toggle': true to automatically deduct an unpaid lunch/break from qualifying shifts, false to count all time between clock-in and clock-out. If omitted during 'toggle', flips the current setting.",
    ),
  lunch_duration_minutes: z
    .number()
    .int()
    .min(0)
    .max(480)
    .optional()
    .describe(
      "Minutes deducted from each qualifying shift (0–480). If omitted, the current value is kept (default 30).",
    ),
  lunch_min_shift_hours: z
    .number()
    .min(0)
    .max(24)
    .optional()
    .describe(
      "Minimum shift length in hours before the deduction applies (0–24). If omitted, the current value is kept (default 5).",
    ),
});

export const runHoursReportInputSchema = z.object({
  org_id: orgIdField,
  member: z
    .string()
    .optional()
    .describe(
      "Member to report on (name, first name, email, or user_id), or 'all' for every member. Defaults to 'all'.",
    ),
  start_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .describe("First day of the report period (YYYY-MM-DD, inclusive)."),
  end_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .describe("Last day of the report period (YYYY-MM-DD, inclusive)."),
  deliver: z
    .enum(["chat", "email_admins", "both"])
    .optional()
    .describe(
      "Where to send the report: 'chat' (default, return the hours to you), 'email_admins' (email the report to the organization's admins), or 'both'.",
    ),
  timezone: timezoneField,
});

export const inviteMemberInputSchema = z.object({
  org_id: orgIdField,
  action: z
    .enum(["send", "list", "revoke"])
    .optional()
    .describe(
      "Action to perform: 'send' (send new email invitation(s) to join the organization), 'list' (list pending invitations), or 'revoke' (cancel a pending invitation by email or invitation_id). Defaults to 'send'.",
    ),
  email: z
    .string()
    .optional()
    .describe(
      "Email address to invite (when action is 'send') or whose pending invitation should be revoked (when action is 'revoke').",
    ),
  emails: z
    .array(z.string())
    .optional()
    .describe(
      "Batch of email addresses to invite at once (when action is 'send').",
    ),
  role: z
    .enum(["org:member", "org:admin", "member", "admin"])
    .optional()
    .describe(
      "Organization role for invited user(s): 'org:member' (default) or 'org:admin'.",
    ),
  invitation_id: z
    .string()
    .optional()
    .describe(
      "Pending invitation ID (orginv_...) to revoke when action is 'revoke'. Optional if email is provided.",
    ),
});

/*
 * ============================================================================
 * Helpers: Organization, Member, Time & Duration Resolution
 * ============================================================================
 */

export type OrgContext = {
  orgId: string;
  orgName: string;
  orgSlug: string | null;
  /** Uploaded org logo, or null when Clerk would show its placeholder. */
  orgImageUrl?: string | null;
  role: string;
  isAdmin: boolean;
};

export type OrgMemberInfo = {
  userId: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  role: string;
  isAdmin: boolean;
};

export function formatDurationMs(ms: number) {
  const safeMs = Math.max(0, ms);
  const totalMinutes = Math.floor(safeMs / (1000 * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const decimalHours = Number((safeMs / (1000 * 60 * 60)).toFixed(2));
  return {
    totalMinutes,
    hours,
    minutes,
    decimalHours,
    formatted: hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`,
  };
}

function formatTimestampInTz(date: Date | string | null, tz: string) {
  if (!date) return null;
  const d = typeof date === "string" ? new Date(date) : date;
  try {
    return formatInTimeZone(d, tz, "yyyy-MM-dd HH:mm:ss zzz");
  } catch {
    return d.toISOString();
  }
}

function validTimezone(tz?: string): string {
  if (!tz) return DEFAULT_TIMEZONE;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/**
 * Parses flexible date/time input in the given timezone:
 * - Full ISO with offset or Z: `2026-10-26T09:00:00Z` or `2026-10-26T09:00:00-06:00`
 * - Local ISO / datetime without offset: `2026-10-26T09:00` or `2026-10-26 09:00`
 * - Time-only (`09:00`, `9:30 AM`, `5:15 PM`) combined with `fallbackDate` (`YYYY-MM-DD`)
 */
export function parseFlexibleDateTime(
  input: string | undefined | null,
  tz: string,
  fallbackDate?: string,
): Date | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Time-only string such as "09:00", "9:00 AM", "17:30:00", "5:15pm"
  const timeOnlyMatch = trimmed.match(
    /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i,
  );
  if (timeOnlyMatch) {
    const baseDate =
      fallbackDate?.trim() || formatInTimeZone(new Date(), tz, "yyyy-MM-dd");
    let hours = Number.parseInt(timeOnlyMatch[1] ?? "0", 10);
    const minutes = Number.parseInt(timeOnlyMatch[2] ?? "0", 10);
    const seconds = Number.parseInt(timeOnlyMatch[3] ?? "0", 10);
    const meridiem = timeOnlyMatch[4]?.toLowerCase();
    if (meridiem === "pm" && hours < 12) hours += 12;
    if (meridiem === "am" && hours === 12) hours = 0;
    const hh = String(hours).padStart(2, "0");
    const mm = String(minutes).padStart(2, "0");
    const ss = String(seconds).padStart(2, "0");
    return fromZonedTime(`${baseDate}T${hh}:${mm}:${ss}`, tz);
  }

  // Date + 12-hour time e.g. "2026-10-26 9:00 AM"
  const date12hMatch = trimmed.match(
    /^(\d{4}-\d{2}-\d{2})[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)$/i,
  );
  if (date12hMatch) {
    const datePart = date12hMatch[1];
    let hours = Number.parseInt(date12hMatch[2] ?? "0", 10);
    const minutes = Number.parseInt(date12hMatch[3] ?? "0", 10);
    const seconds = Number.parseInt(date12hMatch[4] ?? "0", 10);
    const meridiem = date12hMatch[5]?.toLowerCase();
    if (meridiem === "pm" && hours < 12) hours += 12;
    if (meridiem === "am" && hours === 12) hours = 0;
    const hh = String(hours).padStart(2, "0");
    const mm = String(minutes).padStart(2, "0");
    const ss = String(seconds).padStart(2, "0");
    return fromZonedTime(`${datePart}T${hh}:${mm}:${ss}`, tz);
  }

  // If it already ends with Z or an explicit timezone offset (+HH:MM / -HH:MM), Date parses it directly
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed)) {
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // Otherwise interpret as a wall-clock time in `tz`
  try {
    const d = fromZonedTime(trimmed.replace(" ", "T"), tz);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? null : d;
  }
}

async function resolveOrg(
  userId: string,
  requestedOrg?: string,
): Promise<{ ok: true; org: OrgContext } | { ok: false; result: ToolResult }> {
  const client = await clerkClient();
  const memberships = await fetchAllPages(
    (params) =>
      client.users.getOrganizationMembershipList({ userId, ...params }),
    { label: `organizations of ${userId}` },
  );

  const list = memberships.map((m) => ({
    orgId: m.organization.id,
    orgName: m.organization.name,
    orgSlug: m.organization.slug ?? null,
    role: m.role,
    isAdmin: m.role === "org:admin",
    membersCount: m.organization.membersCount ?? undefined,
  }));

  // Kept out of `list` so tool responses listing organizations don't change.
  const imageUrls = new Map(
    memberships.map((m) => [
      m.organization.id,
      m.organization.hasImage ? m.organization.imageUrl : null,
    ]),
  );
  const withImage = (o: (typeof list)[number]): OrgContext => ({
    ...o,
    orgImageUrl: imageUrls.get(o.orgId) ?? null,
  });

  if (list.length === 0) {
    return {
      ok: false,
      result: {
        summary:
          "You don't belong to any organization in Clock Out yet. Create or join an organization on https://clockout.patmac.ca first.",
        data: { status: "no_organizations", organizations: [] },
        isError: true,
      },
    };
  }

  if (requestedOrg?.trim()) {
    const needle = requestedOrg.trim().toLowerCase();
    const matched = list.find(
      (o) =>
        o.orgId.toLowerCase() === needle ||
        o.orgSlug?.toLowerCase() === needle ||
        o.orgName.toLowerCase() === needle ||
        o.orgName.toLowerCase().includes(needle),
    );
    if (!matched) {
      return {
        ok: false,
        result: {
          summary: `No organization matching "${requestedOrg}" was found for your account. Available organizations: ${list.map((o) => `${o.orgName} (${o.orgId})`).join(", ")}.`,
          data: {
            status: "organization_not_found",
            requested_org: requestedOrg,
            organizations: list,
          },
          isError: true,
        },
      };
    }
    return { ok: true, org: withImage(matched) };
  }

  if (list.length === 1 && list[0]) {
    return { ok: true, org: withImage(list[0]) };
  }

  return {
    ok: false,
    result: {
      summary: `You belong to ${list.length} organizations (${list.map((o) => `${o.orgName} [${o.role}]`).join(", ")}). Please specify which organization to use with org_id.`,
      data: {
        status: "multiple_organizations",
        organizations: list,
      },
    },
  };
}

async function fetchOrgMembers(orgId: string): Promise<OrgMemberInfo[]> {
  const client = await clerkClient();
  const data = await fetchAllPages(
    (params) =>
      client.organizations.getOrganizationMembershipList({
        organizationId: orgId,
        ...params,
      }),
    { label: `members of ${orgId}` },
  );

  return data
    .map((m) => {
      const u = m.publicUserData;
      const userId = u?.userId || "";
      const firstName = u?.firstName ?? null;
      const lastName = u?.lastName ?? null;
      const email = u?.identifier ?? null;
      const fullName = firstName
        ? `${firstName} ${lastName || ""}`.trim()
        : email || userId || "Unknown Member";
      return {
        userId,
        name: fullName,
        firstName,
        lastName,
        email,
        role: m.role,
        isAdmin: m.role === "org:admin",
      };
    })
    .filter((m) => m.userId.length > 0);
}

function resolveMemberFromList(
  members: OrgMemberInfo[],
  callerUserId: string,
  callerIsAdmin: boolean,
  requestedMember?: string,
): { ok: true; member: OrgMemberInfo } | { ok: false; result: ToolResult } {
  const selfMember = members.find((m) => m.userId === callerUserId) ?? {
    userId: callerUserId,
    name: "You",
    firstName: null,
    lastName: null,
    email: null,
    role: callerIsAdmin ? "org:admin" : "org:member",
    isAdmin: callerIsAdmin,
  };

  if (!requestedMember?.trim()) {
    return { ok: true, member: selfMember };
  }

  const needle = requestedMember.trim().toLowerCase();
  if (
    needle === "me" ||
    needle === "self" ||
    needle === callerUserId.toLowerCase()
  ) {
    return { ok: true, member: selfMember };
  }

  // Exact match by userId, email, or full name
  const exact = members.filter(
    (m) =>
      m.userId.toLowerCase() === needle ||
      m.email?.toLowerCase() === needle ||
      m.name.toLowerCase() === needle,
  );
  if (exact.length === 1 && exact[0]) {
    if (exact[0].userId !== callerUserId && !callerIsAdmin) {
      return {
        ok: false,
        result: {
          summary:
            "Only organization admins (org:admin) can view or manage other members' hours.",
          data: { status: "forbidden" },
          isError: true,
        },
      };
    }
    return { ok: true, member: exact[0] };
  }

  // Partial / first-name match
  const partial = members.filter(
    (m) =>
      m.firstName?.toLowerCase() === needle ||
      m.lastName?.toLowerCase() === needle ||
      m.name.toLowerCase().includes(needle) ||
      m.email?.toLowerCase().includes(needle),
  );

  if (partial.length === 1 && partial[0]) {
    if (partial[0].userId !== callerUserId && !callerIsAdmin) {
      return {
        ok: false,
        result: {
          summary:
            "Only organization admins (org:admin) can view or manage other members' hours.",
          data: { status: "forbidden" },
          isError: true,
        },
      };
    }
    return { ok: true, member: partial[0] };
  }

  if (partial.length > 1) {
    return {
      ok: false,
      result: {
        summary: `Multiple members matched "${requestedMember}": ${partial.map((m) => `${m.name} (${m.email ?? m.userId})`).join(", ")}. Please specify their full name, email, or user_id.`,
        data: {
          status: "ambiguous_member",
          matches: partial,
        },
        isError: true,
      },
    };
  }

  return {
    ok: false,
    result: {
      summary: `No member matching "${requestedMember}" was found in this organization. Available members: ${members.map((m) => `${m.name} (${m.userId})`).join(", ")}.`,
      data: {
        status: "member_not_found",
        requested_member: requestedMember,
        members,
      },
      isError: true,
    },
  };
}

export function formatBreakForResponse(brk: TimeEntryBreak, tz: string) {
  const startDate = new Date(brk.break_start);
  const endDate = brk.break_end ? new Date(brk.break_end) : null;
  const durationMs = getBreakDurationMs(brk);
  const dur = formatDurationMs(durationMs);
  const paid = isPaidBreakType(brk.break_type);

  return {
    id: brk.id,
    break_id: brk.id,
    entry_id: brk.time_entry_id,
    time_entry_id: brk.time_entry_id,
    break_type: brk.break_type,
    label: breakTypeLabel(brk.break_type),
    paid,
    is_open: endDate === null,
    break_start: startDate.toISOString(),
    break_start_local: formatTimestampInTz(startDate, tz),
    break_end: endDate ? endDate.toISOString() : null,
    break_end_local: endDate ? formatTimestampInTz(endDate, tz) : null,
    duration_minutes: dur.totalMinutes,
    duration_hours: dur.decimalHours,
    formatted_duration: dur.formatted,
  };
}

function formatEntryForResponse(
  entry: TimeEntry,
  memberMap: Map<string, OrgMemberInfo>,
  tz: string,
) {
  const clockInDate = new Date(entry.clock_in);
  const clockOutDate = entry.clock_out ? new Date(entry.clock_out) : null;
  const durationMs =
    (clockOutDate ? clockOutDate.getTime() : Date.now()) -
    clockInDate.getTime();
  const dur = formatDurationMs(durationMs);
  const member = memberMap.get(entry.user_id);
  const breaks = (entry.breaks ?? []).map((b) => formatBreakForResponse(b, tz));
  const openBreak = getOpenBreak(entry);
  const unpaidBreakMinutes = Math.round(getUnpaidBreakMs(entry) / 60_000);
  const paidBreakMinutes = Math.round(getPaidBreakMs(entry) / 60_000);

  const hasInLocation =
    Boolean(entry.clock_in_site_name) ||
    Boolean(entry.clock_in_address) ||
    (typeof entry.clock_in_latitude === "number" &&
      typeof entry.clock_in_longitude === "number");

  const clockInLocation = hasInLocation
    ? {
        site_name: entry.clock_in_site_name ?? null,
        address: entry.clock_in_address ?? null,
        latitude: entry.clock_in_latitude ?? null,
        longitude: entry.clock_in_longitude ?? null,
        accuracy: entry.clock_in_accuracy_m ?? null,
      }
    : null;

  const hasOutLocation =
    Boolean(entry.clock_out_site_name) ||
    Boolean(entry.clock_out_address) ||
    (typeof entry.clock_out_latitude === "number" &&
      typeof entry.clock_out_longitude === "number");

  const clockOutLocation = hasOutLocation
    ? {
        site_name: entry.clock_out_site_name ?? null,
        address: entry.clock_out_address ?? null,
        latitude: entry.clock_out_latitude ?? null,
        longitude: entry.clock_out_longitude ?? null,
        accuracy: entry.clock_out_accuracy_m ?? null,
      }
    : null;

  return {
    id: entry.id,
    user_id: entry.user_id,
    member_name: member?.name ?? entry.user_id,
    member_email: member?.email ?? null,
    org_id: entry.org_id,
    date: formatInTimeZone(clockInDate, tz, "yyyy-MM-dd"),
    day_of_week: formatInTimeZone(clockInDate, tz, "EEEE"),
    clock_in: clockInDate.toISOString(),
    clock_in_local: formatTimestampInTz(clockInDate, tz),
    clock_in_location: clockInLocation,
    clock_out: clockOutDate ? clockOutDate.toISOString() : null,
    clock_out_local: clockOutDate
      ? formatTimestampInTz(clockOutDate, tz)
      : null,
    clock_out_location: clockOutLocation,
    is_active: clockOutDate === null,
    duration_minutes: dur.totalMinutes,
    duration_hours: dur.decimalHours,
    formatted_duration: dur.formatted,
    skip_lunch: Boolean(entry.skip_lunch),
    breaks,
    open_break: openBreak ? formatBreakForResponse(openBreak, tz) : null,
    unpaid_break_minutes: unpaidBreakMinutes,
    paid_break_minutes: paidBreakMinutes,
  };
}

export type McpLocationInput = {
  site?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
};

export type McpLocationResolution =
  | { allowed: true; location: StoredLocation | null }
  | {
      allowed: false;
      reason: string;
      status: "location_required" | "geofence_rejected";
      nearestSite?: { name: string; distanceMeters: number };
    };

export async function resolveMcpLocation(
  orgId: string,
  input: McpLocationInput,
  enforceGeofence = true,
  orgName = "organization",
): Promise<McpLocationResolution> {
  let settings: LocationSettingsData | null = null;
  try {
    settings = (await dbGetLocationSettings(orgId)) ?? null;
  } catch (err) {
    console.error("Failed to load location settings for MCP:", err);
  }

  // If capture is disabled ("off" and not restricted), drop coordinates / location completely.
  if (!isCaptureEnabled(settings)) {
    return { allowed: true, location: null };
  }

  let sites: SiteLike[] = [];
  try {
    sites = (await dbGetSites(orgId)) as unknown as SiteLike[];
  } catch (err) {
    console.error("Failed to load sites for MCP location resolution:", err);
  }

  const hasCoords =
    typeof input.latitude === "number" && typeof input.longitude === "number";
  const hasSite =
    typeof input.site === "string" && input.site.trim().length > 0;
  const hasAddress =
    typeof input.address === "string" && input.address.trim().length > 0;

  // 1. Explicit coordinates provided
  if (hasCoords) {
    const coords = {
      latitude: input.latitude as number,
      longitude: input.longitude as number,
      accuracy: input.accuracy ?? null,
    };

    if (!isValidCoordinates(coords)) {
      if (isLocationRequired(settings) && enforceGeofence) {
        return {
          allowed: false,
          status: "location_required",
          reason: `Invalid coordinates (${input.latitude}, ${input.longitude}). Latitude must be -90..90 and longitude -180..180.`,
        };
      }
      return { allowed: true, location: null };
    }

    const matchedSite =
      sites.length > 0 ? findMatchingSite(coords, sites) : null;
    const nearest = sites.length > 0 ? findNearestSite(coords, sites) : null;

    if (enforceGeofence && isRestricted(settings) && nearest && !matchedSite) {
      return {
        allowed: false,
        status: "geofence_rejected",
        reason: `You are not at an approved work site, so you cannot clock in. You are ${formatMeters(nearest.distanceMeters)} from ${nearest.site.name}.`,
        nearestSite: {
          name: nearest.site.name,
          distanceMeters: nearest.distanceMeters,
        },
      };
    }

    let siteName: string | null = matchedSite?.name ?? null;
    let address: string | null = input.address ?? matchedSite?.address ?? null;

    if (input.site) {
      const trimmedSite = input.site.trim();
      const matched = sites.find(
        (s) => s.name.toLowerCase() === trimmedSite.toLowerCase(),
      );
      siteName = matched?.name ?? trimmedSite;
      if (matched?.address && !address) {
        address = matched.address;
      }
    }

    if (!address) {
      try {
        address = await reverseGeocode({
          latitude: coords.latitude,
          longitude: coords.longitude,
        });
      } catch (err) {
        console.error("MCP reverse geocode error:", err);
      }
    }

    return {
      allowed: true,
      location: {
        latitude: coords.latitude,
        longitude: coords.longitude,
        accuracy: coords.accuracy,
        siteName,
        address: address ?? null,
      },
    };
  }

  // 2. Specific site name provided
  if (hasSite) {
    const trimmed = (input.site as string).trim();
    const matched =
      sites.find((s) => s.name.toLowerCase() === trimmed.toLowerCase()) ??
      sites.find((s) => s.name.toLowerCase().includes(trimmed.toLowerCase()));

    if (matched) {
      const lat = Number(matched.latitude);
      const lon = Number(matched.longitude);
      let address: string | null = matched.address ?? null;
      if (!address) {
        try {
          address = await reverseGeocode({ latitude: lat, longitude: lon });
        } catch (err) {
          console.error("MCP reverse geocode error:", err);
        }
      }
      return {
        allowed: true,
        location: {
          latitude: lat,
          longitude: lon,
          accuracy: 0,
          siteName: matched.name,
          address: address ?? null,
        },
      };
    }

    // Site wasn't in DB: check if geofencing restriction applies
    if (enforceGeofence && isRestricted(settings) && sites.length > 0) {
      return {
        allowed: false,
        status: "geofence_rejected",
        reason: `"${trimmed}" is not an approved work site for ${orgName}. Approved sites: ${sites.map((s) => s.name).join(", ")}.`,
      };
    }

    // Try searching as address
    try {
      const suggestions = await searchAddress(trimmed);
      if (suggestions.length > 0) {
        const s = suggestions[0];
        const match = findMatchingSite(
          { latitude: s.latitude, longitude: s.longitude },
          sites,
        );
        return {
          allowed: true,
          location: {
            latitude: s.latitude,
            longitude: s.longitude,
            accuracy: 0,
            siteName: match?.name ?? trimmed,
            address: s.formatted,
          },
        };
      }
    } catch (err) {
      console.error("MCP address search error:", err);
    }

    if (isLocationRequired(settings) && enforceGeofence) {
      return {
        allowed: false,
        status: "location_required",
        reason: `Could not resolve location for site "${trimmed}". Please provide a valid work site name or street address.`,
      };
    }

    return { allowed: true, location: null };
  }

  // 3. Specific address provided
  if (hasAddress) {
    const trimmed = (input.address as string).trim();
    try {
      const suggestions = await searchAddress(trimmed);
      if (suggestions.length > 0) {
        const s = suggestions[0];
        const coords = { latitude: s.latitude, longitude: s.longitude };
        const match = findMatchingSite(coords, sites);
        const nearest = findNearestSite(coords, sites);

        if (enforceGeofence && isRestricted(settings) && nearest && !match) {
          return {
            allowed: false,
            status: "geofence_rejected",
            reason: `You are not at an approved work site, so you cannot clock in. "${trimmed}" is ${formatMeters(nearest.distanceMeters)} from ${nearest.site.name}.`,
            nearestSite: {
              name: nearest.site.name,
              distanceMeters: nearest.distanceMeters,
            },
          };
        }

        return {
          allowed: true,
          location: {
            latitude: s.latitude,
            longitude: s.longitude,
            accuracy: 0,
            siteName: match?.name ?? null,
            address: s.formatted,
          },
        };
      }
    } catch (err) {
      console.error("MCP address search error:", err);
    }

    if (isLocationRequired(settings) && enforceGeofence) {
      return {
        allowed: false,
        status: "location_required",
        reason: `Could not resolve address "${trimmed}". Please check the address and try again.`,
      };
    }

    return { allowed: true, location: null };
  }

  // 4. No location parameters provided:
  if (isLocationRequired(settings) && enforceGeofence) {
    return {
      allowed: false,
      status: "location_required",
      reason: `Your organization requires your location to clock in. Please provide your work site, street address, or coordinates.`,
    };
  }

  // Capture is optional and user did not specify location:
  // If sites exist and clock-in is unconstrained, default to primary site if configured
  if (enforceGeofence && sites.length > 0) {
    const primary = sites[0];
    const lat = Number(primary.latitude);
    const lon = Number(primary.longitude);
    let address: string | null = primary.address ?? null;
    if (!address) {
      try {
        address = await reverseGeocode({ latitude: lat, longitude: lon });
      } catch (err) {
        console.error("MCP reverse geocode error:", err);
      }
    }
    return {
      allowed: true,
      location: {
        latitude: lat,
        longitude: lon,
        accuracy: 0,
        siteName: primary.name,
        address: address ?? null,
      },
    };
  }

  return { allowed: true, location: null };
}

/*
 * ============================================================================
 * Tool Implementations
 * ============================================================================
 */

export async function listOrganizations(
  caller: McpCaller,
): Promise<ToolResult> {
  const client = await clerkClient();
  const memberships = await fetchAllPages(
    (params) =>
      client.users.getOrganizationMembershipList({
        userId: caller.userId,
        ...params,
      }),
    { label: `organizations of ${caller.userId}` },
  );

  const organizations = memberships.map((m) => ({
    org_id: m.organization.id,
    name: m.organization.name,
    slug: m.organization.slug ?? null,
    role: m.role,
    is_admin: m.role === "org:admin",
    members_count: m.organization.membersCount ?? null,
    max_allowed_memberships: m.organization.maxAllowedMemberships ?? null,
  }));

  if (organizations.length === 0) {
    return {
      summary: "You are not a member of any organization in Clock Out.",
      data: { organizations: [], default_org_id: null },
    };
  }

  const defaultOrg = organizations.length === 1 ? organizations[0] : null;
  return {
    summary:
      organizations.length === 1 && defaultOrg
        ? `You belong to 1 organization: ${defaultOrg.name} (${defaultOrg.org_id}) as ${defaultOrg.is_admin ? "an admin" : "a member"}. It will be used automatically.`
        : `You belong to ${organizations.length} organizations: ${organizations.map((o) => `${o.name} (${o.org_id}, ${o.is_admin ? "admin" : "member"})`).join("; ")}.`,
    data: {
      organizations,
      default_org_id: defaultOrg?.org_id ?? null,
    },
  };
}

export async function listMembers(
  caller: McpCaller,
  input: z.infer<typeof listMembersInputSchema>,
): Promise<ToolResult> {
  const orgRes = await resolveOrg(caller.userId, input.org_id);
  if (!orgRes.ok) return orgRes.result;
  const { org } = orgRes;

  const [members, activeEntries] = await Promise.all([
    fetchOrgMembers(org.orgId),
    dbGetOrgActiveEntries(org.orgId),
  ]);

  const activeByUser = new Map<string, TimeEntry>();
  for (const entry of activeEntries) {
    activeByUser.set(entry.user_id, entry);
  }

  const enriched = members.map((m) => {
    const active = activeByUser.get(m.userId);
    const activeDuration = active
      ? formatDurationMs(Date.now() - new Date(active.clock_in).getTime())
      : null;
    return {
      user_id: m.userId,
      name: m.name,
      email: org.isAdmin || m.userId === caller.userId ? m.email : null,
      role: m.role,
      is_admin: m.isAdmin,
      is_self: m.userId === caller.userId,
      is_working: Boolean(active),
      active_entry_id: active?.id ?? null,
      clocked_in_at: active ? new Date(active.clock_in).toISOString() : null,
      active_duration: activeDuration?.formatted ?? null,
    };
  });

  return {
    summary: `${org.orgName} has ${enriched.length} member${enriched.length === 1 ? "" : "s"} (${activeEntries.length} currently working).`,
    data: {
      organization: {
        org_id: org.orgId,
        name: org.orgName,
        caller_role: org.role,
        caller_is_admin: org.isAdmin,
      },
      members: enriched,
    },
  };
}

export async function whoIsWorking(
  caller: McpCaller,
  input: z.infer<typeof whoIsWorkingInputSchema>,
): Promise<ToolResult> {
  const orgRes = await resolveOrg(caller.userId, input.org_id);
  if (!orgRes.ok) return orgRes.result;
  const { org } = orgRes;
  const tz = validTimezone(input.timezone);

  const [members, activeEntries] = await Promise.all([
    fetchOrgMembers(org.orgId),
    dbGetOrgActiveEntries(org.orgId),
  ]);

  const memberMap = new Map(members.map((m) => [m.userId, m]));
  const workingUserIds = new Set<string>();

  const currentlyWorking = activeEntries.map((entry) => {
    workingUserIds.add(entry.user_id);
    const clockInDate = new Date(entry.clock_in);
    const dur = formatDurationMs(Date.now() - clockInDate.getTime());
    const member = memberMap.get(entry.user_id);

    const hasInLocation =
      Boolean(entry.clock_in_site_name) ||
      Boolean(entry.clock_in_address) ||
      (typeof entry.clock_in_latitude === "number" &&
        typeof entry.clock_in_longitude === "number");

    const clockInLocation = hasInLocation
      ? {
          site_name: entry.clock_in_site_name ?? null,
          address: entry.clock_in_address ?? null,
          latitude: entry.clock_in_latitude ?? null,
          longitude: entry.clock_in_longitude ?? null,
          accuracy: entry.clock_in_accuracy_m ?? null,
        }
      : null;

    const locationLabel = clockInLocation?.site_name
      ? `${clockInLocation.site_name}${clockInLocation.address ? ` (${clockInLocation.address})` : ""}`
      : (clockInLocation?.address ?? null);

    return {
      entry_id: entry.id,
      user_id: entry.user_id,
      name: member?.name ?? entry.user_id,
      email:
        org.isAdmin || entry.user_id === caller.userId
          ? (member?.email ?? null)
          : null,
      role: member?.role ?? "org:member",
      clock_in: clockInDate.toISOString(),
      clock_in_local: formatTimestampInTz(clockInDate, tz),
      location: clockInLocation,
      location_label: locationLabel,
      elapsed_minutes: dur.totalMinutes,
      elapsed_hours: dur.decimalHours,
      formatted_duration: dur.formatted,
    };
  });

  const clockedOutMembers = members
    .filter((m) => !workingUserIds.has(m.userId))
    .map((m) => ({
      user_id: m.userId,
      name: m.name,
      role: m.role,
    }));

  const summary =
    currentlyWorking.length === 0
      ? `Nobody is currently clocked in at ${org.orgName}.`
      : `${currentlyWorking.length} member${currentlyWorking.length === 1 ? " is" : "s are"} currently working at ${org.orgName}: ${currentlyWorking.map((w) => `${w.name} (${w.formatted_duration}, since ${w.clock_in_local}${w.location_label ? ` at ${w.location_label}` : ""})`).join(", ")}.`;

  return {
    summary,
    data: {
      organization: { org_id: org.orgId, name: org.orgName },
      timezone: tz,
      working_count: currentlyWorking.length,
      currently_working: currentlyWorking,
      clocked_out_members: clockedOutMembers,
    },
  };
}

export async function getClockStatus(
  caller: McpCaller,
  input: z.infer<typeof getClockStatusInputSchema>,
): Promise<ToolResult> {
  const orgRes = await resolveOrg(caller.userId, input.org_id);
  if (!orgRes.ok) return orgRes.result;
  const { org } = orgRes;
  const tz = validTimezone(input.timezone);

  const members = await fetchOrgMembers(org.orgId);
  const memberRes = resolveMemberFromList(
    members,
    caller.userId,
    org.isAdmin,
    input.member,
  );
  if (!memberRes.ok) return memberRes.result;
  const target = memberRes.member;

  const [active, locationSettings, sites] = await Promise.all([
    dbGetActiveEntry(target.userId, org.orgId),
    dbGetLocationSettings(org.orgId).catch(() => undefined),
    dbGetSites(org.orgId).catch(() => []),
  ]);

  const locationSettingsInfo = {
    capture_mode: locationSettings?.capture_mode ?? "off",
    restrict_clock_in: locationSettings?.restrict_clock_in ?? false,
    sites_count: Array.isArray(sites) ? sites.length : 0,
  };

  if (!active) {
    return {
      summary: `${target.name} is currently clocked out in ${org.orgName}.`,
      data: {
        organization: { org_id: org.orgId, name: org.orgName },
        member: {
          user_id: target.userId,
          name: target.name,
          role: target.role,
        },
        is_clocked_in: false,
        active_entry: null,
        location_settings: locationSettingsInfo,
      },
    };
  }

  const clockInDate = new Date(active.clock_in);
  const dur = formatDurationMs(Date.now() - clockInDate.getTime());
  const openBreak = getOpenBreak(active);
  const formattedOpenBreak = openBreak
    ? formatBreakForResponse(openBreak, tz)
    : null;
  const formattedBreaks = (active.breaks ?? []).map((b) =>
    formatBreakForResponse(b, tz),
  );

  const hasInLocation =
    Boolean(active.clock_in_site_name) ||
    Boolean(active.clock_in_address) ||
    (typeof active.clock_in_latitude === "number" &&
      typeof active.clock_in_longitude === "number");

  const clockInLocation = hasInLocation
    ? {
        site_name: active.clock_in_site_name ?? null,
        address: active.clock_in_address ?? null,
        latitude: active.clock_in_latitude ?? null,
        longitude: active.clock_in_longitude ?? null,
        accuracy: active.clock_in_accuracy_m ?? null,
      }
    : null;

  const locationLabel = clockInLocation?.site_name
    ? `${clockInLocation.site_name}${clockInLocation.address ? ` (${clockInLocation.address})` : ""}`
    : (clockInLocation?.address ?? null);

  return {
    summary: `${target.name} is clocked in at ${org.orgName}${locationLabel ? ` at ${locationLabel}` : ""} (for ${dur.formatted}, since ${formatTimestampInTz(clockInDate, tz)}${formattedOpenBreak ? `, currently on ${formattedOpenBreak.label} for ${formattedOpenBreak.formatted_duration}` : ""}).`,
    data: {
      organization: { org_id: org.orgId, name: org.orgName },
      member: { user_id: target.userId, name: target.name, role: target.role },
      is_clocked_in: true,
      is_on_break: Boolean(formattedOpenBreak),
      active_entry: {
        entry_id: active.id,
        clock_in: clockInDate.toISOString(),
        clock_in_local: formatTimestampInTz(clockInDate, tz),
        clock_in_location: clockInLocation,
        elapsed_minutes: dur.totalMinutes,
        elapsed_hours: dur.decimalHours,
        formatted_duration: dur.formatted,
        open_break: formattedOpenBreak,
        breaks: formattedBreaks,
      },
      location_settings: locationSettingsInfo,
    },
  };
}

export async function clockInTool(
  caller: McpCaller,
  input: z.infer<typeof clockInInputSchema>,
): Promise<ToolResult> {
  const orgRes = await resolveOrg(caller.userId, input.org_id);
  if (!orgRes.ok) return orgRes.result;
  const { org } = orgRes;
  const tz = validTimezone(input.timezone);

  const members = await fetchOrgMembers(org.orgId);
  const memberRes = resolveMemberFromList(
    members,
    caller.userId,
    org.isAdmin,
    input.member,
  );
  if (!memberRes.ok) return memberRes.result;
  const target = memberRes.member;

  const [overLimit, existingActive] = await Promise.all([
    isOverMemberShipLimit(org.orgId),
    dbGetActiveEntry(target.userId, org.orgId),
  ]);

  if (overLimit) {
    return {
      summary: `Cannot clock in: ${org.orgName} is over its organization membership limit.`,
      data: { status: "over_membership_limit", org_id: org.orgId },
      isError: true,
    };
  }

  if (existingActive) {
    const since = formatTimestampInTz(new Date(existingActive.clock_in), tz);
    const dur = formatDurationMs(
      Date.now() - new Date(existingActive.clock_in).getTime(),
    );
    return {
      summary: `${target.name} is already clocked in since ${since} (${dur.formatted}). Clock out first before starting a new shift.`,
      data: {
        status: "already_clocked_in",
        active_entry_id: existingActive.id,
        clock_in: new Date(existingActive.clock_in).toISOString(),
        clock_in_local: since,
      },
      isError: true,
    };
  }

  let customClockIn: Date | undefined;
  if (input.clock_in) {
    const parsed = parseFlexibleDateTime(input.clock_in, tz);
    if (!parsed) {
      return {
        summary: `Could not parse clock_in time "${input.clock_in}". Use ISO 8601 or 'YYYY-MM-DD HH:mm'.`,
        data: { status: "invalid_clock_in", clock_in: input.clock_in },
        isError: true,
      };
    }
    const overlaps = await dbFindOverlappingTimeEntries(
      target.userId,
      org.orgId,
      parsed,
      new Date(),
    );
    if (overlaps.length > 0) {
      return {
        summary: `Cannot clock in at ${formatTimestampInTz(parsed, tz)} because it overlaps with an existing shift (entry #${overlaps[0]?.id}).`,
        data: {
          status: "overlapping_shift",
          overlapping_entries: overlaps,
        },
        isError: true,
      };
    }
    customClockIn = parsed;
  }

  const locationResolution = await resolveMcpLocation(
    org.orgId,
    input,
    true,
    org.orgName,
  );

  if (!locationResolution.allowed) {
    return {
      summary: `Cannot clock in: ${locationResolution.reason}`,
      data: {
        status: locationResolution.status,
        reason: locationResolution.reason,
        organization: { org_id: org.orgId, name: org.orgName },
        ...(locationResolution.nearestSite
          ? { nearest_site: locationResolution.nearestSite }
          : {}),
      },
      isError: true,
    };
  }

  const punchLocation = locationResolution.location;

  const entry = await dbClockInAt(
    target.userId,
    org.orgId,
    customClockIn,
    punchLocation,
  );
  if (!entry) {
    return {
      summary: `${target.name} is already clocked in.`,
      data: { status: "already_clocked_in" },
      isError: true,
    };
  }
  invalidateTimeEntryCache(target.userId, org.orgId);

  const memberMap = new Map(members.map((m) => [m.userId, m]));
  const formatted = formatEntryForResponse(entry, memberMap, tz);

  const locationLabel = punchLocation?.siteName
    ? `${punchLocation.siteName}${punchLocation.address ? ` (${punchLocation.address})` : ""}`
    : (punchLocation?.address ?? null);

  return {
    summary: `Clocked in ${target.name} at ${org.orgName}${locationLabel ? ` at ${locationLabel}` : ""} (${formatted.clock_in_local}).`,
    data: {
      status: "clocked_in",
      organization: { org_id: org.orgId, name: org.orgName },
      entry: formatted,
      location: punchLocation,
    },
  };
}

export async function clockOutTool(
  caller: McpCaller,
  input: z.infer<typeof clockOutInputSchema>,
): Promise<ToolResult> {
  const orgRes = await resolveOrg(caller.userId, input.org_id);
  if (!orgRes.ok) return orgRes.result;
  const { org } = orgRes;
  const tz = validTimezone(input.timezone);

  const members = await fetchOrgMembers(org.orgId);
  const memberRes = resolveMemberFromList(
    members,
    caller.userId,
    org.isAdmin,
    input.member,
  );
  if (!memberRes.ok) return memberRes.result;
  const target = memberRes.member;

  const active = await dbGetActiveEntry(target.userId, org.orgId);
  if (!active) {
    return {
      summary: `${target.name} does not have an active clock-in shift to clock out from in ${org.orgName}.`,
      data: {
        status: "not_clocked_in",
        member: { user_id: target.userId, name: target.name },
      },
      isError: true,
    };
  }

  let customClockOut: Date | undefined;
  if (input.clock_out) {
    const activeDateStr = formatInTimeZone(
      new Date(active.clock_in),
      tz,
      "yyyy-MM-dd",
    );
    const parsed = parseFlexibleDateTime(input.clock_out, tz, activeDateStr);
    if (!parsed) {
      return {
        summary: `Could not parse clock_out time "${input.clock_out}". Use ISO 8601 or 'YYYY-MM-DD HH:mm'.`,
        data: { status: "invalid_clock_out", clock_out: input.clock_out },
        isError: true,
      };
    }
    if (parsed.getTime() <= new Date(active.clock_in).getTime()) {
      return {
        summary: `Clock-out time (${formatTimestampInTz(parsed, tz)}) must be after the shift's clock-in time (${formatTimestampInTz(new Date(active.clock_in), tz)}).`,
        data: { status: "invalid_time_range" },
        isError: true,
      };
    }
    const overlaps = await dbFindOverlappingTimeEntries(
      target.userId,
      org.orgId,
      new Date(active.clock_in),
      parsed,
      active.id,
    );
    if (overlaps.length > 0) {
      return {
        summary: `Cannot clock out at ${formatTimestampInTz(parsed, tz)} because it overlaps with another shift (entry #${overlaps[0]?.id}).`,
        data: {
          status: "overlapping_shift",
          overlapping_entries: overlaps,
        },
        isError: true,
      };
    }
    customClockOut = parsed;
  }

  const locationResolution = await resolveMcpLocation(
    org.orgId,
    input,
    false,
    org.orgName,
  );
  const punchLocation = locationResolution.allowed
    ? locationResolution.location
    : null;

  const updated = await dbClockOutAt(
    target.userId,
    org.orgId,
    customClockOut,
    punchLocation,
  );
  if (!updated) {
    return {
      summary: `Could not clock out ${target.name}.`,
      data: { status: "clock_out_failed" },
      isError: true,
    };
  }

  invalidateTimeEntryCache(target.userId, org.orgId);

  const memberMap = new Map(members.map((m) => [m.userId, m]));
  const formatted = formatEntryForResponse(updated, memberMap, tz);

  const locationLabel = punchLocation?.siteName
    ? `${punchLocation.siteName}${punchLocation.address ? ` (${punchLocation.address})` : ""}`
    : (punchLocation?.address ?? null);

  return {
    summary: `Clocked out ${target.name} at ${org.orgName}${locationLabel ? ` at ${locationLabel}` : ""} (${formatted.formatted_duration} worked: ${formatted.clock_in_local} → ${formatted.clock_out_local}).`,
    data: {
      status: "clocked_out",
      organization: { org_id: org.orgId, name: org.orgName },
      entry: formatted,
      location: punchLocation,
    },
  };
}

export async function addTimeEntryTool(
  caller: McpCaller,
  input: z.infer<typeof addTimeEntryInputSchema>,
): Promise<ToolResult> {
  const orgRes = await resolveOrg(caller.userId, input.org_id);
  if (!orgRes.ok) return orgRes.result;
  const { org } = orgRes;
  const tz = validTimezone(input.timezone);

  const rawItems =
    input.entries && input.entries.length > 0
      ? input.entries
      : [
          {
            member: input.member,
            date: input.date,
            clock_in: input.clock_in,
            clock_out: input.clock_out,
            hours_worked: input.hours_worked,
          },
        ];

  const members = await fetchOrgMembers(org.orgId);
  const memberMap = new Map(members.map((m) => [m.userId, m]));

  type ResolvedShift = {
    target: OrgMemberInfo;
    clockIn: Date;
    clockOut: Date | null;
  };

  const resolvedShifts: ResolvedShift[] = [];

  for (let i = 0; i < rawItems.length; i++) {
    const item = rawItems[i];
    if (!item) continue;

    const memberRes = resolveMemberFromList(
      members,
      caller.userId,
      org.isAdmin,
      item.member ?? input.member,
    );
    if (!memberRes.ok) return memberRes.result;
    const target = memberRes.member;

    let clockIn: Date | null = null;
    let clockOut: Date | null = null;

    if (item.clock_in) {
      clockIn = parseFlexibleDateTime(item.clock_in, tz, item.date);
      if (!clockIn) {
        return {
          summary: `Shift #${i + 1}: could not parse clock_in "${item.clock_in}".`,
          data: { status: "invalid_clock_in", index: i, item },
          isError: true,
        };
      }
    } else if (item.date && item.hours_worked) {
      // Default start at 09:00 local time on `item.date` when a paper timecard only lists date + hours
      clockIn = parseFlexibleDateTime("09:00", tz, item.date);
    }

    if (!clockIn) {
      return {
        summary: `Shift #${i + 1}: provide clock_in (or date + hours_worked).`,
        data: { status: "missing_clock_in", index: i, item },
        isError: true,
      };
    }

    const baseDateForOut =
      item.date || formatInTimeZone(clockIn, tz, "yyyy-MM-dd");

    if (item.clock_out !== undefined && item.clock_out !== null) {
      clockOut = parseFlexibleDateTime(item.clock_out, tz, baseDateForOut);
      if (!clockOut) {
        return {
          summary: `Shift #${i + 1}: could not parse clock_out "${item.clock_out}".`,
          data: { status: "invalid_clock_out", index: i, item },
          isError: true,
        };
      }
    } else if (item.hours_worked !== undefined) {
      clockOut = new Date(
        clockIn.getTime() + Math.round(item.hours_worked * 60 * 60 * 1000),
      );
    }

    if (clockOut && clockOut.getTime() <= clockIn.getTime()) {
      return {
        summary: `Shift #${i + 1} (${target.name}): clock_out (${formatTimestampInTz(clockOut, tz)}) must be after clock_in (${formatTimestampInTz(clockIn, tz)}).`,
        data: { status: "invalid_time_range", index: i, item },
        isError: true,
      };
    }

    resolvedShifts.push({ target, clockIn, clockOut });
  }

  // 1. Check for double / overlapping times within the submitted batch itself
  for (let i = 0; i < resolvedShifts.length; i++) {
    const a = resolvedShifts[i];
    if (!a) continue;
    const aEnd = a.clockOut ?? new Date();
    for (let j = i + 1; j < resolvedShifts.length; j++) {
      const b = resolvedShifts[j];
      if (!b || a.target.userId !== b.target.userId) continue;
      const bEnd = b.clockOut ?? new Date();
      if (a.clockIn < bEnd && aEnd > b.clockIn) {
        return {
          summary: `Cannot add double/overlapping shifts in the same request for ${a.target.name}: Shift #${i + 1} (${formatTimestampInTz(a.clockIn, tz)} → ${formatTimestampInTz(a.clockOut, tz) ?? "active"}) overlaps with Shift #${j + 1} (${formatTimestampInTz(b.clockIn, tz)} → ${formatTimestampInTz(b.clockOut, tz) ?? "active"}).`,
          data: {
            status: "duplicate_or_overlapping_in_batch",
            first_index: i,
            second_index: j,
          },
          isError: true,
        };
      }
    }
  }

  // 2. Check every shift against the database so we NEVER insert double or overlapping times
  const conflicts: {
    shift_index: number;
    member_name: string;
    proposed_clock_in: string | null;
    proposed_clock_out: string | null;
    existing_entries: ReturnType<typeof formatEntryForResponse>[];
  }[] = [];

  for (let i = 0; i < resolvedShifts.length; i++) {
    const s = resolvedShifts[i];
    if (!s) continue;
    const overlapping = await dbFindOverlappingTimeEntries(
      s.target.userId,
      org.orgId,
      s.clockIn,
      s.clockOut,
    );
    if (overlapping.length > 0) {
      conflicts.push({
        shift_index: i,
        member_name: s.target.name,
        proposed_clock_in: formatTimestampInTz(s.clockIn, tz),
        proposed_clock_out: formatTimestampInTz(s.clockOut, tz),
        existing_entries: overlapping.map((e) =>
          formatEntryForResponse(e, memberMap, tz),
        ),
      });
    }
  }

  if (conflicts.length > 0) {
    const first = conflicts[0];
    const existingIds = conflicts
      .flatMap((c) =>
        c.existing_entries.map(
          (e) =>
            `#${e.id} (${e.clock_in_local} → ${e.clock_out_local ?? "active"})`,
        ),
      )
      .join(", ");
    return {
      summary: `Rejected to prevent double/overlapping times: ${conflicts.length} proposed shift${conflicts.length === 1 ? "" : "s"} for ${first?.member_name} overlap${conflicts.length === 1 ? "s" : ""} with existing entry ${existingIds}. Nothing was saved. Use update_time_entry if you want to change the existing shift's hours.`,
      data: {
        status: "overlapping_existing_entries",
        conflicts,
      },
      isError: true,
    };
  }

  // 3. Insert all shifts and invalidate caches
  const createdEntries = [];
  const touchedUsers = new Set<string>();

  for (const s of resolvedShifts) {
    const inserted = await dbInsertTimeEntry(
      s.target.userId,
      org.orgId,
      s.clockIn,
      s.clockOut,
    );
    touchedUsers.add(s.target.userId);
    createdEntries.push(formatEntryForResponse(inserted, memberMap, tz));
  }

  for (const uid of touchedUsers) {
    invalidateTimeEntryCache(uid, org.orgId);
  }

  const totalMinutes = createdEntries.reduce(
    (sum, e) => sum + e.duration_minutes,
    0,
  );
  const totalDur = formatDurationMs(totalMinutes * 60 * 1000);

  return {
    summary:
      createdEntries.length === 1 && createdEntries[0]
        ? `Added shift #${createdEntries[0].id} for ${createdEntries[0].member_name} on ${createdEntries[0].date} (${createdEntries[0].formatted_duration}: ${createdEntries[0].clock_in_local} → ${createdEntries[0].clock_out_local ?? "active"}).`
        : `Added ${createdEntries.length} shifts (${totalDur.formatted} total) in ${org.orgName}.`,
    data: {
      status: "added",
      organization: { org_id: org.orgId, name: org.orgName },
      count: createdEntries.length,
      total_hours: totalDur.decimalHours,
      formatted_total: totalDur.formatted,
      entries: createdEntries,
    },
  };
}

export async function listTimeEntriesTool(
  caller: McpCaller,
  input: z.infer<typeof listTimeEntriesInputSchema>,
): Promise<ToolResult> {
  const orgRes = await resolveOrg(caller.userId, input.org_id);
  if (!orgRes.ok) return orgRes.result;
  const { org } = orgRes;
  const tz = validTimezone(input.timezone);

  const members = await fetchOrgMembers(org.orgId);
  const memberMap = new Map(members.map((m) => [m.userId, m]));

  const nowZoned = toZonedTime(new Date(), tz);
  const defaultStartStr = format(subDays(nowZoned, 7), "yyyy-MM-dd");
  const defaultEndStr = format(nowZoned, "yyyy-MM-dd");

  const startStr = input.start_date?.trim() || defaultStartStr;
  const endStr = input.end_date?.trim() || defaultEndStr;

  const startDate =
    startStr.length === 10
      ? fromZonedTime(`${startStr}T00:00:00.000`, tz)
      : (parseFlexibleDateTime(startStr, tz) ??
        fromZonedTime(`${defaultStartStr}T00:00:00.000`, tz));
  const endDate =
    endStr.length === 10
      ? fromZonedTime(`${endStr}T23:59:59.999`, tz)
      : (parseFlexibleDateTime(endStr, tz) ??
        fromZonedTime(`${defaultEndStr}T23:59:59.999`, tz));

  const wantsAll = input.member?.trim().toLowerCase() === "all";
  let entries: TimeEntry[];
  let targetLabel: string;

  if (wantsAll) {
    if (!org.isAdmin) {
      return {
        summary:
          "Only organization admins (org:admin) can list time entries for all members.",
        data: { status: "forbidden" },
        isError: true,
      };
    }
    entries = await dbGetOrgTimeEntries(org.orgId, startDate, endDate);
    targetLabel = `all members in ${org.orgName}`;
  } else {
    const memberRes = resolveMemberFromList(
      members,
      caller.userId,
      org.isAdmin,
      input.member,
    );
    if (!memberRes.ok) return memberRes.result;
    entries = await dbGetTimeEntries(
      memberRes.member.userId,
      org.orgId,
      startDate,
      endDate,
    );
    targetLabel = memberRes.member.name;
  }

  const formatted = entries.map((e) =>
    formatEntryForResponse(e, memberMap, tz),
  );
  const totalMinutes = formatted.reduce(
    (sum, e) => sum + e.duration_minutes,
    0,
  );
  const totalDur = formatDurationMs(totalMinutes * 60 * 1000);

  return {
    summary: `Found ${formatted.length} time entr${formatted.length === 1 ? "y" : "ies"} (${totalDur.formatted} total) for ${targetLabel} from ${startStr} to ${endStr}.`,
    data: {
      organization: { org_id: org.orgId, name: org.orgName },
      period: { start: startStr, end: endStr, timezone: tz },
      count: formatted.length,
      total_hours: totalDur.decimalHours,
      formatted_total: totalDur.formatted,
      entries: formatted,
    },
  };
}

export async function getWeeklyTimecardTool(
  caller: McpCaller,
  input: z.infer<typeof getWeeklyTimecardInputSchema>,
): Promise<ToolResult> {
  const orgRes = await resolveOrg(caller.userId, input.org_id);
  if (!orgRes.ok) return orgRes.result;
  const { org } = orgRes;
  const tz = validTimezone(input.timezone);

  const members = await fetchOrgMembers(org.orgId);
  const memberMap = new Map(members.map((m) => [m.userId, m]));

  // Determine period startDate and endDate
  let startDate: Date;
  let endDate: Date;
  let periodLabel: string;

  if (input.start_date && input.end_date) {
    startDate = fromZonedTime(
      `${input.start_date.slice(0, 10)}T00:00:00.000`,
      tz,
    );
    endDate = fromZonedTime(`${input.end_date.slice(0, 10)}T23:59:59.999`, tz);
    periodLabel = `${input.start_date.slice(0, 10)} to ${input.end_date.slice(0, 10)}`;
  } else if (input.year && input.month && input.week) {
    const monthIndex = input.month - 1;
    const baseDate = new Date(input.year, monthIndex, 1);
    const startDay = (input.week - 1) * 7 + 1;
    const endDayDate =
      input.week === 4
        ? endOfMonth(baseDate)
        : endOfDay(new Date(input.year, monthIndex, input.week * 7));
    const startStr = format(
      new Date(input.year, monthIndex, startDay),
      "yyyy-MM-dd",
    );
    const endStr = format(endDayDate, "yyyy-MM-dd");
    startDate = fromZonedTime(`${startStr}T00:00:00.000`, tz);
    endDate = fromZonedTime(`${endStr}T23:59:59.999`, tz);
    periodLabel = `Week ${input.week} of ${format(baseDate, "MMMM yyyy")} (${startStr} to ${endStr})`;
  } else {
    const refDate = input.week_of
      ? fromZonedTime(`${input.week_of.slice(0, 10)}T12:00:00`, tz)
      : new Date();
    const zonedRef = toZonedTime(refDate, tz);
    const weekStartZoned = startOfWeek(zonedRef, { weekStartsOn: 1 });
    const weekEndZoned = endOfWeek(zonedRef, { weekStartsOn: 1 });
    const startStr = format(weekStartZoned, "yyyy-MM-dd");
    const endStr = format(weekEndZoned, "yyyy-MM-dd");
    startDate = fromZonedTime(`${startStr}T00:00:00.000`, tz);
    endDate = fromZonedTime(`${endStr}T23:59:59.999`, tz);
    periodLabel = `${startStr} to ${endStr}`;
  }

  const requestedMember = input.member?.trim();
  const wantsAll =
    requestedMember?.toLowerCase() === "all" ||
    (!requestedMember && org.isAdmin);

  let targetMembers: OrgMemberInfo[];
  let entries: TimeEntry[];

  if (wantsAll) {
    if (!org.isAdmin) {
      return {
        summary:
          "Only organization admins (org:admin) can view the weekly timecard for all members.",
        data: { status: "forbidden" },
        isError: true,
      };
    }
    targetMembers = members;
    entries = await dbGetOrgTimeEntries(org.orgId, startDate, endDate);
  } else {
    const memberRes = resolveMemberFromList(
      members,
      caller.userId,
      org.isAdmin,
      requestedMember,
    );
    if (!memberRes.ok) return memberRes.result;
    targetMembers = [memberRes.member];
    entries = await dbGetTimeEntries(
      memberRes.member.userId,
      org.orgId,
      startDate,
      endDate,
    );
  }

  // Group entries by member -> by day (YYYY-MM-DD in tz)
  const entriesByUser = new Map<string, TimeEntry[]>();
  for (const entry of entries) {
    const list = entriesByUser.get(entry.user_id) ?? [];
    list.push(entry);
    entriesByUser.set(entry.user_id, list);
  }

  let orgTotalMs = 0;
  const timecards = targetMembers.map((m) => {
    const userEntries = (entriesByUser.get(m.userId) ?? []).sort(
      (a, b) => new Date(a.clock_in).getTime() - new Date(b.clock_in).getTime(),
    );

    let memberTotalMs = 0;
    let activeShifts = 0;
    const daysMap = new Map<
      string,
      {
        date: string;
        day_of_week: string;
        rawMs: number;
        shifts: ReturnType<typeof formatEntryForResponse>[];
      }
    >();

    for (const entry of userEntries) {
      const formatted = formatEntryForResponse(entry, memberMap, tz);
      const inMs = new Date(entry.clock_in).getTime();
      const outMs = entry.clock_out
        ? new Date(entry.clock_out).getTime()
        : Date.now();
      const shiftMs = Math.max(0, outMs - inMs);
      memberTotalMs += shiftMs;
      if (!entry.clock_out) activeShifts += 1;

      const dayEntry = daysMap.get(formatted.date) ?? {
        date: formatted.date,
        day_of_week: formatted.day_of_week,
        rawMs: 0,
        shifts: [],
      };
      dayEntry.rawMs += shiftMs;
      dayEntry.shifts.push(formatted);
      daysMap.set(formatted.date, dayEntry);
    }

    orgTotalMs += memberTotalMs;
    const memberDur = formatDurationMs(memberTotalMs);

    const dailyBreakdown = Array.from(daysMap.values()).map((d) => {
      const dayDur = formatDurationMs(d.rawMs);
      return {
        date: d.date,
        day_of_week: d.day_of_week,
        total_hours: dayDur.decimalHours,
        formatted_total: dayDur.formatted,
        shifts: d.shifts,
      };
    });

    return {
      user_id: m.userId,
      name: m.name,
      email: org.isAdmin || m.userId === caller.userId ? m.email : null,
      role: m.role,
      total_hours: memberDur.decimalHours,
      total_minutes: memberDur.totalMinutes,
      formatted_total: memberDur.formatted,
      days_worked: dailyBreakdown.length,
      shifts_count: userEntries.length,
      active_shifts: activeShifts,
      daily_breakdown: dailyBreakdown,
    };
  });

  const orgTotalDur = formatDurationMs(orgTotalMs);

  const summary =
    timecards.length === 1 && timecards[0]
      ? `Weekly timecard for ${timecards[0].name} (${periodLabel}): ${timecards[0].formatted_total} across ${timecards[0].days_worked} day${timecards[0].days_worked === 1 ? "" : "s"} (${timecards[0].shifts_count} shift${timecards[0].shifts_count === 1 ? "" : "s"}).`
      : `Weekly timecard for ${org.orgName} (${periodLabel}): ${orgTotalDur.formatted} total across ${timecards.length} members (${timecards.map((t) => `${t.name}: ${t.formatted_total}`).join(", ")}).`;

  return {
    summary,
    data: {
      organization: { org_id: org.orgId, name: org.orgName },
      period: {
        label: periodLabel,
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        timezone: tz,
      },
      organization_total_hours: orgTotalDur.decimalHours,
      organization_formatted_total: orgTotalDur.formatted,
      timecards,
    },
  };
}

export type GeneratedTimesheetExport = {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
  format: ExportFormat;
  pdfBytes: Uint8Array;
  pdfFileName: string;
  pdfDownloadUrl: string;
  xlsxBytes: Uint8Array;
  xlsxFileName: string;
  xlsxDownloadUrl: string;
  csvBytes: Uint8Array;
  csvFileName: string;
  csvDownloadUrl: string;
  groupBy: ExportGrouping;
  org: OrgContext;
  employeeLabel: string;
  memberParam: string;
  startStr: string;
  endStr: string;
  periodLabel: string;
  formattedPeriod: string;
  timezone: string;
  entriesCount: number;
  daysWorked: number;
  totalHours: number;
  downloadUrl: string;
  periodSections: ReturnType<typeof buildPeriodSections>;
  employeeSummaries: ReturnType<typeof buildEmployeeSummary>;
};

export async function generateTimesheetExport(
  caller: McpCaller,
  input: z.infer<typeof exportTimesheetInputSchema>,
  origin?: string,
): Promise<
  | { ok: true; value: GeneratedTimesheetExport }
  | { ok: false; status: number; result: ToolResult }
> {
  const orgRes = await resolveOrg(caller.userId, input.org_id);
  if (!orgRes.ok) {
    return {
      ok: false,
      status: orgRes.result.data.status === "forbidden" ? 403 : 400,
      result: orgRes.result,
    };
  }
  const { org } = orgRes;
  const tz = validTimezone(input.timezone);
  const exportFormat: ExportFormat =
    input.format === "xlsx" || input.format === "csv" ? input.format : "pdf";
  const groupBy: ExportGrouping = input.group_by ?? "auto";

  let startDate: Date;
  let endDate: Date;
  let startStr: string;
  let endStr: string;
  let periodLabel: string;

  if (input.start_date && input.end_date) {
    startStr = input.start_date.slice(0, 10);
    endStr = input.end_date.slice(0, 10);
    startDate = fromZonedTime(`${startStr}T00:00:00.000`, tz);
    endDate = fromZonedTime(`${endStr}T23:59:59.999`, tz);
    periodLabel = `${startStr} to ${endStr}`;
  } else if (input.year && input.month && input.week) {
    const monthIndex = input.month - 1;
    const baseDate = new Date(input.year, monthIndex, 1);
    const startDay = (input.week - 1) * 7 + 1;
    const endDayDate =
      input.week === 4
        ? endOfMonth(baseDate)
        : endOfDay(new Date(input.year, monthIndex, input.week * 7));
    startStr = format(new Date(input.year, monthIndex, startDay), "yyyy-MM-dd");
    endStr = format(endDayDate, "yyyy-MM-dd");
    startDate = fromZonedTime(`${startStr}T00:00:00.000`, tz);
    endDate = fromZonedTime(`${endStr}T23:59:59.999`, tz);
    periodLabel = `Week ${input.week} of ${format(baseDate, "MMMM yyyy")} (${startStr} to ${endStr})`;
  } else if (input.year && input.month) {
    const monthIndex = input.month - 1;
    const baseDate = new Date(input.year, monthIndex, 1);
    startStr = format(baseDate, "yyyy-MM-dd");
    endStr = format(endOfMonth(baseDate), "yyyy-MM-dd");
    startDate = fromZonedTime(`${startStr}T00:00:00.000`, tz);
    endDate = fromZonedTime(`${endStr}T23:59:59.999`, tz);
    periodLabel = `${format(baseDate, "MMMM yyyy")} (${startStr} to ${endStr})`;
  } else {
    const refDate = input.week_of
      ? fromZonedTime(`${input.week_of.slice(0, 10)}T12:00:00`, tz)
      : new Date();
    const zonedRef = toZonedTime(refDate, tz);
    const weekStartZoned = startOfWeek(zonedRef, { weekStartsOn: 1 });
    const weekEndZoned = endOfWeek(zonedRef, { weekStartsOn: 1 });
    startStr = format(weekStartZoned, "yyyy-MM-dd");
    endStr = format(weekEndZoned, "yyyy-MM-dd");
    startDate = fromZonedTime(`${startStr}T00:00:00.000`, tz);
    endDate = fromZonedTime(`${endStr}T23:59:59.999`, tz);
    periodLabel = `${startStr} to ${endStr}`;
  }

  if (
    Number.isNaN(startDate.getTime()) ||
    Number.isNaN(endDate.getTime()) ||
    endDate.getTime() < startDate.getTime()
  ) {
    return {
      ok: false,
      status: 400,
      result: {
        summary: `Invalid date range (${startStr} to ${endStr}). Ensure start_date and end_date are valid YYYY-MM-DD dates with end_date on or after start_date.`,
        data: {
          status: "invalid_date_range",
          start_date: startStr,
          end_date: endStr,
        },
        isError: true,
      },
    };
  }

  const members = await fetchOrgMembers(org.orgId);
  const memberMap = new Map(members.map((m) => [m.userId, m]));

  const requestedMember = input.member?.trim();
  const wantsAll =
    requestedMember?.toLowerCase() === "all" ||
    (!requestedMember && org.isAdmin);

  let entries: TimeEntry[];
  let employeeLabel: string;
  let memberParam: string;

  if (wantsAll) {
    if (!org.isAdmin) {
      return {
        ok: false,
        status: 403,
        result: {
          summary:
            "Only organization admins (org:admin) can export timesheets for all members.",
          data: { status: "forbidden" },
          isError: true,
        },
      };
    }
    entries = await dbGetOrgTimeEntries(org.orgId, startDate, endDate);
    employeeLabel = "Entire Organization";
    memberParam = "all";
  } else {
    const memberRes = resolveMemberFromList(
      members,
      caller.userId,
      org.isAdmin,
      requestedMember,
    );
    if (!memberRes.ok) {
      return {
        ok: false,
        status: memberRes.result.data.status === "forbidden" ? 403 : 404,
        result: memberRes.result,
      };
    }
    entries = await dbGetTimeEntries(
      memberRes.member.userId,
      org.orgId,
      startDate,
      endDate,
    );
    employeeLabel = memberRes.member.name;
    memberParam = memberRes.member.userId;
  }

  const rows = buildExportRows(
    entries,
    (userId) =>
      wantsAll
        ? (memberMap.get(userId)?.name ?? "Unknown member")
        : employeeLabel,
    tz,
  );
  const orgLogo = await loadPdfImage(org.orgImageUrl);
  const meta: ExportMeta = {
    employee: employeeLabel,
    startDate: startStr,
    endDate: endStr,
    groupBy,
    orgName: org.orgName,
    orgLogo,
  };
  const pdfFileName = exportFileName(meta, "pdf");
  const xlsxFileName = exportFileName(meta, "xlsx");
  const csvFileName = exportFileName(meta, "csv");
  const pdfBytes = toPdf(rows, meta);
  const xlsxBytes = toXlsx(rows, meta);
  const csvBytes = toCsv(rows, meta);

  const byFormat = {
    pdf: {
      fileName: pdfFileName,
      bytes: pdfBytes,
      mimeType: "application/pdf",
    },
    xlsx: { fileName: xlsxFileName, bytes: xlsxBytes, mimeType: XLSX_MIME },
    csv: { fileName: csvFileName, bytes: csvBytes, mimeType: CSV_MIME },
  } as const;
  const { fileName, bytes, mimeType } = byFormat[exportFormat];
  const hours = Number(totalHours(rows).toFixed(2));
  const daysWorked = new Set(rows.map((r) => r.date)).size;
  const periodSections = buildPeriodSections(rows, meta);
  const employeeSummaries = buildEmployeeSummary(rows);

  const baseOrigin = (
    origin ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://clockout.patmac.ca"
  ).replace(/\/+$/, "");

  const buildUrl = (fmt: ExportFormat) => {
    const p = new URLSearchParams({
      org_id: org.orgId,
      member: memberParam,
      start_date: startStr,
      end_date: endStr,
      format: fmt,
      timezone: tz,
    });
    if (groupBy !== "auto") {
      p.set("group_by", groupBy);
    }
    return `${baseOrigin}/api/export/timesheet?${p.toString()}`;
  };

  const pdfDownloadUrl = buildUrl("pdf");
  const xlsxDownloadUrl = buildUrl("xlsx");
  const csvDownloadUrl = buildUrl("csv");
  const downloadUrl = {
    pdf: pdfDownloadUrl,
    xlsx: xlsxDownloadUrl,
    csv: csvDownloadUrl,
  }[exportFormat];

  return {
    ok: true,
    value: {
      bytes,
      fileName,
      mimeType,
      format: exportFormat,
      pdfBytes,
      pdfFileName,
      pdfDownloadUrl,
      xlsxBytes,
      xlsxFileName,
      xlsxDownloadUrl,
      csvBytes,
      csvFileName,
      csvDownloadUrl,
      groupBy,
      org,
      employeeLabel,
      memberParam,
      startStr,
      endStr,
      periodLabel,
      formattedPeriod: formatPeriod(meta),
      timezone: tz,
      entriesCount: rows.length,
      daysWorked,
      totalHours: hours,
      downloadUrl,
      periodSections,
      employeeSummaries,
    },
  };
}

export async function exportTimesheetTool(
  caller: McpCaller,
  input: z.infer<typeof exportTimesheetInputSchema>,
): Promise<ToolResult> {
  const res = await generateTimesheetExport(caller, input);
  if (!res.ok) return res.result;
  const {
    bytes,
    fileName,
    mimeType,
    format: exportFormat,
    pdfBytes,
    pdfFileName,
    pdfDownloadUrl,
    xlsxBytes,
    xlsxFileName,
    xlsxDownloadUrl,
    csvFileName,
    csvDownloadUrl,
    groupBy,
    org,
    employeeLabel,
    memberParam,
    startStr,
    endStr,
    periodLabel,
    formattedPeriod,
    timezone,
    entriesCount,
    daysWorked,
    totalHours: hours,
    downloadUrl,
    periodSections,
    employeeSummaries,
  } = res.value;

  const pdfBase64 = Buffer.from(pdfBytes).toString("base64");
  const xlsxBase64 = Buffer.from(xlsxBytes).toString("base64");
  const primaryBase64 = Buffer.from(bytes).toString("base64");

  const pdfResource: ToolResource = {
    uri: pdfDownloadUrl,
    mimeType: "application/pdf",
    blob: pdfBase64,
  };
  const xlsxResource: ToolResource = {
    uri: xlsxDownloadUrl,
    mimeType: XLSX_MIME,
    blob: xlsxBase64,
  };

  return {
    summary: `Timesheet for ${employeeLabel} (${formattedPeriod}: ${entriesCount} entr${entriesCount === 1 ? "y" : "ies"} across ${daysWorked} day${daysWorked === 1 ? "" : "s"}, ${formatHours(hours)} hrs) is ready in PDF, Excel Spreadsheet and CSV formats. Download (requires Clock Out sign-in): PDF [${pdfFileName}](${pdfDownloadUrl}) | Spreadsheet [${xlsxFileName}](${xlsxDownloadUrl}) | CSV [${csvFileName}](${csvDownloadUrl})`,
    data: {
      status: "ready",
      organization: { org_id: org.orgId, name: org.orgName },
      employee: employeeLabel,
      member: memberParam,
      period: {
        label: periodLabel,
        formatted: formattedPeriod,
        start: startStr,
        end: endStr,
        timezone,
        group_by: groupBy,
      },
      format: exportFormat,
      file_name: fileName,
      mime_type: mimeType,
      entries_count: entriesCount,
      days_worked: daysWorked,
      total_hours: hours,
      download_url: downloadUrl,
      pdf: {
        file_name: pdfFileName,
        mime_type: "application/pdf",
        download_url: pdfDownloadUrl,
      },
      spreadsheet: {
        file_name: xlsxFileName,
        mime_type: XLSX_MIME,
        download_url: xlsxDownloadUrl,
      },
      csv: {
        file_name: csvFileName,
        mime_type: CSV_MIME,
        download_url: csvDownloadUrl,
      },
      period_breakdown: periodSections.map((s) => ({
        label: s.label,
        days_worked: s.daysWorked,
        shifts_count: s.shiftsCount,
        total_hours: Number(s.totalHours.toFixed(2)),
      })),
      employee_breakdown: employeeSummaries.map((e) => ({
        employee: e.employee,
        days_worked: e.daysWorked,
        shifts_count: e.shiftsCount,
        total_hours: Number(e.totalHours.toFixed(2)),
      })),
    },
    resource: {
      uri: downloadUrl,
      mimeType,
      blob: primaryBase64,
    },
    resources:
      exportFormat === "xlsx"
        ? [xlsxResource, pdfResource]
        : [pdfResource, xlsxResource],
  };
}

export async function updateTimeEntryTool(
  caller: McpCaller,
  input: z.infer<typeof updateTimeEntryInputSchema>,
): Promise<ToolResult> {
  const orgRes = await resolveOrg(caller.userId, input.org_id);
  if (!orgRes.ok) return orgRes.result;
  const { org } = orgRes;
  const tz = validTimezone(input.timezone);

  if (!org.isAdmin) {
    return {
      summary:
        "Only organization admins (org:admin) can modify existing time entries.",
      data: { status: "forbidden" },
      isError: true,
    };
  }

  const members = await fetchOrgMembers(org.orgId);
  const memberMap = new Map(members.map((m) => [m.userId, m]));

  let targetEntry: TimeEntry | null = null;

  if (input.entry_id !== undefined) {
    targetEntry = await dbGetTimeEntryById(input.entry_id, org.orgId);
    if (!targetEntry) {
      return {
        summary: `Time entry #${input.entry_id} was not found in ${org.orgName}.`,
        data: { status: "entry_not_found", entry_id: input.entry_id },
        isError: true,
      };
    }
  } else if (input.date) {
    const memberRes = resolveMemberFromList(
      members,
      caller.userId,
      org.isAdmin,
      input.member,
    );
    if (!memberRes.ok) return memberRes.result;
    const dayStart = fromZonedTime(
      `${input.date.slice(0, 10)}T00:00:00.000`,
      tz,
    );
    const dayEnd = fromZonedTime(`${input.date.slice(0, 10)}T23:59:59.999`, tz);
    const dayEntries = await dbGetTimeEntries(
      memberRes.member.userId,
      org.orgId,
      dayStart,
      dayEnd,
    );
    if (dayEntries.length === 0) {
      return {
        summary: `No time entry found for ${memberRes.member.name} on ${input.date}. Use add_time_entry to create one.`,
        data: { status: "entry_not_found", date: input.date },
        isError: true,
      };
    }
    if (dayEntries.length > 1) {
      return {
        summary: `${memberRes.member.name} has ${dayEntries.length} time entries on ${input.date} (${dayEntries.map((e) => `#${e.id}`).join(", ")}). Please specify entry_id.`,
        data: {
          status: "multiple_entries_on_date",
          entries: dayEntries.map((e) =>
            formatEntryForResponse(e, memberMap, tz),
          ),
        },
        isError: true,
      };
    }
    targetEntry = dayEntries[0] ?? null;
  } else {
    return {
      summary:
        "Provide entry_id (or member + date) to identify which time entry to update.",
      data: { status: "missing_identifier" },
      isError: true,
    };
  }

  if (!targetEntry) {
    return {
      summary: "Time entry not found.",
      data: { status: "entry_not_found" },
      isError: true,
    };
  }

  const baseDateStr =
    input.date?.slice(0, 10) ||
    formatInTimeZone(new Date(targetEntry.clock_in), tz, "yyyy-MM-dd");

  const newClockIn = input.clock_in
    ? parseFlexibleDateTime(input.clock_in, tz, baseDateStr)
    : new Date(targetEntry.clock_in);

  if (!newClockIn) {
    return {
      summary: `Could not parse clock_in "${input.clock_in}".`,
      data: { status: "invalid_clock_in" },
      isError: true,
    };
  }

  let newClockOut: Date | null;
  if (input.clock_out === null) {
    newClockOut = null;
  } else if (input.clock_out !== undefined) {
    newClockOut = parseFlexibleDateTime(input.clock_out, tz, baseDateStr);
    if (!newClockOut) {
      return {
        summary: `Could not parse clock_out "${input.clock_out}".`,
        data: { status: "invalid_clock_out" },
        isError: true,
      };
    }
  } else if (input.hours_worked !== undefined) {
    newClockOut = new Date(
      newClockIn.getTime() + Math.round(input.hours_worked * 60 * 60 * 1000),
    );
  } else {
    newClockOut = targetEntry.clock_out
      ? new Date(targetEntry.clock_out)
      : null;
  }

  if (newClockOut && newClockOut.getTime() <= newClockIn.getTime()) {
    return {
      summary: `Clock-out time (${formatTimestampInTz(newClockOut, tz)}) must be after clock-in time (${formatTimestampInTz(newClockIn, tz)}).`,
      data: { status: "invalid_time_range" },
      isError: true,
    };
  }

  // Prevent double / overlapping times when editing an existing entry
  const overlapping = await dbFindOverlappingTimeEntries(
    targetEntry.user_id,
    org.orgId,
    newClockIn,
    newClockOut,
    targetEntry.id,
  );
  if (overlapping.length > 0) {
    return {
      summary: `Rejected to prevent double/overlapping times: updated hours overlap with entry #${overlapping[0]?.id} (${formatTimestampInTz(new Date(overlapping[0]?.clock_in ?? Date.now()), tz)}).`,
      data: {
        status: "overlapping_existing_entries",
        overlapping_entries: overlapping.map((e) =>
          formatEntryForResponse(e, memberMap, tz),
        ),
      },
      isError: true,
    };
  }

  const updated =
    input.skip_lunch !== undefined
      ? await dbUpdateTimeEntry(
          targetEntry.id,
          newClockIn,
          newClockOut,
          org.orgId,
          true,
          input.skip_lunch,
        )
      : await dbUpdateTimeEntry(
          targetEntry.id,
          newClockIn,
          newClockOut,
          org.orgId,
          true,
        );

  if (!updated) {
    return {
      summary: `Failed to update time entry #${targetEntry.id}.`,
      data: { status: "update_failed" },
      isError: true,
    };
  }

  invalidateTimeEntryCache(updated.user_id, org.orgId);

  const beforeFormatted = formatEntryForResponse(targetEntry, memberMap, tz);
  const afterFormatted = formatEntryForResponse(updated, memberMap, tz);

  return {
    summary: `Updated time entry #${updated.id} for ${afterFormatted.member_name} on ${afterFormatted.date}: ${afterFormatted.clock_in_local} → ${afterFormatted.clock_out_local ?? "active"} (${afterFormatted.formatted_duration}${input.skip_lunch !== undefined ? `, skip_lunch=${afterFormatted.skip_lunch}` : ""}).`,
    data: {
      status: "updated",
      organization: { org_id: org.orgId, name: org.orgName },
      before: beforeFormatted,
      entry: afterFormatted,
    },
  };
}

export async function toggleBreakTool(
  caller: McpCaller,
  input: z.infer<typeof toggleBreakInputSchema>,
): Promise<ToolResult> {
  const orgRes = await resolveOrg(caller.userId, input.org_id);
  if (!orgRes.ok) return orgRes.result;
  const { org } = orgRes;
  const tz = validTimezone(input.timezone);

  const members = await fetchOrgMembers(org.orgId);
  const memberRes = resolveMemberFromList(
    members,
    caller.userId,
    org.isAdmin,
    input.member,
  );
  if (!memberRes.ok) return memberRes.result;
  const target = memberRes.member;

  const active = await dbGetActiveEntry(target.userId, org.orgId);
  if (!active) {
    return {
      summary: `${target.name} is not currently clocked in at ${org.orgName}. Clock in before starting or ending a break.`,
      data: {
        status: "not_clocked_in",
        member: { user_id: target.userId, name: target.name },
      },
      isError: true,
    };
  }

  const openBreak = getOpenBreak(active);
  const requestedAction = input.action ?? "toggle";

  if (requestedAction === "start" && openBreak) {
    const formattedOpen = formatBreakForResponse(openBreak, tz);
    return {
      summary: `${target.name} is already on a ${formattedOpen.label} (${formattedOpen.formatted_duration} so far, since ${formattedOpen.break_start_local}). End the current break before starting another.`,
      data: {
        status: "break_already_running",
        active_entry_id: active.id,
        open_break: formattedOpen,
      },
      isError: true,
    };
  }

  if (requestedAction === "end" && !openBreak) {
    return {
      summary: `${target.name} does not have a break running right now.`,
      data: {
        status: "no_break_running",
        active_entry_id: active.id,
      },
      isError: true,
    };
  }

  const shouldEnd =
    requestedAction === "end" ||
    (requestedAction === "toggle" && Boolean(openBreak));

  if (shouldEnd) {
    const ended = await dbEndOpenBreak(target.userId, org.orgId);
    if (!ended) {
      return {
        summary: `${target.name} does not have a break running right now.`,
        data: {
          status: "no_break_running",
          active_entry_id: active.id,
        },
        isError: true,
      };
    }

    invalidateTimeEntryCache(target.userId, org.orgId);
    const formattedBreak = formatBreakForResponse(ended, tz);

    return {
      summary: `Ended ${formattedBreak.label} for ${target.name} at ${org.orgName} (${formattedBreak.formatted_duration}: ${formattedBreak.break_start_local} → ${formattedBreak.break_end_local}).`,
      data: {
        status: "break_ended",
        organization: { org_id: org.orgId, name: org.orgName },
        member: { user_id: target.userId, name: target.name },
        entry_id: active.id,
        break: formattedBreak,
      },
    };
  }

  const breakType: BreakType = input.break_type ?? DEFAULT_BREAK_TYPE;
  if (!isBreakType(breakType)) {
    return {
      summary: `Invalid break_type "${String(breakType)}". Use 'unpaid_meal', 'unpaid_rest', or 'paid_rest'.`,
      data: { status: "invalid_break_type", break_type: breakType },
      isError: true,
    };
  }

  const started = await dbStartBreak(target.userId, org.orgId, breakType);
  if (!started) {
    return {
      summary: `${target.name} already has a break running on their active shift.`,
      data: { status: "break_already_running", active_entry_id: active.id },
      isError: true,
    };
  }

  invalidateTimeEntryCache(target.userId, org.orgId);
  const formattedBreak = formatBreakForResponse(started, tz);

  return {
    summary: `Started ${formattedBreak.label} (${formattedBreak.paid ? "paid" : "unpaid"}) for ${target.name} at ${org.orgName} (${formattedBreak.break_start_local}).`,
    data: {
      status: "break_started",
      organization: { org_id: org.orgId, name: org.orgName },
      member: { user_id: target.userId, name: target.name },
      entry_id: active.id,
      break: formattedBreak,
    },
  };
}

async function resolveTargetEntryForBreak(
  org: OrgContext,
  callerUserId: string,
  members: OrgMemberInfo[],
  memberMap: Map<string, OrgMemberInfo>,
  tz: string,
  input: {
    entry_id?: number;
    member?: string;
    date?: string;
  },
): Promise<{ ok: true; entry: TimeEntry } | { ok: false; result: ToolResult }> {
  if (input.entry_id !== undefined) {
    const entry = await dbGetTimeEntryById(input.entry_id, org.orgId);
    if (!entry) {
      return {
        ok: false,
        result: {
          summary: `Time entry #${input.entry_id} was not found in ${org.orgName}.`,
          data: { status: "entry_not_found", entry_id: input.entry_id },
          isError: true,
        },
      };
    }
    if (!org.isAdmin && entry.user_id !== callerUserId) {
      return {
        ok: false,
        result: {
          summary:
            "Only organization admins (org:admin) can view or manage other members' breaks.",
          data: { status: "forbidden" },
          isError: true,
        },
      };
    }
    return { ok: true, entry };
  }

  const memberRes = resolveMemberFromList(
    members,
    callerUserId,
    org.isAdmin,
    input.member,
  );
  if (!memberRes.ok) return memberRes;
  const targetMember = memberRes.member;

  if (input.date) {
    const dateStr = input.date.slice(0, 10);
    const dayStart = fromZonedTime(`${dateStr}T00:00:00.000`, tz);
    const dayEnd = fromZonedTime(`${dateStr}T23:59:59.999`, tz);
    const dayEntries = await dbGetTimeEntries(
      targetMember.userId,
      org.orgId,
      dayStart,
      dayEnd,
    );
    if (dayEntries.length === 0) {
      return {
        ok: false,
        result: {
          summary: `No time entry found for ${targetMember.name} on ${dateStr}.`,
          data: { status: "entry_not_found", date: dateStr },
          isError: true,
        },
      };
    }
    if (dayEntries.length > 1) {
      return {
        ok: false,
        result: {
          summary: `${targetMember.name} has ${dayEntries.length} time entries on ${dateStr} (${dayEntries.map((e) => `#${e.id}`).join(", ")}). Please specify entry_id.`,
          data: {
            status: "multiple_entries_on_date",
            entries: dayEntries.map((e) =>
              formatEntryForResponse(e, memberMap, tz),
            ),
          },
          isError: true,
        },
      };
    }
    const found = dayEntries[0];
    if (found) return { ok: true, entry: found };
  }

  const active = await dbGetActiveEntry(targetMember.userId, org.orgId);
  if (active) {
    return { ok: true, entry: active };
  }

  return {
    ok: false,
    result: {
      summary:
        "Provide entry_id (or member + date) to identify the shift, or have an active clock-in shift.",
      data: { status: "missing_identifier" },
      isError: true,
    },
  };
}

export async function manageBreaksTool(
  caller: McpCaller,
  input: z.infer<typeof manageBreaksInputSchema>,
): Promise<ToolResult> {
  const action = input.action ?? "list";

  if (action === "start" || action === "end" || action === "toggle") {
    return toggleBreakTool(caller, {
      org_id: input.org_id,
      member: input.member,
      action,
      break_type: input.break_type,
      timezone: input.timezone,
    });
  }

  const orgRes = await resolveOrg(caller.userId, input.org_id);
  if (!orgRes.ok) return orgRes.result;
  const { org } = orgRes;
  const tz = validTimezone(input.timezone);

  const members = await fetchOrgMembers(org.orgId);
  const memberMap = new Map(members.map((m) => [m.userId, m]));

  if (action === "list") {
    const entryRes = await resolveTargetEntryForBreak(
      org,
      caller.userId,
      members,
      memberMap,
      tz,
      input,
    );
    if (!entryRes.ok) return entryRes.result;
    const entry = entryRes.entry;
    const breaks = entry.breaks ?? (await dbGetEntryBreaks(entry.id));
    const formattedBreaks = breaks.map((b) => formatBreakForResponse(b, tz));
    const formattedEntry = formatEntryForResponse(
      { ...entry, breaks },
      memberMap,
      tz,
    );

    return {
      summary:
        formattedBreaks.length === 0
          ? `Shift #${entry.id} for ${formattedEntry.member_name} on ${formattedEntry.date} has no recorded breaks.`
          : `Shift #${entry.id} for ${formattedEntry.member_name} on ${formattedEntry.date} has ${formattedBreaks.length} break${formattedBreaks.length === 1 ? "" : "s"}: ${formattedBreaks.map((b) => `#${b.id} ${b.label} (${b.formatted_duration}, ${b.paid ? "paid" : "unpaid"})`).join(", ")}.`,
      data: {
        status: "ok",
        organization: { org_id: org.orgId, name: org.orgName },
        entry: formattedEntry,
        breaks_count: formattedBreaks.length,
        breaks: formattedBreaks,
      },
    };
  }

  if (!org.isAdmin) {
    return {
      summary: `Only organization admins (org:admin) can ${action} breaks on time entries. Regular members can start and end live breaks on their active shift with toggle_break.`,
      data: { status: "forbidden" },
      isError: true,
    };
  }

  if (action === "add") {
    const entryRes = await resolveTargetEntryForBreak(
      org,
      caller.userId,
      members,
      memberMap,
      tz,
      input,
    );
    if (!entryRes.ok) return entryRes.result;
    const targetEntry = entryRes.entry;

    const breakType: BreakType = input.break_type ?? DEFAULT_BREAK_TYPE;
    if (!isBreakType(breakType)) {
      return {
        summary: `Invalid break_type "${String(breakType)}". Choose one of the 3 kinds: 'unpaid_meal', 'unpaid_rest', or 'paid_rest'.`,
        data: { status: "invalid_break_type", break_type: breakType },
        isError: true,
      };
    }

    const existingBreaks = targetEntry.breaks?.length
      ? targetEntry.breaks
      : await dbGetEntryBreaks(targetEntry.id);
    const shiftBaseDate =
      input.date?.slice(0, 10) ||
      formatInTimeZone(new Date(targetEntry.clock_in), tz, "yyyy-MM-dd");

    let breakStart: Date | null = null;
    let breakEnd: Date | null = null;
    const defaultDurationMinutes = breakType === "unpaid_meal" ? 30 : 15;

    if (input.break_start !== undefined) {
      breakStart = parseFlexibleDateTime(input.break_start, tz, shiftBaseDate);
      if (!breakStart) {
        return {
          summary: `Could not parse break_start "${input.break_start}".`,
          data: {
            status: "invalid_break_start",
            break_start: input.break_start,
          },
          isError: true,
        };
      }
      if (input.break_end !== undefined && input.break_end !== null) {
        breakEnd = parseFlexibleDateTime(input.break_end, tz, shiftBaseDate);
        if (!breakEnd) {
          return {
            summary: `Could not parse break_end "${input.break_end}".`,
            data: { status: "invalid_break_end", break_end: input.break_end },
            isError: true,
          };
        }
      } else if (input.duration_minutes !== undefined) {
        breakEnd = new Date(
          breakStart.getTime() + Math.round(input.duration_minutes * 60_000),
        );
      } else if (input.break_end === null || !targetEntry.clock_out) {
        breakEnd = null;
      } else {
        breakEnd = new Date(
          breakStart.getTime() + defaultDurationMinutes * 60_000,
        );
      }
    } else if (input.break_end !== undefined && input.break_end !== null) {
      breakEnd = parseFlexibleDateTime(input.break_end, tz, shiftBaseDate);
      if (!breakEnd) {
        return {
          summary: `Could not parse break_end "${input.break_end}".`,
          data: { status: "invalid_break_end", break_end: input.break_end },
          isError: true,
        };
      }
      const mins = input.duration_minutes ?? defaultDurationMinutes;
      breakStart = new Date(breakEnd.getTime() - Math.round(mins * 60_000));
    } else {
      // Place a break of `duration_minutes` (or default 30m/15m) inside the shift
      const mins = input.duration_minutes ?? defaultDurationMinutes;
      const durationMs = Math.round(mins * 60_000);
      const clockInMs = new Date(targetEntry.clock_in).getTime();
      const clockOutMs = targetEntry.clock_out
        ? new Date(targetEntry.clock_out).getTime()
        : Date.now();
      const sorted = [...existingBreaks].sort(
        (a, b) =>
          new Date(a.break_start).getTime() - new Date(b.break_start).getTime(),
      );
      const lastEndMs =
        sorted.length > 0
          ? Math.max(
              ...sorted.map((b) =>
                b.break_end ? new Date(b.break_end).getTime() : clockOutMs,
              ),
            )
          : null;
      const startMs =
        lastEndMs !== null && lastEndMs + durationMs <= clockOutMs
          ? lastEndMs
          : clockInMs +
            Math.max(0, Math.floor((clockOutMs - clockInMs - durationMs) / 2));
      breakStart = new Date(startMs);
      breakEnd = new Date(startMs + durationMs);
    }

    const invalid = validateBreak({
      entry: {
        clock_in: targetEntry.clock_in,
        clock_out: targetEntry.clock_out,
      },
      breaks: existingBreaks,
      break_start: breakStart,
      break_end: breakEnd,
      break_type: breakType,
    });
    if (invalid) {
      return {
        summary: `Cannot add break to shift #${targetEntry.id}: ${invalid}.`,
        data: {
          status: "invalid_break",
          reason: invalid,
          entry_id: targetEntry.id,
        },
        isError: true,
      };
    }

    const inserted = await dbInsertBreak(
      targetEntry.id,
      org.orgId,
      breakStart,
      breakEnd,
      breakType,
    );
    if (!inserted) {
      return {
        summary: `Failed to add break to shift #${targetEntry.id}.`,
        data: { status: "add_break_failed", entry_id: targetEntry.id },
        isError: true,
      };
    }

    invalidateTimeEntryCache(targetEntry.user_id, org.orgId);

    const formattedBreak = formatBreakForResponse(inserted, tz);
    const memberName =
      memberMap.get(targetEntry.user_id)?.name ?? targetEntry.user_id;

    return {
      summary: `Added ${formattedBreak.label} (${formattedBreak.paid ? "paid" : "unpaid"}, ${formattedBreak.formatted_duration}: ${formattedBreak.break_start_local} → ${formattedBreak.break_end_local ?? "open"}) to shift #${targetEntry.id} for ${memberName}.`,
      data: {
        status: "break_added",
        organization: { org_id: org.orgId, name: org.orgName },
        entry_id: targetEntry.id,
        member_name: memberName,
        break: formattedBreak,
      },
    };
  }

  // Locate target break for "update" or "delete"
  let existingBreak: {
    id: number;
    time_entry_id: number;
    break_type: BreakType;
    break_start: Date;
    break_end: Date | null;
    user_id: string;
    org_id: string;
    clock_in: Date;
    clock_out: Date | null;
  } | null = null;
  let siblingBreaks: TimeEntryBreak[] = [];

  if (input.break_id !== undefined) {
    const found = await dbGetBreakWithEntry(input.break_id, org.orgId);
    if (!found) {
      return {
        summary: `Break #${input.break_id} was not found in ${org.orgName}.`,
        data: { status: "break_not_found", break_id: input.break_id },
        isError: true,
      };
    }
    existingBreak = found;
    siblingBreaks = await dbGetEntryBreaks(found.time_entry_id);
  } else {
    const entryRes = await resolveTargetEntryForBreak(
      org,
      caller.userId,
      members,
      memberMap,
      tz,
      input,
    );
    if (!entryRes.ok) return entryRes.result;
    const targetEntry = entryRes.entry;
    siblingBreaks = targetEntry.breaks?.length
      ? targetEntry.breaks
      : await dbGetEntryBreaks(targetEntry.id);
    if (siblingBreaks.length === 0) {
      return {
        summary: `Time entry #${targetEntry.id} has no breaks to ${action}.`,
        data: { status: "break_not_found", entry_id: targetEntry.id },
        isError: true,
      };
    }
    if (siblingBreaks.length > 1) {
      return {
        summary: `Time entry #${targetEntry.id} has ${siblingBreaks.length} breaks (${siblingBreaks.map((b) => `#${b.id} ${breakTypeLabel(b.break_type)}`).join(", ")}). Please specify break_id.`,
        data: {
          status: "multiple_breaks_on_entry",
          entry_id: targetEntry.id,
          breaks: siblingBreaks.map((b) => formatBreakForResponse(b, tz)),
        },
        isError: true,
      };
    }
    const only = siblingBreaks[0];
    if (only) {
      existingBreak = {
        ...only,
        user_id: targetEntry.user_id,
        org_id: targetEntry.org_id,
        clock_in: targetEntry.clock_in,
        clock_out: targetEntry.clock_out,
      };
    }
  }

  if (!existingBreak) {
    return {
      summary: "Break not found.",
      data: { status: "break_not_found" },
      isError: true,
    };
  }

  if (action === "delete") {
    const deleted = await dbDeleteBreak(existingBreak.id, org.orgId);
    if (!deleted) {
      return {
        summary: `Break #${existingBreak.id} was not found in ${org.orgName}.`,
        data: { status: "break_not_found", break_id: existingBreak.id },
        isError: true,
      };
    }

    invalidateTimeEntryCache(existingBreak.user_id, org.orgId);
    const formattedDeleted = formatBreakForResponse(
      { ...existingBreak, ...deleted },
      tz,
    );
    const memberName =
      memberMap.get(existingBreak.user_id)?.name ?? existingBreak.user_id;

    return {
      summary: `Deleted break #${deleted.id} (${formattedDeleted.label}, ${formattedDeleted.formatted_duration}) from shift #${deleted.time_entry_id} for ${memberName}.`,
      data: {
        status: "break_deleted",
        organization: { org_id: org.orgId, name: org.orgName },
        entry_id: deleted.time_entry_id,
        member_name: memberName,
        deleted_break: formattedDeleted,
      },
    };
  }

  // action === "update"
  const newBreakType: BreakType = input.break_type ?? existingBreak.break_type;
  if (!isBreakType(newBreakType)) {
    return {
      summary: `Invalid break_type "${String(newBreakType)}". Choose one of the 3 kinds: 'unpaid_meal', 'unpaid_rest', or 'paid_rest'.`,
      data: { status: "invalid_break_type", break_type: newBreakType },
      isError: true,
    };
  }

  const shiftBaseDate =
    input.date?.slice(0, 10) ||
    formatInTimeZone(new Date(existingBreak.clock_in), tz, "yyyy-MM-dd");

  let newBreakStart: Date;
  if (input.break_start !== undefined) {
    const parsed = parseFlexibleDateTime(input.break_start, tz, shiftBaseDate);
    if (!parsed) {
      return {
        summary: `Could not parse break_start "${input.break_start}".`,
        data: { status: "invalid_break_start", break_start: input.break_start },
        isError: true,
      };
    }
    newBreakStart = parsed;
  } else {
    newBreakStart = new Date(existingBreak.break_start);
  }

  let newBreakEnd: Date | null;
  if (input.break_end === null) {
    newBreakEnd = null;
  } else if (input.break_end !== undefined) {
    const parsed = parseFlexibleDateTime(input.break_end, tz, shiftBaseDate);
    if (!parsed) {
      return {
        summary: `Could not parse break_end "${input.break_end}".`,
        data: { status: "invalid_break_end", break_end: input.break_end },
        isError: true,
      };
    }
    newBreakEnd = parsed;
  } else if (input.duration_minutes !== undefined) {
    newBreakEnd = new Date(
      newBreakStart.getTime() + Math.round(input.duration_minutes * 60_000),
    );
  } else {
    newBreakEnd = existingBreak.break_end
      ? new Date(existingBreak.break_end)
      : null;
  }

  const invalid = validateBreak({
    entry: {
      clock_in: existingBreak.clock_in,
      clock_out: existingBreak.clock_out,
    },
    breaks: siblingBreaks,
    break_start: newBreakStart,
    break_end: newBreakEnd,
    break_type: newBreakType,
    excludeBreakId: existingBreak.id,
  });
  if (invalid) {
    return {
      summary: `Cannot update break #${existingBreak.id}: ${invalid}.`,
      data: {
        status: "invalid_break",
        reason: invalid,
        break_id: existingBreak.id,
      },
      isError: true,
    };
  }

  const updated = await dbUpdateBreak(
    existingBreak.id,
    org.orgId,
    newBreakStart,
    newBreakEnd,
    newBreakType,
  );
  if (!updated) {
    return {
      summary: `Failed to update break #${existingBreak.id}.`,
      data: { status: "update_failed", break_id: existingBreak.id },
      isError: true,
    };
  }

  invalidateTimeEntryCache(existingBreak.user_id, org.orgId);

  const beforeFormatted = formatBreakForResponse(existingBreak, tz);
  const afterFormatted = formatBreakForResponse(updated, tz);
  const memberName =
    memberMap.get(existingBreak.user_id)?.name ?? existingBreak.user_id;

  return {
    summary: `Updated break #${updated.id} on shift #${updated.time_entry_id} for ${memberName}: ${afterFormatted.label} (${afterFormatted.paid ? "paid" : "unpaid"}, ${afterFormatted.formatted_duration}: ${afterFormatted.break_start_local} → ${afterFormatted.break_end_local ?? "open"}).`,
    data: {
      status: "break_updated",
      organization: { org_id: org.orgId, name: org.orgName },
      entry_id: updated.time_entry_id,
      member_name: memberName,
      before: beforeFormatted,
      break: afterFormatted,
    },
  };
}

export async function deleteTimeEntryTool(
  caller: McpCaller,
  input: z.infer<typeof deleteTimeEntryInputSchema>,
): Promise<ToolResult> {
  const orgRes = await resolveOrg(caller.userId, input.org_id);
  if (!orgRes.ok) return orgRes.result;
  const { org } = orgRes;

  if (!org.isAdmin) {
    return {
      summary: "Only organization admins (org:admin) can delete time entries.",
      data: { status: "forbidden" },
      isError: true,
    };
  }

  const deleted = await dbDeleteTimeEntry(input.entry_id, org.orgId);
  if (!deleted) {
    return {
      summary: `Time entry #${input.entry_id} was not found in ${org.orgName}.`,
      data: { status: "entry_not_found", entry_id: input.entry_id },
      isError: true,
    };
  }

  invalidateTimeEntryCache(deleted.user_id, org.orgId);

  const members = await fetchOrgMembers(org.orgId);
  const memberMap = new Map(members.map((m) => [m.userId, m]));
  const formatted = formatEntryForResponse(
    deleted,
    memberMap,
    DEFAULT_TIMEZONE,
  );

  return {
    summary: `Deleted time entry #${deleted.id} for ${formatted.member_name} (${formatted.date}, ${formatted.formatted_duration}).`,
    data: {
      status: "deleted",
      organization: { org_id: org.orgId, name: org.orgName },
      deleted_entry: formatted,
    },
  };
}

export async function manageReportingSettingsTool(
  caller: McpCaller,
  input: z.infer<typeof manageReportingSettingsInputSchema>,
): Promise<ToolResult> {
  const orgRes = await resolveOrg(caller.userId, input.org_id);
  if (!orgRes.ok) return orgRes.result;
  const { org } = orgRes;

  const hasSettingsInput =
    input.report_frequency !== undefined ||
    input.report_day !== undefined ||
    input.report_interval !== undefined;

  const action = input.action ?? (hasSettingsInput ? "update" : "get");

  if (action === "get") {
    const [settings, reportingEnabled] = await Promise.all([
      dbGetReportingSettings(org.orgId),
      orgHasReportingFeature(org.orgId),
    ]);
    return {
      summary: settings
        ? `Reporting settings for ${org.orgName}: frequency=${settings.report_frequency}, day=${settings.report_day ?? "default"}, interval=${settings.report_interval}.`
        : `No custom reporting settings saved yet for ${org.orgName} (defaults to weekly).`,
      data: {
        organization: { org_id: org.orgId, name: org.orgName },
        reporting_enabled: reportingEnabled,
        settings: settings ?? {
          org_id: org.orgId,
          report_frequency: "weekly",
          report_day: null,
          report_interval: 1,
        },
      },
    };
  }

  if (!org.isAdmin) {
    return {
      summary:
        "Only organization admins (org:admin) can update reporting settings or trigger weekly report emails.",
      data: { status: "forbidden" },
      isError: true,
    };
  }

  if (!(await orgHasReportingFeature(org.orgId))) {
    return {
      summary: `${org.orgName} isn't on a plan that includes Reporting. Upgrade the organization's plan in Clock Out (https://clockout.patmac.ca) to change reporting settings or send reports.`,
      data: {
        status: "reporting_not_enabled",
        organization: { org_id: org.orgId, name: org.orgName },
      },
      isError: true,
    };
  }

  if (action === "send_test_report") {
    const endDate = new Date();
    const startDate = startOfDay(subDays(endDate, 7));
    const sent = await sendWeeklyReports(startDate, endDate, org.orgId);
    return {
      summary: sent
        ? `Sent the weekly hours report email for ${org.orgName} to organization admins.`
        : `Could not send the weekly report email (verify AWS SES credentials and reporting subscription feature).`,
      data: {
        status: sent ? "report_sent" : "report_skipped",
        organization: { org_id: org.orgId, name: org.orgName },
      },
    };
  }

  const current = await dbGetReportingSettings(org.orgId);
  const wantsCustom = input.report_day != null || input.report_interval != null;

  let rawFreq = input.report_frequency;
  if (rawFreq === "biweekly") rawFreq = "bi-weekly";

  const frequency =
    rawFreq ??
    (wantsCustom
      ? current?.report_frequency === "bi-weekly" || input.report_interval === 2
        ? "bi-weekly"
        : (current?.report_frequency ?? "custom")
      : (current?.report_frequency ?? "weekly"));

  const isDayBased = frequency === "custom" || frequency === "bi-weekly";
  const defaultDay = frequency === "bi-weekly" ? "Friday" : "Monday";
  const day = isDayBased
    ? (input.report_day ?? current?.report_day ?? defaultDay)
    : null;
  const interval =
    frequency === "bi-weekly"
      ? 2
      : frequency === "custom"
        ? (input.report_interval ?? current?.report_interval ?? 1)
        : 1;

  const updated = await dbUpdateReportingSettings(
    org.orgId,
    frequency,
    day,
    interval,
  );
  invalidateReportingSettingsCache(org.orgId);

  return {
    summary: `Updated reporting settings for ${org.orgName}: frequency=${updated.report_frequency}${updated.report_day ? `, day=${updated.report_day}, interval=${updated.report_interval}w` : ""}.`,
    data: {
      status: "updated",
      organization: { org_id: org.orgId, name: org.orgName },
      settings: updated,
    },
  };
}

const DEFAULT_LUNCH_DURATION_MINUTES = 30;
const DEFAULT_LUNCH_MIN_SHIFT_HOURS = 5;

function describeBreakSettings(settings: {
  dock_lunch: boolean;
  lunch_duration_minutes: number;
  lunch_min_shift_hours: number;
}) {
  return settings.dock_lunch
    ? `deducting ${Number(settings.lunch_duration_minutes)} min from shifts of ${Number(settings.lunch_min_shift_hours)}h or longer`
    : "not deducting lunch/breaks";
}

/**
 * Lunch/break deduction settings. Free for every organization (no plan
 * feature needed); anyone can view them, only admins can change them.
 */
export async function manageBreakSettingsTool(
  caller: McpCaller,
  input: z.infer<typeof manageBreakSettingsInputSchema>,
): Promise<ToolResult> {
  const orgRes = await resolveOrg(caller.userId, input.org_id);
  if (!orgRes.ok) return orgRes.result;
  const { org } = orgRes;

  const current = await dbGetBreakSettings(org.orgId);
  const currentSettings = {
    org_id: org.orgId,
    dock_lunch: current?.dock_lunch ?? false,
    lunch_duration_minutes: Number(
      current?.lunch_duration_minutes ?? DEFAULT_LUNCH_DURATION_MINUTES,
    ),
    lunch_min_shift_hours: Number(
      current?.lunch_min_shift_hours ?? DEFAULT_LUNCH_MIN_SHIFT_HOURS,
    ),
  };

  if ((input.action ?? "get") === "get") {
    return {
      summary: `Lunch/break settings for ${org.orgName}: ${describeBreakSettings(currentSettings)}.`,
      data: {
        organization: { org_id: org.orgId, name: org.orgName },
        settings: currentSettings,
      },
    };
  }

  if (!org.isAdmin) {
    return {
      summary:
        "Only organization admins (org:admin) can change lunch/break deduction settings.",
      data: { status: "forbidden" },
      isError: true,
    };
  }

  if (
    input.action !== "toggle" &&
    input.dock_lunch === undefined &&
    input.lunch_duration_minutes === undefined &&
    input.lunch_min_shift_hours === undefined
  ) {
    return {
      summary:
        "Nothing to update. Pass dock_lunch, lunch_duration_minutes, and/or lunch_min_shift_hours.",
      data: { status: "invalid_input", settings: currentSettings },
      isError: true,
    };
  }

  const nextDockLunch =
    input.dock_lunch ??
    (input.action === "toggle"
      ? !currentSettings.dock_lunch
      : currentSettings.dock_lunch);

  const updated = await dbUpdateBreakSettings(
    org.orgId,
    nextDockLunch,
    input.lunch_duration_minutes ?? currentSettings.lunch_duration_minutes,
    input.lunch_min_shift_hours ?? currentSettings.lunch_min_shift_hours,
  );
  invalidateBreakSettingsCache(org.orgId);

  return {
    summary: `Updated lunch/break settings for ${org.orgName}: ${describeBreakSettings(updated)}.`,
    data: {
      status: "updated",
      organization: { org_id: org.orgId, name: org.orgName },
      settings: updated,
    },
  };
}

/** Longest period an on-demand hours report may cover. */
const MAX_REPORT_DAYS = 366;

/**
 * On-demand hours report for admins of organizations on a plan with the paid
 * "reporting" feature. Works whether or not a reporting schedule is set:
 * returns each member's net hours (after lunch/break deductions, matching the
 * emailed reports) for any date range, and can also email it to the admins.
 */
export async function runHoursReportTool(
  caller: McpCaller,
  input: z.infer<typeof runHoursReportInputSchema>,
): Promise<ToolResult> {
  const orgRes = await resolveOrg(caller.userId, input.org_id);
  if (!orgRes.ok) return orgRes.result;
  const { org } = orgRes;

  if (!org.isAdmin) {
    return {
      summary:
        "Only organization admins (org:admin) can run hours reports. Members can still view their own hours with get_weekly_timecard.",
      data: { status: "forbidden" },
      isError: true,
    };
  }

  if (!(await orgHasReportingFeature(org.orgId))) {
    return {
      summary: `${org.orgName} isn't on a plan that includes Reporting. Upgrade the organization's plan in Clock Out (https://clockout.patmac.ca) to run hours reports.`,
      data: {
        status: "reporting_not_enabled",
        organization: { org_id: org.orgId, name: org.orgName },
      },
      isError: true,
    };
  }

  const tz = validTimezone(input.timezone);
  const startStr = input.start_date.slice(0, 10);
  const endStr = input.end_date.slice(0, 10);
  const startDate = fromZonedTime(`${startStr}T00:00:00.000`, tz);
  const endDate = fromZonedTime(`${endStr}T23:59:59.999`, tz);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return {
      summary: "start_date and end_date must be valid dates (YYYY-MM-DD).",
      data: { status: "invalid_dates" },
      isError: true,
    };
  }
  if (startDate > endDate) {
    return {
      summary: `start_date (${startStr}) must be on or before end_date (${endStr}).`,
      data: { status: "invalid_dates" },
      isError: true,
    };
  }
  if (endDate.getTime() - startDate.getTime() > MAX_REPORT_DAYS * 86_400_000) {
    return {
      summary: `Hours reports can cover at most ${MAX_REPORT_DAYS} days. Split the period into smaller ranges.`,
      data: { status: "range_too_long" },
      isError: true,
    };
  }

  const members = await fetchOrgMembers(org.orgId);
  const memberMap = new Map(members.map((m) => [m.userId, m]));

  const requestedMember = input.member?.trim();
  const wantsAll = !requestedMember || requestedMember.toLowerCase() === "all";

  let targetMembers: OrgMemberInfo[];
  let entries: TimeEntry[];
  if (wantsAll) {
    targetMembers = members;
    entries = await dbGetOrgTimeEntries(org.orgId, startDate, endDate);
  } else {
    const memberRes = resolveMemberFromList(
      members,
      caller.userId,
      org.isAdmin,
      requestedMember,
    );
    if (!memberRes.ok) return memberRes.result;
    targetMembers = [memberRes.member];
    entries = await dbGetTimeEntries(
      memberRes.member.userId,
      org.orgId,
      startDate,
      endDate,
    );
  }

  const breakSettings = (await dbGetBreakSettings(org.orgId)) ?? null;
  const nowMs = Date.now();

  const entriesByUser = new Map<string, TimeEntry[]>();
  for (const entry of entries) {
    const list = entriesByUser.get(entry.user_id) ?? [];
    list.push(entry);
    entriesByUser.set(entry.user_id, list);
  }

  let orgNetMs = 0;
  const reports = targetMembers.map((m) => {
    const userEntries = (entriesByUser.get(m.userId) ?? []).sort(
      (a, b) => new Date(a.clock_in).getTime() - new Date(b.clock_in).getTime(),
    );

    let grossMs = 0;
    let netMs = 0;
    let activeShifts = 0;
    const days = new Map<
      string,
      {
        date: string;
        day_of_week: string;
        netMs: number;
        shifts: (ReturnType<typeof formatEntryForResponse> & {
          net_hours: number;
        })[];
      }
    >();

    for (const entry of userEntries) {
      const formatted = formatEntryForResponse(entry, memberMap, tz);
      const inMs = new Date(entry.clock_in).getTime();
      const outMs = entry.clock_out
        ? new Date(entry.clock_out).getTime()
        : nowMs;
      const shiftGross = Math.max(0, outMs - inMs);
      const shiftNet = getEffectiveDurationMs(entry, breakSettings, nowMs);
      grossMs += shiftGross;
      netMs += shiftNet;
      if (!entry.clock_out) activeShifts += 1;

      const day = days.get(formatted.date) ?? {
        date: formatted.date,
        day_of_week: formatted.day_of_week,
        netMs: 0,
        shifts: [],
      };
      day.netMs += shiftNet;
      day.shifts.push({
        ...formatted,
        net_hours: formatDurationMs(shiftNet).decimalHours,
      });
      days.set(formatted.date, day);
    }

    orgNetMs += netMs;
    const net = formatDurationMs(netMs);
    const gross = formatDurationMs(grossMs);

    return {
      user_id: m.userId,
      name: m.name,
      email: m.email,
      role: m.role,
      total_hours: net.decimalHours,
      formatted_total: net.formatted,
      gross_hours: gross.decimalHours,
      break_deduction_hours: Number(
        (gross.decimalHours - net.decimalHours).toFixed(2),
      ),
      days_worked: days.size,
      shifts_count: userEntries.length,
      active_shifts: activeShifts,
      daily_breakdown: Array.from(days.values()).map((d) => {
        const dayDur = formatDurationMs(d.netMs);
        return {
          date: d.date,
          day_of_week: d.day_of_week,
          total_hours: dayDur.decimalHours,
          formatted_total: dayDur.formatted,
          shifts: d.shifts,
        };
      }),
    };
  });

  const deliver = input.deliver ?? "chat";
  let email: Record<string, unknown> | undefined;
  if (deliver === "email_admins" || deliver === "both") {
    const recipients = members
      .filter((m) => m.isAdmin && m.email)
      .map((m) => m.email as string);
    const withHours = reports
      .filter((r) => r.shifts_count > r.active_shifts)
      .map((r) => r.user_id);

    let sent = false;
    if (recipients.length > 0 && withHours.length > 0) {
      // The email pipeline works on whole days at midnight (exclusive end),
      // the same way the scheduled reports call it.
      const emailStart = startOfDay(new Date(`${startStr}T00:00:00`));
      const emailEnd = addDays(startOfDay(new Date(`${endStr}T00:00:00`)), 1);
      sent = await sendWeeklyReports(
        emailStart,
        emailEnd,
        org.orgId,
        "custom",
        {
          userIds: withHours,
        },
      );
    }

    email = {
      status: sent
        ? "sent"
        : recipients.length === 0
          ? "no_admin_recipients"
          : withHours.length === 0
            ? "no_completed_shifts"
            : "failed",
      recipients,
      members_emailed: reports
        .filter((r) => withHours.includes(r.user_id))
        .map((r) => r.name),
    };
  }

  const orgNet = formatDurationMs(orgNetMs);
  const periodLabel = `${startStr} to ${endStr}`;
  const hoursSummary =
    reports.length === 1 && reports[0]
      ? `${reports[0].name} worked ${reports[0].formatted_total} (${reports[0].total_hours}h) from ${periodLabel} across ${reports[0].days_worked} day${reports[0].days_worked === 1 ? "" : "s"}.`
      : `Hours report for ${org.orgName} (${periodLabel}): ${orgNet.formatted} total — ${reports.map((r) => `${r.name}: ${r.formatted_total}`).join(", ")}.`;

  let emailSummary = "";
  if (email) {
    emailSummary =
      email.status === "sent"
        ? ` Emailed the report to ${(email.recipients as string[]).join(", ")}.`
        : email.status === "no_completed_shifts"
          ? " No email sent: there are no completed shifts in this period."
          : email.status === "no_admin_recipients"
            ? " No email sent: no admin has an email address."
            : " Could not send the report email (check the email service configuration).";
  }

  return {
    summary: `${deliver === "email_admins" ? `Report for ${periodLabel} prepared.` : hoursSummary}${emailSummary}`,
    data: {
      status: "ok",
      organization: { org_id: org.orgId, name: org.orgName },
      period: {
        label: periodLabel,
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        timezone: tz,
      },
      hours_are_net_of_breaks: Boolean(breakSettings?.dock_lunch),
      organization_total_hours: orgNet.decimalHours,
      organization_formatted_total: orgNet.formatted,
      ...(deliver === "email_admins" ? {} : { reports }),
      ...(email ? { email } : {}),
    },
    ...(email && email.status === "failed" ? { isError: true } : {}),
  };
}

const APP_ORIGIN_FOR_INVITES =
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") ||
  "https://clockout.patmac.ca";

function normalizeInviteRole(
  role?: "org:member" | "org:admin" | "member" | "admin",
): "org:member" | "org:admin" {
  if (role === "org:admin" || role === "admin") return "org:admin";
  return "org:member";
}

function isValidEmailAddress(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function inviteMemberTool(
  caller: McpCaller,
  input: z.infer<typeof inviteMemberInputSchema>,
): Promise<ToolResult> {
  const orgRes = await resolveOrg(caller.userId, input.org_id);
  if (!orgRes.ok) return orgRes.result;
  const { org } = orgRes;

  if (!org.isAdmin) {
    return {
      summary:
        "Only organization admins (org:admin) can invite users or manage organization invitations.",
      data: { status: "forbidden" },
      isError: true,
    };
  }

  const action = input.action ?? "send";
  const client = await clerkClient();

  if (action === "list") {
    const invitationsRes = await fetchAllPages(
      (params) =>
        client.organizations.getOrganizationInvitationList({
          organizationId: org.orgId,
          status: ["pending"],
          ...params,
        }),
      { label: `invitations of ${org.orgId}` },
    );

    const invitations = invitationsRes.map((inv) => ({
      invitation_id: inv.id,
      email_address: inv.emailAddress,
      role: inv.role,
      status: inv.status ?? "pending",
      created_at: new Date(inv.createdAt).toISOString(),
      updated_at: new Date(inv.updatedAt).toISOString(),
    }));

    return {
      summary:
        invitations.length === 0
          ? `There are no pending invitations for ${org.orgName}.`
          : `${org.orgName} has ${invitations.length} pending invitation${invitations.length === 1 ? "" : "s"}: ${invitations.map((i) => `${i.email_address} (${i.role}, ${i.invitation_id})`).join(", ")}.`,
      data: {
        status: "ok",
        organization: { org_id: org.orgId, name: org.orgName },
        pending_count: invitations.length,
        invitations,
      },
    };
  }

  if (action === "revoke") {
    let targetInvitationId = input.invitation_id?.trim() || null;
    const targetEmail = input.email?.trim().toLowerCase() || null;

    if (!targetInvitationId && !targetEmail) {
      return {
        summary:
          "Provide either invitation_id (orginv_...) or email to revoke a pending invitation.",
        data: { status: "missing_identifier" },
        isError: true,
      };
    }

    if (!targetInvitationId && targetEmail) {
      const pendingRes = await fetchAllPages(
        (params) =>
          client.organizations.getOrganizationInvitationList({
            organizationId: org.orgId,
            status: ["pending"],
            ...params,
          }),
        { label: `invitations of ${org.orgId}` },
      );
      const matched = pendingRes.find(
        (inv) => inv.emailAddress.toLowerCase() === targetEmail,
      );
      if (!matched) {
        return {
          summary: `No pending invitation found for "${targetEmail}" in ${org.orgName}.`,
          data: {
            status: "invitation_not_found",
            email: targetEmail,
            organization: { org_id: org.orgId, name: org.orgName },
          },
          isError: true,
        };
      }
      targetInvitationId = matched.id;
    }

    try {
      const revoked = await client.organizations.revokeOrganizationInvitation({
        organizationId: org.orgId,
        invitationId: targetInvitationId as string,
        requestingUserId: caller.userId,
      });

      return {
        summary: `Revoked pending invitation for ${revoked.emailAddress} (${revoked.id}) in ${org.orgName}.`,
        data: {
          status: "revoked",
          organization: { org_id: org.orgId, name: org.orgName },
          invitation: {
            invitation_id: revoked.id,
            email_address: revoked.emailAddress,
            role: revoked.role,
            status: revoked.status ?? "revoked",
          },
        },
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not revoke invitation";
      return {
        summary: `Failed to revoke invitation ${targetInvitationId}: ${message}`,
        data: {
          status: "revoke_failed",
          invitation_id: targetInvitationId,
          error: message,
        },
        isError: true,
      };
    }
  }

  // action === "send"
  const rawEmails = [
    ...(input.email ? [input.email] : []),
    ...(input.emails ?? []),
  ];
  const uniqueEmails = Array.from(
    new Set(
      rawEmails.map((e) => e.trim().toLowerCase()).filter((e) => e.length > 0),
    ),
  );

  if (uniqueEmails.length === 0) {
    return {
      summary:
        "Provide an email (or emails array) to invite to the organization.",
      data: { status: "missing_email" },
      isError: true,
    };
  }

  const invalidEmails = uniqueEmails.filter((e) => !isValidEmailAddress(e));
  if (invalidEmails.length > 0) {
    return {
      summary: `Invalid email address${invalidEmails.length === 1 ? "" : "es"}: ${invalidEmails.join(", ")}.`,
      data: { status: "invalid_email", invalid_emails: invalidEmails },
      isError: true,
    };
  }

  if (await isOverMemberShipLimit(org.orgId)) {
    return {
      summary: `${org.orgName} has reached its membership limit. Upgrade the organization plan on Clock Out before inviting more members.`,
      data: { status: "membership_limit_reached", org_id: org.orgId },
      isError: true,
    };
  }

  const role = normalizeInviteRole(input.role);

  const [existingMembers, pendingInvitationsRes] = await Promise.all([
    fetchOrgMembers(org.orgId),
    fetchAllPages(
      (params) =>
        client.organizations.getOrganizationInvitationList({
          organizationId: org.orgId,
          status: ["pending"],
          ...params,
        }),
      { label: `invitations of ${org.orgId}` },
    ),
  ]);

  const memberEmails = new Set(
    existingMembers
      .map((m) => m.email?.toLowerCase())
      .filter((e): e is string => Boolean(e)),
  );
  const pendingByEmail = new Map(
    pendingInvitationsRes.map((inv) => [inv.emailAddress.toLowerCase(), inv]),
  );

  const sent: Array<{
    invitation_id: string;
    email_address: string;
    role: string;
    status: string;
    created_at: string;
  }> = [];
  const skipped: Array<{
    email_address: string;
    reason: string;
    invitation_id?: string;
  }> = [];
  const failed: Array<{ email_address: string; error: string }> = [];

  for (const email of uniqueEmails) {
    if (memberEmails.has(email)) {
      skipped.push({
        email_address: email,
        reason: "already_member",
      });
      continue;
    }

    const existingPending = pendingByEmail.get(email);
    if (existingPending) {
      skipped.push({
        email_address: email,
        reason: "already_invited",
        invitation_id: existingPending.id,
      });
      continue;
    }

    try {
      const invitation =
        await client.organizations.createOrganizationInvitation({
          organizationId: org.orgId,
          inviterUserId: caller.userId,
          emailAddress: email,
          role,
          redirectUrl: APP_ORIGIN_FOR_INVITES,
        });

      sent.push({
        invitation_id: invitation.id,
        email_address: invitation.emailAddress,
        role: invitation.role,
        status: invitation.status ?? "pending",
        created_at: new Date(invitation.createdAt).toISOString(),
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to send invitation";
      failed.push({ email_address: email, error: message });
    }
  }

  const parts: string[] = [];
  if (sent.length > 0) {
    parts.push(
      `Invited ${sent.map((s) => `${s.email_address} (${s.role})`).join(", ")} to ${org.orgName}`,
    );
  }
  if (skipped.length > 0) {
    parts.push(
      `Skipped ${skipped.map((s) => `${s.email_address} (${s.reason === "already_member" ? "already a member" : "invitation already pending"})`).join(", ")}`,
    );
  }
  if (failed.length > 0) {
    parts.push(
      `Failed ${failed.map((f) => `${f.email_address} (${f.error})`).join(", ")}`,
    );
  }

  const isError = sent.length === 0 && failed.length > 0;

  return {
    summary: `${parts.join(". ")}.`,
    data: {
      status:
        sent.length > 0
          ? "invited"
          : skipped.length > 0
            ? "skipped"
            : "invite_failed",
      organization: { org_id: org.orgId, name: org.orgName },
      role,
      sent,
      skipped,
      failed,
    },
    ...(isError ? { isError: true } : {}),
  };
}

export async function getLocationSettingsTool(
  caller: McpCaller,
  input: z.infer<typeof getLocationSettingsInputSchema>,
): Promise<ToolResult> {
  const orgRes = await resolveOrg(caller.userId, input.org_id);
  if (!orgRes.ok) return orgRes.result;
  const { org } = orgRes;

  const [settings, sites] = await Promise.all([
    dbGetLocationSettings(org.orgId).catch(() => undefined),
    dbGetSites(org.orgId).catch(() => []),
  ]);

  const captureMode = settings?.capture_mode ?? "off";
  const restrictClockIn = settings?.restrict_clock_in ?? false;
  const siteList = (sites as SiteData[]).map((s) => ({
    id: s.id,
    name: s.name,
    address: s.address ?? null,
    latitude: Number(s.latitude),
    longitude: Number(s.longitude),
    radius_meters: Number(s.radius_meters),
  }));

  const modeDescriptions: Record<string, string> = {
    off: "Location capture is OFF. No coordinates or sites are recorded.",
    optional:
      "Location capture is OPTIONAL. Recorded when shared or specified, but clock-in is never blocked.",
    required:
      "Location capture is REQUIRED. A valid location (site, address, or coordinates) must be provided to clock in.",
  };

  const restrictionText = restrictClockIn
    ? " Clock-in is strictly restricted to approved work sites (geofenced)."
    : "";

  return {
    summary: `Location settings for ${org.orgName}: ${captureMode.toUpperCase()} — ${modeDescriptions[captureMode] ?? captureMode}.${restrictionText} (${siteList.length} site${siteList.length === 1 ? "" : "s"} configured).`,
    data: {
      organization: { org_id: org.orgId, name: org.orgName },
      settings: {
        capture_mode: captureMode,
        restrict_clock_in: restrictClockIn,
      },
      sites: siteList,
    },
  };
}
