import type { BreakSettingsData, TimeEntry } from "./types";

type ShiftLike =
  | Pick<TimeEntry, "clock_in" | "clock_out" | "skip_lunch">
  | {
      clock_in: Date | string;
      clock_out: Date | string | null;
      skip_lunch?: boolean;
    };

/**
 * Returns the number of minutes docked from a shift based on the organization's
 * break settings and the shift's `skip_lunch` ("not docked") flag.
 */
export function getDockedMinutes(
  entry: ShiftLike,
  breakSettings?: BreakSettingsData | null,
  nowMs: number = Date.now(),
): number {
  if (!breakSettings?.dock_lunch || entry.skip_lunch) {
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
 * subtracting any applicable lunch/break deduction.
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
  return Math.max(0, rawMs - dockedMs);
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
