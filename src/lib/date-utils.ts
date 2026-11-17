import {
  endOfDay,
  endOfMonth,
  endOfYear,
  format,
  startOfDay,
  startOfMonth,
  startOfYear,
} from "date-fns";
import { fromZonedTime } from "date-fns-tz";

export const toLocalISO = (date: Date) =>
  format(date, "yyyy-MM-dd'T'HH:mm:ss.SSS");

export const getWeekRange = (year: number, month: number, weekNum: number) => {
  const baseDate = new Date(year, month, 1);
  const weekStart = new Date(year, month, (weekNum - 1) * 7 + 1);
  const weekEnd =
    weekNum === 4
      ? endOfMonth(baseDate)
      : endOfDay(new Date(year, month, weekNum * 7));
  return `${toLocalISO(startOfDay(weekStart))}|${toLocalISO(weekEnd)}`;
};

export const getMonthRange = (year: number, month: number) => {
  const baseDate = new Date(year, month, 1);
  return `${toLocalISO(startOfMonth(baseDate))}|${toLocalISO(endOfMonth(baseDate))}`;
};

export const getYearRange = (year: number) => {
  const baseDate = new Date(year, 0, 1);
  return `${toLocalISO(startOfYear(baseDate))}|${toLocalISO(endOfYear(baseDate))}`;
};

/**
 * Turns a `start`/`end` URL param into an instant in `tz`. A bare end date
 * (YYYY-MM-DD) means the end of that day.
 */
export function parseFilterDate(
  dateStr: string | undefined,
  tz: string,
  isEnd: boolean = false,
) {
  if (!dateStr) return undefined;
  // If the date is just YYYY-MM-DD, and it's the end date, make it the end of that day.
  if (isEnd && dateStr.length === 10) {
    return fromZonedTime(`${dateStr}T23:59:59.999`, tz);
  }
  return fromZonedTime(dateStr, tz);
}
