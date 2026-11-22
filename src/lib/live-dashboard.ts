import { getEffectiveDurationMs, getOpenBreak } from "./break-utils";
import type { BreakSettingsData, BreakType, TimeEntryBreak } from "./types";

/**
 * The admin's live dashboard: who is on the clock right now, a headcount,
 * and today's hours and labour cost so far.
 *
 * The server sends the raw shifts (every open one plus anything recent) and
 * the browser does this math, so "today" is the admin's own local day and
 * running shifts keep counting up between refreshes.
 */

/** How far back the server reads closed shifts, so today is always covered. */
export const LIVE_LOOKBACK_HOURS = 48;

/** One shift as the dashboard needs it, stripped of punch coordinates. */
export type LiveShift = {
  id: number;
  userId: string;
  clockIn: Date | string;
  clockOut: Date | string | null;
  skipLunch: boolean;
  breaks: Pick<TimeEntryBreak, "break_type" | "break_start" | "break_end">[];
  siteName: string | null;
};

export type LiveMember = { id: string; name: string };

export type LiveDashboardData = {
  members: LiveMember[];
  shifts: LiveShift[];
  breakSettings: BreakSettingsData | null;
  /** Hourly rate by member id; members without a rate are left out. */
  hourlyRates: Record<string, number>;
};

export type WorkingMember = {
  userId: string;
  name: string;
  clockIn: Date;
  /** The running break's kind, or null when they're working. */
  breakType: BreakType | null;
  siteName: string | null;
  /** Net hours on this shift so far (all of it, not just today's part). */
  shiftHours: number;
  hourlyRate: number | null;
};

export type LiveSummary = {
  working: WorkingMember[];
  headcount: {
    /** On the clock, breaks included. */
    onClock: number;
    onBreak: number;
    /** Members of the org not on the clock. */
    off: number;
    members: number;
  };
  today: {
    hours: number;
    /** Labour cost at each member's base rate (overtime not applied). */
    cost: number;
    /** Hours worked today by members with no pay rate (not in `cost`). */
    unratedHours: number;
    /** Names of the members whose hours today have no rate. */
    unratedMembers: string[];
  };
};

const HOUR_MS = 3_600_000;

const toMs = (value: Date | string) => new Date(value).getTime();

const asEntry = (shift: LiveShift) => ({
  clock_in: shift.clockIn,
  clock_out: shift.clockOut,
  skip_lunch: shift.skipLunch,
  breaks: shift.breaks,
});

/**
 * Net hours of a shift that fall between `dayStartMs` and `nowMs`. Breaks
 * and lunch docks are spread evenly over the shift, so a shift that started
 * last night counts only its share after midnight.
 */
export function hoursWithin(
  shift: LiveShift,
  breakSettings: BreakSettingsData | null,
  dayStartMs: number,
  nowMs: number,
): number {
  const startMs = toMs(shift.clockIn);
  const endMs = shift.clockOut ? toMs(shift.clockOut) : nowMs;
  const rawMs = endMs - startMs;
  if (!(rawMs > 0)) return 0;

  const overlapMs = Math.min(endMs, nowMs) - Math.max(startMs, dayStartMs);
  if (overlapMs <= 0) return 0;

  const netMs = getEffectiveDurationMs(asEntry(shift), breakSettings, nowMs);
  return (netMs * (overlapMs / rawMs)) / HOUR_MS;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Everything the dashboard shows, worked out at `nowMs`. */
export function summarizeLive(
  data: LiveDashboardData,
  nowMs: number,
  dayStartMs: number,
): LiveSummary {
  const names = new Map(data.members.map((m) => [m.id, m.name]));
  const nameOf = (id: string) => names.get(id) ?? "Former member";
  const rateOf = (id: string) => data.hourlyRates[id] ?? null;

  const working: WorkingMember[] = [];
  const onClockIds = new Set<string>();
  let todayHours = 0;
  let cost = 0;
  let unratedHours = 0;
  const unrated = new Set<string>();

  for (const shift of data.shifts) {
    if (shift.clockOut === null && toMs(shift.clockIn) <= nowMs) {
      const open = getOpenBreak(shift);
      onClockIds.add(shift.userId);
      working.push({
        userId: shift.userId,
        name: nameOf(shift.userId),
        clockIn: new Date(shift.clockIn),
        breakType: (open?.break_type as BreakType | undefined) ?? null,
        siteName: shift.siteName,
        shiftHours:
          getEffectiveDurationMs(asEntry(shift), data.breakSettings, nowMs) /
          HOUR_MS,
        hourlyRate: rateOf(shift.userId),
      });
    }

    const hours = hoursWithin(shift, data.breakSettings, dayStartMs, nowMs);
    if (hours <= 0) continue;
    todayHours += hours;
    const rate = rateOf(shift.userId);
    if (rate === null) {
      unratedHours += hours;
      unrated.add(nameOf(shift.userId));
    } else {
      cost += hours * rate;
    }
  }

  working.sort(
    (a, b) =>
      a.clockIn.getTime() - b.clockIn.getTime() || a.name.localeCompare(b.name),
  );

  const onBreak = working.filter((w) => w.breakType !== null).length;
  const memberIds = new Set(data.members.map((m) => m.id));
  const off = [...memberIds].filter((id) => !onClockIds.has(id)).length;

  return {
    working,
    headcount: {
      onClock: onClockIds.size,
      onBreak,
      off,
      members: memberIds.size,
    },
    today: {
      hours: round2(todayHours),
      cost: round2(cost),
      unratedHours: round2(unratedHours),
      unratedMembers: [...unrated].sort((a, b) => a.localeCompare(b)),
    },
  };
}

/** "3h 05m" for a duration in decimal hours. */
export function formatDuration(hours: number): string {
  const totalMinutes = Math.max(0, Math.floor(hours * 60));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}
