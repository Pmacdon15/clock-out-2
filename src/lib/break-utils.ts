import type { BreakLimits, BreakSettingsData, BreakType } from "./types";

/** A break record, loose enough for rows that still carry string dates. */
export type BreakLike = {
  id?: number;
  break_type: BreakType | string;
  break_start: Date | string;
  break_end: Date | string | null;
};

type ShiftLike = {
  clock_in: Date | string;
  clock_out: Date | string | null;
  skip_lunch?: boolean;
  breaks?: BreakLike[] | null;
};

/**
 * The break kinds the clock can record, in the order they are offered.
 * `paid` decides the hour math: paid breaks are kept as a compliance record
 * but never deducted, unpaid breaks are subtracted from worked hours.
 */
export const BREAK_TYPES = {
  unpaid_meal: { label: "Meal period", paid: false },
  unpaid_rest: { label: "Unpaid rest break", paid: false },
  paid_rest: { label: "Paid rest break", paid: true },
} as const satisfies Record<BreakType, { label: string; paid: boolean }>;

export const BREAK_TYPE_VALUES = Object.keys(BREAK_TYPES) as BreakType[];

export const DEFAULT_BREAK_TYPE: BreakType = "unpaid_meal";

export function isBreakType(value: unknown): value is BreakType {
  return (
    typeof value === "string" && Object.hasOwn(BREAK_TYPES, value as BreakType)
  );
}

/**
 * Whether a break type is paid. An unrecognised type counts as paid, so a
 * type this build doesn't know about can never silently cut paid hours.
 */
export function isPaidBreakType(type: BreakType | string): boolean {
  return isBreakType(type) ? BREAK_TYPES[type].paid : true;
}

export function breakTypeLabel(type: BreakType | string): string {
  return isBreakType(type) ? BREAK_TYPES[type].label : "Break";
}

/** The still-running break of an entry, if any. */
export function getOpenBreak<T extends BreakLike>(
  entry: { breaks?: T[] | null } | null | undefined,
): T | undefined {
  return entry?.breaks?.find((b) => !b.break_end);
}

/** Upper bound accepted for any break limit, in minutes (8 hours). */
export const MAX_BREAK_LIMIT_MINUTES = 480;

/** The `break_settings` column holding each break type's limit. */
export const BREAK_LIMIT_FIELDS = {
  unpaid_meal: "max_meal_break_minutes",
  unpaid_rest: "max_unpaid_rest_break_minutes",
  paid_rest: "max_paid_break_minutes",
} as const satisfies Record<BreakType, keyof BreakSettingsData>;

type BreakLimitSettings = Partial<
  Pick<
    BreakSettingsData,
    | (typeof BREAK_LIMIT_FIELDS)[BreakType]
    | "dock_lunch"
    | "lunch_duration_minutes"
  >
>;

const normalizeLimit = (value: unknown): number | null => {
  const minutes = Number(value);
  return value !== null && Number.isFinite(minutes) && minutes > 0
    ? minutes
    : null;
};

/**
 * Whether the meal-period limit comes from the lunch deduction: when the org
 * docks lunch, a meal period may last exactly as long as the deduction.
 */
export function isMealLimitFromDeduction(
  breakSettings?: BreakLimitSettings | null,
): boolean {
  return (
    Boolean(breakSettings?.dock_lunch) &&
    normalizeLimit(breakSettings?.lunch_duration_minutes) !== null
  );
}

/**
 * The org's limit for one break type in minutes, or null when there is none.
 * Zero, negative and non-numeric values all mean "no limit". While lunch is
 * docked, the meal-period limit is the lunch deduction duration; otherwise
 * it is the separately stored meal limit.
 */
export function getBreakLimitMinutes(
  type: BreakType | string,
  breakSettings?: BreakLimitSettings | null,
): number | null {
  if (!isBreakType(type)) return null;
  if (type === "unpaid_meal" && isMealLimitFromDeduction(breakSettings)) {
    return normalizeLimit(breakSettings?.lunch_duration_minutes);
  }
  return normalizeLimit(breakSettings?.[BREAK_LIMIT_FIELDS[type]]);
}

/** Every break type's limit, for the server to cap break ends with. */
export function getBreakLimits(
  breakSettings?: BreakLimitSettings | null,
): BreakLimits {
  return {
    unpaid_meal: getBreakLimitMinutes("unpaid_meal", breakSettings),
    unpaid_rest: getBreakLimitMinutes("unpaid_rest", breakSettings),
    paid_rest: getBreakLimitMinutes("paid_rest", breakSettings),
  };
}

/** Whether a limit value is acceptable to store (null clears it). */
export function isValidBreakLimit(value: unknown): boolean {
  return (
    value === null ||
    (Number.isInteger(value) &&
      (value as number) >= 1 &&
      (value as number) <= MAX_BREAK_LIMIT_MINUTES)
  );
}

/**
 * When a break must end under the org's limit for its type, in epoch
 * milliseconds. Null when that type has no limit.
 */
export function getBreakDeadlineMs(
  brk: BreakLike,
  breakSettings?: BreakLimitSettings | null,
): number | null {
  const limit = getBreakLimitMinutes(brk.break_type, breakSettings);
  if (limit === null) return null;
  const startMs = new Date(brk.break_start).getTime();
  if (Number.isNaN(startMs)) return null;
  return startMs + limit * 60_000;
}

/**
 * Whether a still-running break has reached its type's limit, meaning the
 * member should already be back on the clock.
 */
export function isBreakOverLimit(
  brk: BreakLike,
  breakSettings?: BreakLimitSettings | null,
  nowMs: number = Date.now(),
): boolean {
  if (brk.break_end) return false;
  const deadline = getBreakDeadlineMs(brk, breakSettings);
  return deadline !== null && nowMs >= deadline;
}

const shiftBounds = (entry: ShiftLike, nowMs: number) => ({
  startMs: new Date(entry.clock_in).getTime(),
  endMs: entry.clock_out ? new Date(entry.clock_out).getTime() : nowMs,
});

/**
 * How long a break lasted, in milliseconds. A running break is measured up
 * to `nowMs`.
 */
export function getBreakDurationMs(
  brk: BreakLike,
  nowMs: number = Date.now(),
): number {
  const startMs = new Date(brk.break_start).getTime();
  const endMs = brk.break_end ? new Date(brk.break_end).getTime() : nowMs;
  return Math.max(0, endMs - startMs);
}

/**
 * Break time inside the shift's own window, so a stray record outside
 * clock-in/clock-out can never deduct more than the shift itself.
 */
function breakMsWithinShift(
  entry: ShiftLike,
  paid: boolean,
  nowMs: number,
): number {
  const { startMs, endMs } = shiftBounds(entry, nowMs);
  let total = 0;
  for (const brk of entry.breaks ?? []) {
    if (isPaidBreakType(brk.break_type) !== paid) continue;
    const breakStart = new Date(brk.break_start).getTime();
    const breakEnd = brk.break_end ? new Date(brk.break_end).getTime() : nowMs;
    if (Number.isNaN(breakStart) || Number.isNaN(breakEnd)) continue;
    total += Math.max(
      0,
      Math.min(breakEnd, endMs) - Math.max(breakStart, startMs),
    );
  }
  return total;
}

/** Total unpaid break time on a shift, in milliseconds. */
export function getUnpaidBreakMs(
  entry: ShiftLike,
  nowMs: number = Date.now(),
): number {
  return breakMsWithinShift(entry, false, nowMs);
}

/** Total paid break time on a shift, in milliseconds (recorded, not deducted). */
export function getPaidBreakMs(
  entry: ShiftLike,
  nowMs: number = Date.now(),
): number {
  return breakMsWithinShift(entry, true, nowMs);
}

/**
 * Whether the shift carries at least one explicit unpaid break record. Such
 * a shift opts out of the automatic lunch dock (see `getDockedMinutes`).
 */
export function hasUnpaidBreakRecord(entry: ShiftLike): boolean {
  return (entry.breaks ?? []).some((b) => !isPaidBreakType(b.break_type));
}

/**
 * Returns the number of minutes docked from a shift based on the organization's
 * break settings and the shift's `skip_lunch` ("not docked") flag.
 *
 * Explicit unpaid breaks win over the automatic dock: once a shift has an
 * unpaid break record of its own, the recorded break time is what gets
 * subtracted and the org-wide lunch dock no longer applies, so a meal period
 * is never deducted twice. Shifts with only paid breaks recorded still get
 * the automatic dock, since no unpaid time was logged for them.
 */
export function getDockedMinutes(
  entry: ShiftLike,
  breakSettings?: BreakSettingsData | null,
  nowMs: number = Date.now(),
): number {
  if (!breakSettings?.dock_lunch || entry.skip_lunch) {
    return 0;
  }

  if (hasUnpaidBreakRecord(entry)) {
    return 0;
  }

  const durationMinutes = Number(breakSettings.lunch_duration_minutes);
  const minShiftHours = Number(breakSettings.lunch_min_shift_hours);
  if (durationMinutes <= 0) {
    return 0;
  }

  const startMs = new Date(entry.clock_in).getTime();
  const endMs = entry.clock_out ? new Date(entry.clock_out).getTime() : nowMs;
  const rawMs = Math.max(0, endMs - startMs);
  const minShiftMs = Math.max(0, minShiftHours) * 3_600_000;

  if (rawMs < minShiftMs) {
    return 0;
  }

  return durationMinutes;
}

/**
 * Returns the net (effective) duration of a shift in milliseconds after
 * subtracting any applicable lunch/break deduction and every unpaid break
 * recorded against the shift.
 */
export function getEffectiveDurationMs(
  entry: ShiftLike,
  breakSettings?: BreakSettingsData | null,
  nowMs: number = Date.now(),
): number {
  const startMs = new Date(entry.clock_in).getTime();
  const endMs = entry.clock_out ? new Date(entry.clock_out).getTime() : nowMs;
  const rawMs = Math.max(0, endMs - startMs);
  const dockedMs = getDockedMinutes(entry, breakSettings, nowMs) * 60_000;
  const unpaidMs = getUnpaidBreakMs(entry, nowMs);
  return Math.max(0, rawMs - dockedMs - unpaidMs);
}

/**
 * Returns the net (effective) duration of a shift in decimal hours.
 */
export function getEffectiveHours(
  entry: ShiftLike,
  breakSettings?: BreakSettingsData | null,
  nowMs: number = Date.now(),
): number {
  return getEffectiveDurationMs(entry, breakSettings, nowMs) / 3_600_000;
}

/* ------------------------------------------------------------ validation -- */

export type BreakValidationInput = {
  entry: Pick<ShiftLike, "clock_in" | "clock_out">;
  /** Breaks already recorded against the entry. */
  breaks?: BreakLike[] | null;
  break_start: Date | string;
  break_end?: Date | string | null;
  break_type?: BreakType | string;
  /** Id of the break being edited, so it is not compared against itself. */
  excludeBreakId?: number;
};

/**
 * Checks a new or edited break against its entry: a known type, a sane
 * window, inside the shift, and no overlap with (or racing of) the breaks
 * already recorded. Returns the reason it is invalid, or null when it is fine.
 */
export function validateBreak(input: BreakValidationInput): string | null {
  const { entry, excludeBreakId } = input;

  if (input.break_type !== undefined && !isBreakType(input.break_type)) {
    return "Unknown break type";
  }

  const startMs = new Date(input.break_start).getTime();
  const endMs =
    input.break_end === undefined || input.break_end === null
      ? null
      : new Date(input.break_end).getTime();
  if (Number.isNaN(startMs) || (endMs !== null && Number.isNaN(endMs))) {
    return "Invalid break start or end time";
  }
  if (endMs !== null && endMs <= startMs) {
    return "Break end must be after break start";
  }

  const clockInMs = new Date(entry.clock_in).getTime();
  const clockOutMs = entry.clock_out
    ? new Date(entry.clock_out).getTime()
    : null;
  if (Number.isNaN(clockInMs)) {
    return "Invalid clock-in time";
  }
  if (startMs < clockInMs) {
    return "Break cannot start before the shift's clock-in";
  }
  if (clockOutMs !== null) {
    if (endMs === null) {
      return "Cannot leave a break open on a closed shift";
    }
    if (startMs >= clockOutMs || endMs > clockOutMs) {
      return "Break must be inside the shift's clock-in and clock-out";
    }
  }

  const others = (input.breaks ?? []).filter(
    (b) => b.id === undefined || b.id !== excludeBreakId,
  );

  if (endMs === null && others.some((b) => !b.break_end)) {
    return "A break is already running";
  }

  const effectiveEnd = endMs ?? Number.POSITIVE_INFINITY;
  for (const other of others) {
    const otherStart = new Date(other.break_start).getTime();
    const otherEnd = other.break_end
      ? new Date(other.break_end).getTime()
      : Number.POSITIVE_INFINITY;
    if (startMs < otherEnd && otherStart < effectiveEnd) {
      return "Break overlaps another break on this entry";
    }
  }

  return null;
}
