import { toZonedTime } from "date-fns-tz";
import { isValidTimeZone } from "./alerts";
import type { AvailabilityKind, AvailabilityWindow } from "./types";

/*
 * Recurring weekly availability. Members say when they can (available) or
 * can't (unavailable) work; the Schedule page warns an admin who schedules
 * them against it. Nothing here refuses a shift.
 */

export const AVAILABILITY_KINDS: AvailabilityKind[] = [
  "available",
  "unavailable",
];

export const AVAILABILITY_KIND_LABELS: Record<AvailabilityKind, string> = {
  available: "Available",
  unavailable: "Unavailable",
};

export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** Most windows one member can keep, so the list stays readable. */
export const MAX_AVAILABILITY_WINDOWS = 50;
export const MAX_AVAILABILITY_NOTE_LENGTH = 200;

const DAY = 24 * 60;
const WEEK = 7 * DAY;

export function isAvailabilityKind(value: unknown): value is AvailabilityKind {
  return value === "available" || value === "unavailable";
}

/** "HH:MM" from a time input as minutes after midnight, or null. */
export function parseTimeOfDay(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * The stored end for a time input's end: midnight is the end of the day
 * (1440), so "09:00 – 00:00" means until midnight.
 */
export function endMinuteFor(value: string): number | null {
  const minutes = parseTimeOfDay(value);
  return minutes === 0 ? DAY : minutes;
}

/** "9:00 AM", "12:00 AM" for midnight (start or end of the day). */
export function formatMinuteOfDay(minute: number) {
  const m = minute % DAY;
  const hours = Math.floor(m / 60);
  const mins = m % 60;
  const suffix = hours < 12 ? "AM" : "PM";
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${h12}:${String(mins).padStart(2, "0")} ${suffix}`;
}

/** Whether the window covers its whole day. */
export function isAllDay(
  window: Pick<AvailabilityWindow, "start_minute" | "end_minute">,
) {
  return window.start_minute === 0 && window.end_minute === DAY;
}

/** "All day" or "9:00 AM – 5:00 PM" (with "next day" past midnight). */
export function formatWindowTimes(
  window: Pick<AvailabilityWindow, "start_minute" | "end_minute">,
) {
  if (isAllDay(window)) return "All day";
  const overnight = window.end_minute <= window.start_minute;
  return `${formatMinuteOfDay(window.start_minute)} – ${formatMinuteOfDay(window.end_minute)}${overnight ? " (next day)" : ""}`;
}

/** "Unavailable Mondays, 9:00 AM – 5:00 PM". */
export function describeWindow(window: AvailabilityWindow) {
  return `${AVAILABILITY_KIND_LABELS[window.kind]} ${WEEKDAY_NAMES[window.weekday]}s, ${formatWindowTimes(window)}`;
}

export type NewAvailabilityInput = {
  kind: AvailabilityKind;
  weekdays: number[];
  startMinute: number;
  endMinute: number;
  timezone: string;
  note?: string | null;
};

/** Why the input can't be saved, or null when it can. */
export function invalidAvailabilityReason(input: NewAvailabilityInput) {
  if (!isAvailabilityKind(input.kind)) return "Choose available or unavailable";
  if (
    !Array.isArray(input.weekdays) ||
    input.weekdays.length === 0 ||
    input.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)
  ) {
    return "Choose at least one day";
  }
  const { startMinute: start, endMinute: end } = input;
  if (!Number.isInteger(start) || start < 0 || start >= DAY) {
    return "Invalid start time";
  }
  if (!Number.isInteger(end) || end < 1 || end > DAY) {
    return "Invalid end time";
  }
  if (start === end) return "Start and end can't be the same time";
  if (!isValidTimeZone(input.timezone)) return "Invalid time zone";
  if ((input.note?.trim().length ?? 0) > MAX_AVAILABILITY_NOTE_LENGTH) {
    return "Note is too long";
  }
  return null;
}

/** A window as [start, end) minutes from Sunday midnight; end may pass a week. */
function weekSpan(window: AvailabilityWindow) {
  const start = window.weekday * DAY + window.start_minute;
  const length =
    window.end_minute > window.start_minute
      ? window.end_minute - window.start_minute
      : window.end_minute + DAY - window.start_minute;
  return { start, end: start + length };
}

/**
 * The parts of a shift a window covers, as [from, to) minutes after the
 * shift starts, worked out in the window's own time zone.
 */
function coveredParts(
  window: AvailabilityWindow,
  shiftStart: Date,
  shiftMinutes: number,
): [number, number][] {
  const tz = isValidTimeZone(window.timezone) ? window.timezone : "UTC";
  const local = toZonedTime(shiftStart, tz);
  const from =
    local.getDay() * DAY + local.getHours() * 60 + local.getMinutes();
  const to = from + shiftMinutes;
  const span = weekSpan(window);
  const parts: [number, number][] = [];
  // The window repeats weekly, so try last week's, this week's and next.
  for (const offset of [-WEEK, 0, WEEK]) {
    const lo = Math.max(from, span.start + offset);
    const hi = Math.min(to, span.end + offset);
    if (lo < hi) parts.push([lo - from, hi - from]);
  }
  return parts;
}

/** Whether the parts cover all of [0, length). */
function coversAll(parts: [number, number][], length: number) {
  let reached = 0;
  for (const [lo, hi] of [...parts].sort((a, b) => a[0] - b[0])) {
    if (lo > reached) return false;
    reached = Math.max(reached, hi);
  }
  return reached >= length;
}

export type AvailabilityConflict =
  | { type: "unavailable"; window: AvailabilityWindow }
  | { type: "outside" };

/**
 * How a shift clashes with one member's weekly availability, or null when
 * it doesn't: it overlaps a window they're unavailable, or (once they've set
 * when they are available) it isn't fully inside those windows.
 */
export function findAvailabilityConflict(
  windows: AvailabilityWindow[],
  shiftStart: Date,
  shiftEnd: Date,
): AvailabilityConflict | null {
  const minutes = Math.round(
    (shiftEnd.getTime() - shiftStart.getTime()) / 60000,
  );
  if (!(minutes > 0)) return null;
  for (const window of windows) {
    if (
      window.kind === "unavailable" &&
      coveredParts(window, shiftStart, minutes).length > 0
    ) {
      return { type: "unavailable", window };
    }
  }
  const available = windows.filter((window) => window.kind === "available");
  if (available.length === 0) return null;
  const parts = available.flatMap((window) =>
    coveredParts(window, shiftStart, minutes),
  );
  return coversAll(parts, minutes) ? null : { type: "outside" };
}

/** The member's windows, from an org-wide list. */
export function windowsFor(windows: AvailabilityWindow[], userId: string) {
  return windows.filter((window) => window.user_id === userId);
}

/** A short warning for a conflict, naming the member. */
export function availabilityConflictMessage(
  name: string | undefined,
  conflict: AvailabilityConflict,
) {
  name ||= "This member";
  if (conflict.type === "unavailable") {
    const note = conflict.window.note ? ` (${conflict.window.note})` : "";
    return `${name} is unavailable ${WEEKDAY_NAMES[conflict.window.weekday]}s, ${formatWindowTimes(conflict.window).replace(/^All day$/, "all day")}${note}.`;
  }
  return `This shift is outside the times ${name} said they're available.`;
}

/** Windows sorted by day, then start time, for listing. */
export function sortWindows(windows: AvailabilityWindow[]) {
  return [...windows].sort(
    (a, b) =>
      a.weekday - b.weekday || a.start_minute - b.start_minute || a.id - b.id,
  );
}
