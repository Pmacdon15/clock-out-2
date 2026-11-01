import { format } from "date-fns";
import type { TimeOffRequest, TimeOffStatus, TimeOffType } from "./types";

export const TIME_OFF_TYPES: TimeOffType[] = ["vacation", "sick", "unpaid"];

export const TIME_OFF_TYPE_LABELS: Record<TimeOffType, string> = {
  vacation: "Vacation (PTO)",
  sick: "Sick day",
  unpaid: "Unpaid time off",
};

/** Time off types that are paid; unpaid time off is listed but not paid. */
export function isPaidTimeOff(type: TimeOffType) {
  return type !== "unpaid";
}

/** Most PTO days an admin can give a member per year. */
export const MAX_PTO_DAYS = 365;

export const TIME_OFF_STATUS_LABELS: Record<TimeOffStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  denied: "Denied",
  cancelled: "Cancelled",
};

/** Hours credited per day of time off unless the member says otherwise. */
export const DEFAULT_TIME_OFF_HOURS_PER_DAY = 8;
/** Longest single request, in calendar days. */
export const MAX_TIME_OFF_DAYS = 60;
export const MAX_TIME_OFF_NOTE_LENGTH = 500;

const DAY_MS = 86_400_000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isTimeOffType(value: unknown): value is TimeOffType {
  return TIME_OFF_TYPES.includes(value as TimeOffType);
}

/** Days since the epoch for a `YYYY-MM-DD` string, or null if it isn't one. */
function dayNumber(date: string): number | null {
  const match = DATE_PATTERN.exec(date);
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  const ms = Date.UTC(y, m - 1, d);
  const check = new Date(ms);
  // Reject dates like 2026-02-31 that Date.UTC silently rolls over.
  if (check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return ms / DAY_MS;
}

export function isDateString(date: string) {
  return dayNumber(date) !== null;
}

/** Calendar days from `start` to `end`, counting both. */
export function countDays(start: string, end: string) {
  return (dayNumber(end) as number) - (dayNumber(start) as number) + 1;
}

/** Returns why a request can't be made, or null when it's fine. */
export function invalidTimeOffReason(input: {
  type: unknown;
  startDate: string;
  endDate: string;
  hoursPerDay: number;
}): string | null {
  if (!isTimeOffType(input.type)) return "Unknown time off type";
  if (!isDateString(input.startDate) || !isDateString(input.endDate)) {
    return "Invalid start or end date";
  }
  const days = countDays(input.startDate, input.endDate);
  if (days < 1) return "End date must be on or after the start date";
  if (days > MAX_TIME_OFF_DAYS) {
    return `Time off requests can be at most ${MAX_TIME_OFF_DAYS} days`;
  }
  if (
    !Number.isFinite(input.hoursPerDay) ||
    input.hoursPerDay <= 0 ||
    input.hoursPerDay > 24
  ) {
    return "Hours per day must be between 0 and 24";
  }
  return null;
}

/**
 * Days of the request that fall inside [rangeStart, rangeEnd] (both
 * `YYYY-MM-DD`, inclusive). Without a range, every day of the request.
 */
export function timeOffDaysInRange(
  request: Pick<TimeOffRequest, "start_date" | "end_date">,
  rangeStart?: string,
  rangeEnd?: string,
) {
  const start = Math.max(
    dayNumber(request.start_date) as number,
    rangeStart ? (dayNumber(rangeStart) ?? -Infinity) : -Infinity,
  );
  const end = Math.min(
    dayNumber(request.end_date) as number,
    rangeEnd ? (dayNumber(rangeEnd) ?? Infinity) : Infinity,
  );
  return Math.max(0, end - start + 1);
}

/** Hours of time off the request is worth inside the range. */
export function timeOffHoursInRange(
  request: Pick<TimeOffRequest, "start_date" | "end_date" | "hours_per_day">,
  rangeStart?: string,
  rangeEnd?: string,
) {
  return (
    timeOffDaysInRange(request, rangeStart, rangeEnd) *
    Number(request.hours_per_day)
  );
}

/** "Jan 5, 2026" or "Jan 5 – Jan 7, 2026", the same in every time zone. */
export function formatTimeOffDates(
  request: Pick<TimeOffRequest, "start_date" | "end_date">,
) {
  const toLocal = (date: string) => {
    const [y, m, d] = date.split("-").map(Number);
    return new Date(y, m - 1, d);
  };
  const start = toLocal(request.start_date);
  const end = toLocal(request.end_date);
  if (request.start_date === request.end_date) {
    return format(start, "MMM d, yyyy");
  }
  if (start.getFullYear() === end.getFullYear()) {
    return `${format(start, "MMM d")} – ${format(end, "MMM d, yyyy")}`;
  }
  return `${format(start, "MMM d, yyyy")} – ${format(end, "MMM d, yyyy")}`;
}

/** "8h" or "7.5h". */
export function formatTimeOffHours(hours: number) {
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

/** Returns why a PTO allowance can't be saved, or null when it's fine. */
export function invalidAllowanceReason(days: number): string | null {
  if (!Number.isFinite(days) || days < 0 || days > MAX_PTO_DAYS) {
    return `PTO days must be between 0 and ${MAX_PTO_DAYS}`;
  }
  if (Math.round(days * 2) !== days * 2) {
    return "PTO days must be in half days";
  }
  return null;
}

/** First and last day of a calendar year as `YYYY-MM-DD`. */
function yearRange(year: number): [string, string] {
  return [`${year}-01-01`, `${year}-12-31`];
}

/**
 * PTO days a member has used in `year`: every day of their vacation requests
 * with one of `statuses` that falls in that year.
 */
export function ptoDaysUsed(
  requests: Pick<
    TimeOffRequest,
    "user_id" | "request_type" | "status" | "start_date" | "end_date"
  >[],
  userId: string,
  year: number,
  statuses: TimeOffStatus[] = ["approved"],
) {
  const [start, end] = yearRange(year);
  return requests
    .filter(
      (r) =>
        r.user_id === userId &&
        r.request_type === "vacation" &&
        statuses.includes(r.status),
    )
    .reduce((sum, r) => sum + timeOffDaysInRange(r, start, end), 0);
}

/**
 * Why taking `request` would go over the member's yearly PTO allowance, or
 * null when it fits (or isn't PTO). `existing` are the member's other
 * requests that already count against the allowance.
 */
export function ptoOverAllowanceReason(
  request: Pick<
    TimeOffRequest,
    "user_id" | "request_type" | "start_date" | "end_date"
  > & { id?: number },
  allowanceDays: number | null | undefined,
  existing: Pick<
    TimeOffRequest,
    "id" | "user_id" | "request_type" | "status" | "start_date" | "end_date"
  >[],
  statuses: TimeOffStatus[] = ["approved"],
): string | null {
  if (request.request_type !== "vacation") return null;
  if (allowanceDays === null || allowanceDays === undefined) return null;
  const others = existing.filter((r) => r.id !== request.id);
  const firstYear = Number(request.start_date.slice(0, 4));
  const lastYear = Number(request.end_date.slice(0, 4));
  for (let year = firstYear; year <= lastYear; year++) {
    const [start, end] = yearRange(year);
    const wanted = timeOffDaysInRange(request, start, end);
    const used = ptoDaysUsed(others, request.user_id, year, statuses);
    if (used + wanted > allowanceDays) {
      const left = Math.max(0, allowanceDays - used);
      return `Not enough PTO for ${year}: ${formatDays(left)} left, ${formatDays(wanted)} asked for`;
    }
  }
  return null;
}

/** "1 day" or "2.5 days". */
export function formatDays(days: number) {
  const n = Number.isInteger(days) ? days : Number(days.toFixed(1));
  return `${n} ${n === 1 ? "day" : "days"}`;
}
