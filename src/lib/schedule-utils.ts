import type {
  ScheduledShift,
  ScheduledShiftWithStatus,
  ShiftStatus,
  TimeEntry,
} from "./types";

/** Clocking in up to this many minutes after the start still counts as on time. */
export const LATE_GRACE_MINUTES = 5;

/**
 * A clock-in this long before a shift starts is still matched to that shift
 * (members who come in early are on time, not unscheduled).
 */
export const EARLY_MATCH_MINUTES = 120;

/** Why a shift can't go where the member already has one. */
export const OVERLAPPING_SHIFT_REASON =
  "This member already has a shift that overlaps this time";

/**
 * The member's shift that [start, end) would overlap, ignoring `excludeId`
 * (the shift being moved). Shifts that only touch end-to-start don't count.
 */
export function findOverlappingShift<
  T extends Pick<
    ScheduledShift,
    "id" | "user_id" | "shift_start" | "shift_end"
  >,
>(
  shifts: T[],
  memberId: string,
  start: Date,
  end: Date,
  excludeId?: number,
): T | undefined {
  const from = start.getTime();
  const to = end.getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return undefined;
  return shifts.find(
    (shift) =>
      shift.user_id === memberId &&
      shift.id !== excludeId &&
      new Date(shift.shift_start).getTime() < to &&
      new Date(shift.shift_end).getTime() > from,
  );
}

/** Longest shift an admin can publish. */
export const MAX_SHIFT_HOURS = 24;

/** Most weeks a shift can be repeated for in one go (about six months). */
export const MAX_REPEAT_WEEKS = 26;

/** How many weeks the repeat options start at. */
export const DEFAULT_REPEAT_WEEKS = 4;

/**
 * The same shift on the same weekday for `count` weeks, starting `fromWeek`
 * weeks after it (0 includes the shift itself). Weeks are added on the local
 * calendar, so a 9 AM shift stays at 9 AM across a daylight saving change.
 */
export function weeklyOccurrences(
  shiftStart: Date,
  shiftEnd: Date,
  count: number,
  fromWeek = 0,
): { shiftStart: Date; shiftEnd: Date }[] {
  const weeks = Math.max(0, Math.min(Math.floor(count), MAX_REPEAT_WEEKS));
  return Array.from({ length: weeks }, (_, i) => {
    const days = (fromWeek + i) * 7;
    const start = new Date(shiftStart);
    start.setDate(start.getDate() + days);
    const end = new Date(shiftEnd);
    end.setDate(end.getDate() + days);
    return { shiftStart: start, shiftEnd: end };
  });
}

/** How far back and ahead of today the schedule view loads. */
export const SCHEDULE_PAST_DAYS = 14;
export const SCHEDULE_FUTURE_DAYS = 28;

const MINUTE = 60_000;

export const SHIFT_STATUS_LABELS: Record<ShiftStatus, string> = {
  scheduled: "Scheduled",
  on_time: "On time",
  late: "Late",
  not_clocked_in: "Not clocked in",
  no_show: "No-show",
};

/** Statuses an admin should look at. */
export function isFlaggedStatus(status: ShiftStatus) {
  return (
    status === "late" || status === "not_clocked_in" || status === "no_show"
  );
}

/** Returns a reason the shift times are unusable, or null when they're fine. */
export function invalidShiftReason(start: Date, end: Date): string | null {
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return "Invalid shift start or end";
  }
  if (end.getTime() <= start.getTime()) {
    return "Shift must end after it starts";
  }
  if (end.getTime() - start.getTime() > MAX_SHIFT_HOURS * 60 * MINUTE) {
    return `Shifts can be at most ${MAX_SHIFT_HOURS} hours long`;
  }
  return null;
}

/** Whether a time entry can count as the member working this shift. */
function entryMatchesShift(entry: TimeEntry, shift: ScheduledShift) {
  const start = new Date(shift.shift_start).getTime();
  const end = new Date(shift.shift_end).getTime();
  const clockIn = new Date(entry.clock_in).getTime();
  if (clockIn >= end) return false;
  // Clocked in shortly before (or during) the shift…
  if (clockIn >= start - EARLY_MATCH_MINUTES * MINUTE) return true;
  // …or clocked in much earlier and was still on the clock when it started.
  return (
    entry.clock_out === null || new Date(entry.clock_out).getTime() > start
  );
}

/**
 * Compares scheduled shifts with the members' time entries. Each entry is
 * matched to at most one shift (the earliest shift it fits), so one clock-in
 * can't cover a member's back-to-back shifts.
 */
export function evaluateShifts(
  shifts: ScheduledShift[],
  entries: TimeEntry[],
  now: Date,
): ScheduledShiftWithStatus[] {
  const nowMs = now.getTime();
  const used = new Set<number>();
  const byStart = [...shifts].sort(
    (a, b) =>
      new Date(a.shift_start).getTime() - new Date(b.shift_start).getTime() ||
      a.id - b.id,
  );
  const entriesByClockIn = [...entries].sort(
    (a, b) => new Date(a.clock_in).getTime() - new Date(b.clock_in).getTime(),
  );

  return byStart.map((shift) => {
    const start = new Date(shift.shift_start).getTime();
    const end = new Date(shift.shift_end).getTime();
    const match = entriesByClockIn.find(
      (entry) =>
        entry.user_id === shift.user_id &&
        !used.has(entry.id) &&
        entryMatchesShift(entry, shift),
    );

    if (match) {
      used.add(match.id);
      const clockIn = new Date(match.clock_in);
      const minutesLate = Math.max(
        0,
        Math.floor((clockIn.getTime() - start) / MINUTE),
      );
      return {
        ...shift,
        status: minutesLate > LATE_GRACE_MINUTES ? "late" : "on_time",
        actual_clock_in: clockIn,
        actual_clock_out: match.clock_out ? new Date(match.clock_out) : null,
        minutes_late: minutesLate,
      };
    }

    let status: ShiftStatus = "scheduled";
    if (nowMs >= end) status = "no_show";
    else if (nowMs > start + LATE_GRACE_MINUTES * MINUTE)
      status = "not_clocked_in";

    return {
      ...shift,
      status,
      actual_clock_in: null,
      actual_clock_out: null,
      minutes_late: null,
    };
  });
}

/** Counts per status, for the summary at the top of the schedule. */
export function countShiftStatuses(shifts: { status: ShiftStatus }[]) {
  const counts: Record<ShiftStatus, number> = {
    scheduled: 0,
    on_time: 0,
    late: 0,
    not_clocked_in: 0,
    no_show: 0,
  };
  for (const shift of shifts) counts[shift.status] += 1;
  return counts;
}

/** Parts of the day a manager can narrow the schedule to, by local start time. */
export type TimeOfDay = "morning" | "afternoon" | "evening" | "overnight";

export const TIME_OF_DAY_LABELS: Record<TimeOfDay, string> = {
  morning: "Morning (5 AM – noon)",
  afternoon: "Afternoon (noon – 5 PM)",
  evening: "Evening (5 PM – 10 PM)",
  overnight: "Overnight (10 PM – 5 AM)",
};

/** Which part of the day a local start time falls in. */
export function timeOfDayFor(start: Date): TimeOfDay {
  const hour = start.getHours();
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "overnight";
}

/** What the schedule's filter bar holds. An empty string means "any". */
export interface ShiftFilters {
  /** Free text matched against the member's name, the note and location. */
  query: string;
  memberId: string;
  /** A local calendar day ("yyyy-MM-dd") the shift touches. */
  date: string;
  /** Local weekday of the start, "0" (Sunday) to "6" (Saturday). */
  weekday: string;
  timeOfDay: TimeOfDay | "";
  /** A single status, or "flagged" for every status worth a look. */
  status: ShiftStatus | "flagged" | "";
}

export const EMPTY_SHIFT_FILTERS: ShiftFilters = {
  query: "",
  memberId: "",
  date: "",
  weekday: "",
  timeOfDay: "",
  status: "",
};

/** How many filters are set, for the "Clear filters" badge. */
export function activeFilterCount(filters: ShiftFilters) {
  return Object.values(filters).filter((value) => value.trim() !== "").length;
}

/** The local "yyyy-MM-dd" of a date, without pulling in a formatter. */
function localDay(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * The shifts that match every filter that's set. Dates and times are read in
 * the viewer's local zone, like the rest of the schedule. A shift ending
 * exactly at midnight doesn't count as touching the next day.
 */
export function filterShifts<
  T extends Pick<
    ScheduledShiftWithStatus,
    "user_id" | "shift_start" | "shift_end" | "status" | "note"
  > & { location?: string | null; location_address?: string | null },
>(shifts: T[], filters: ShiftFilters, memberNames: Map<string, string>): T[] {
  const words = filters.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return shifts.filter((shift) => {
    if (filters.memberId && shift.user_id !== filters.memberId) return false;
    if (filters.status === "flagged") {
      if (!isFlaggedStatus(shift.status)) return false;
    } else if (filters.status && shift.status !== filters.status) {
      return false;
    }
    const start = new Date(shift.shift_start);
    if (filters.weekday && String(start.getDay()) !== filters.weekday) {
      return false;
    }
    if (filters.timeOfDay && timeOfDayFor(start) !== filters.timeOfDay) {
      return false;
    }
    if (filters.date) {
      const lastMoment = new Date(new Date(shift.shift_end).getTime() - 1);
      if (localDay(start) > filters.date || localDay(lastMoment) < filters.date)
        return false;
    }
    if (words.length > 0) {
      const haystack = [
        memberNames.get(shift.user_id),
        shift.note,
        shift.location,
        shift.location_address,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!words.every((word) => haystack.includes(word))) return false;
    }
    return true;
  });
}
