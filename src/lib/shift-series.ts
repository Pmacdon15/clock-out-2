import { formatInTimeZone } from "date-fns-tz";
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

const WEEK_MS = 7 * DAY_MS;

export type SeriesOccurrence = {
  index: number;
  shiftStart: Date;
  shiftEnd: Date;
  /** The shift's days in the series' zone, for the time off check. */
  localDays: { start: string; end: string };
};

/**
 * Week `index` of a repeating shift (0 is the first shift): exactly `index`
 * weeks after the first shift, in UTC. The times the browser saved are kept
 * as they are; the server never re-reads them through its own time zone
 * rules (which can be out of date, as when Alberta stopped changing clocks).
 * The zone is only used to name the shift's days for the time off check.
 */
export function seriesOccurrence(
  series: Pick<ShiftSeries, "first_start" | "first_end" | "timezone">,
  index: number,
): SeriesOccurrence {
  const tz = isValidTimeZone(series.timezone) ? series.timezone : "UTC";
  const shiftStart = new Date(
    new Date(series.first_start).getTime() + index * WEEK_MS,
  );
  const shiftEnd = new Date(
    new Date(series.first_end).getTime() + index * WEEK_MS,
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
  const behind = Math.floor(
    (now.getTime() - new Date(series.first_end).getTime()) / WEEK_MS,
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
