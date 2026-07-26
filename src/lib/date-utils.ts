import {
  endOfDay,
  endOfMonth,
  endOfYear,
  format,
  startOfDay,
  startOfMonth,
  startOfYear,
} from "date-fns";

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
