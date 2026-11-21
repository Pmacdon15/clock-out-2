import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { isValidTimeZone } from "./alerts";
import type { ShiftSeries } from "./types";

/**
 * Repeating shifts are made this far ahead, a week past what the Schedule
 * page shows, so members and their calendars always see the coming weeks.
 */
export const SERIES_HORIZON_DAYS = 35;

/** Most weeks one run makes for a series (a long-missed run catches up). */
export const MAX_SERIES_WEEKS_PER_RUN = 10;

const DAY_MS = 86_400_000;

/** The local wall-clock time of `instant` in `timezone`, `days` later. */
function sameLocalTimeLater(instant: Date, timezone: string, days: number) {
  const wall = formatInTimeZone(instant, timezone, "yyyy-MM-dd'T'HH:mm:ss.SSS");
  const [datePart, timePart] = wall.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
  return fromZonedTime(`${date}T${timePart}`, timezone);
}

export type SeriesOccurrence = {
  index: number;
  shiftStart: Date;
  shiftEnd: Date;
  /** The shift's days in the series' zone, for the time off check. */
  localDays: { start: string; end: string };
};

/**
 * Week `index` of a repeating shift (0 is the first shift): the same local
 * start and end times, `index` weeks later in the series' zone, so a 9 AM
 * shift stays at 9 AM across a daylight saving change.
 */
export function seriesOccurrence(
  series: Pick<ShiftSeries, "first_start" | "first_end" | "timezone">,
  index: number,
): SeriesOccurrence {
  const tz = isValidTimeZone(series.timezone) ? series.timezone : "UTC";
  const shiftStart = sameLocalTimeLater(
    new Date(series.first_start),
    tz,
    index * 7,
  );
  const shiftEnd = sameLocalTimeLater(
    new Date(series.first_end),
    tz,
    index * 7,
  );
  return {
    index,
    shiftStart,
    shiftEnd,
    localDays: {
      start: formatInTimeZone(shiftStart, tz, "yyyy-MM-dd"),
      // A shift ending exactly at midnight doesn't touch the next day.
      end: formatInTimeZone(new Date(shiftEnd.getTime() - 1), tz, "yyyy-MM-dd"),
    },
  };
}

/**
 * The weeks of a repeating shift that are due to be made at `now`: those from
 * its `next_index` that start within the horizon. Weeks already over (the job
 * didn't run for a while) are passed over, not made. `nextIndex` is where the
 * series continues next time.
 */
export function dueSeriesOccurrences(
  series: Pick<
    ShiftSeries,
    "first_start" | "first_end" | "timezone" | "next_index"
  >,
  now: Date,
  horizonDays = SERIES_HORIZON_DAYS,
): { nextIndex: number; occurrences: SeriesOccurrence[] } {
  const horizon = now.getTime() + horizonDays * DAY_MS;
  const occurrences: SeriesOccurrence[] = [];
  let index = Math.max(1, series.next_index);
  // Jump straight past weeks that are long over.
  const weekMs = 7 * DAY_MS;
  const behind = Math.floor(
    (now.getTime() - new Date(series.first_end).getTime()) / weekMs,
  );
  if (behind > index) index = behind;

  while (occurrences.length < MAX_SERIES_WEEKS_PER_RUN) {
    const occurrence = seriesOccurrence(series, index);
    if (occurrence.shiftStart.getTime() >= horizon) break;
    if (occurrence.shiftEnd.getTime() > now.getTime()) {
      occurrences.push(occurrence);
    }
    index += 1;
  }
  return { nextIndex: index, occurrences };
}
