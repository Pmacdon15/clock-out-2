import { format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { type BreakLike, getEffectiveHours } from "./break-utils";
import type { BreakSettingsData, OvertimeSettingsData } from "./types";

/**
 * Overtime: hours past the org's daily and/or weekly threshold.
 *
 * Daily overtime is every hour worked past the daily threshold on one
 * calendar day. Weekly overtime is every *remaining* (not already daily
 * overtime) hour past the weekly threshold in one Monday–Sunday week, so an
 * hour is never counted as overtime twice. Hours are allocated in the order
 * the shifts were worked, which is what lets each shift carry its own share.
 *
 * Weeks are only as complete as the shifts handed in: a range that starts
 * mid-week only sees the hours inside the range.
 */

/** Largest threshold accepted, in hours. */
export const MAX_DAILY_OVERTIME_HOURS = 24;
export const MAX_WEEKLY_OVERTIME_HOURS = 168;

export type OvertimeThresholds = {
  /** Hours per day before overtime starts; null = no daily overtime. */
  daily: number | null;
  /** Hours per week before overtime starts; null = no weekly overtime. */
  weekly: number | null;
};

export type OvertimeSplit = {
  regularHours: number;
  overtimeHours: number;
  dailyOvertimeHours: number;
  weeklyOvertimeHours: number;
};

export type OvertimeShift<K> = {
  key: K;
  /** Whose hours these are; thresholds apply per worker. */
  worker: string;
  /** The calendar day the shift is counted on, yyyy-MM-dd. */
  day: string;
  hours: number;
};

const normalizeThreshold = (value: unknown, max: number): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const hours = Number(value);
  return Number.isFinite(hours) && hours > 0 && hours <= max ? hours : null;
};

/** The thresholds in force; anything missing or invalid means "off". */
export function getOvertimeThresholds(
  settings?: Partial<OvertimeSettingsData> | null,
): OvertimeThresholds {
  return {
    daily: normalizeThreshold(
      settings?.daily_threshold_hours,
      MAX_DAILY_OVERTIME_HOURS,
    ),
    weekly: normalizeThreshold(
      settings?.weekly_threshold_hours,
      MAX_WEEKLY_OVERTIME_HOURS,
    ),
  };
}

export function isOvertimeEnabled(
  settings?: Partial<OvertimeSettingsData> | null,
): boolean {
  const { daily, weekly } = getOvertimeThresholds(settings);
  return daily !== null || weekly !== null;
}

/** Whether a threshold value is acceptable to store (null turns it off). */
export function isValidOvertimeThreshold(value: unknown, max: number): boolean {
  return (
    value === null ||
    (typeof value === "number" &&
      Number.isFinite(value) &&
      value > 0 &&
      value <= max)
  );
}

/** The Monday (yyyy-MM-dd) that starts the week holding `day`. */
export function weekStartOf(day: string): string {
  const [y, m, d] = day.slice(0, 10).split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  const dow = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  return date.toISOString().slice(0, 10);
}

/** Overtime past `threshold` added by `hours` on top of `before`. */
const overflow = (before: number, hours: number, threshold: number | null) =>
  threshold === null
    ? 0
    : Math.max(0, before + hours - threshold) - Math.max(0, before - threshold);

const ZERO: OvertimeSplit = {
  regularHours: 0,
  overtimeHours: 0,
  dailyOvertimeHours: 0,
  weeklyOvertimeHours: 0,
};

/**
 * Splits each shift into regular and overtime hours. `shifts` must be in the
 * order they were worked.
 */
export function allocateOvertime<K>(
  shifts: OvertimeShift<K>[],
  settings?: Partial<OvertimeSettingsData> | null,
): Map<K, OvertimeSplit> {
  const { daily, weekly } = getOvertimeThresholds(settings);
  const dayHours = new Map<string, number>();
  const weekRegular = new Map<string, number>();
  const result = new Map<K, OvertimeSplit>();

  for (const shift of shifts) {
    const hours = Math.max(0, shift.hours);
    const dayKey = `${shift.worker}__${shift.day}`;
    const weekKey = `${shift.worker}__${weekStartOf(shift.day)}`;

    const dayBefore = dayHours.get(dayKey) ?? 0;
    const dailyOt = overflow(dayBefore, hours, daily);
    dayHours.set(dayKey, dayBefore + hours);

    // Only hours that weren't already daily overtime count toward the week.
    const remaining = hours - dailyOt;
    const weekBefore = weekRegular.get(weekKey) ?? 0;
    const weeklyOt = overflow(weekBefore, remaining, weekly);
    weekRegular.set(weekKey, weekBefore + remaining - weeklyOt);

    result.set(shift.key, {
      regularHours: hours - dailyOt - weeklyOt,
      overtimeHours: dailyOt + weeklyOt,
      dailyOvertimeHours: dailyOt,
      weeklyOvertimeHours: weeklyOt,
    });
  }

  return result;
}

/** Adds splits together (for day, week, member and grand totals). */
export function sumOvertime(splits: Iterable<OvertimeSplit>): OvertimeSplit {
  const total = { ...ZERO };
  for (const split of splits) {
    total.regularHours += split.regularHours;
    total.overtimeHours += split.overtimeHours;
    total.dailyOvertimeHours += split.dailyOvertimeHours;
    total.weeklyOvertimeHours += split.weeklyOvertimeHours;
  }
  return total;
}

type OvertimeEntry = {
  id?: number;
  user_id: string;
  clock_in: Date | string;
  clock_out: Date | string | null;
  skip_lunch?: boolean;
  breaks?: BreakLike[] | null;
};

/**
 * Overtime for time entries, keyed by the entry object itself. Hours are net of unpaid
 * breaks (the same hours shown everywhere else). The day a shift counts
 * toward is the day it started, in `timezone` (or the runtime's local zone).
 */
export function computeEntryOvertime<T extends OvertimeEntry>(
  entries: T[],
  settings?: Partial<OvertimeSettingsData> | null,
  breakSettings?: BreakSettingsData | null,
  timezone?: string,
  nowMs: number = Date.now(),
): Map<T, OvertimeSplit> {
  const shifts = entries
    .map((entry) => ({ entry, start: new Date(entry.clock_in) }))
    .sort(
      (a, b) =>
        a.start.getTime() - b.start.getTime() ||
        (a.entry.id ?? 0) - (b.entry.id ?? 0),
    )
    .map(({ entry, start }) => ({
      key: entry,
      worker: entry.user_id,
      day: timezone
        ? formatInTimeZone(start, timezone, "yyyy-MM-dd")
        : format(start, "yyyy-MM-dd"),
      hours: getEffectiveHours(entry, breakSettings, nowMs),
    }));
  return allocateOvertime(shifts, settings);
}

/** "8h", "7.5h" — a threshold as admins typed it. */
export const formatThreshold = (hours: number) =>
  `${Number(hours.toFixed(2))}h`;

/** A one-line description of the policy, e.g. "over 8h/day or 40h/week". */
export function describeOvertime(
  settings?: Partial<OvertimeSettingsData> | null,
): string {
  const { daily, weekly } = getOvertimeThresholds(settings);
  const parts = [
    ...(daily !== null ? [`${formatThreshold(daily)}/day`] : []),
    ...(weekly !== null ? [`${formatThreshold(weekly)}/week`] : []),
  ];
  return parts.length > 0 ? `over ${parts.join(" or ")}` : "off";
}
