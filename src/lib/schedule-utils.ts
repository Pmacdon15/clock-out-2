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

/** Longest shift an admin can publish. */
export const MAX_SHIFT_HOURS = 24;

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
