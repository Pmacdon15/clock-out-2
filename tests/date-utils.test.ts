import { describe, expect, test } from "bun:test";
import {
  getMonthRange,
  getWeekRange,
  getYearRange,
  toLocalISO,
} from "@/lib/date-utils";

// Months are zero-based, matching the Date constructor (0 = January).

describe("toLocalISO", () => {
  test("formats a local date without a timezone suffix", () => {
    expect(toLocalISO(new Date(2026, 9, 9, 7, 5, 3, 42))).toBe(
      "2026-10-09T07:05:03.042",
    );
  });
});

describe("getWeekRange", () => {
  test("week 1 covers days 1-7", () => {
    expect(getWeekRange(2026, 9, 1)).toBe(
      "2026-10-01T00:00:00.000|2026-10-07T23:59:59.999",
    );
  });

  test("week 3 covers days 15-21", () => {
    expect(getWeekRange(2026, 9, 3)).toBe(
      "2026-10-15T00:00:00.000|2026-10-21T23:59:59.999",
    );
  });

  test("week 4 runs to the end of a 31-day month", () => {
    expect(getWeekRange(2026, 9, 4)).toBe(
      "2026-10-22T00:00:00.000|2026-10-31T23:59:59.999",
    );
  });

  test("week 4 runs to the end of February", () => {
    expect(getWeekRange(2026, 1, 4)).toBe(
      "2026-02-22T00:00:00.000|2026-02-28T23:59:59.999",
    );
  });

  test("week 4 includes Feb 29 in a leap year", () => {
    expect(getWeekRange(2028, 1, 4)).toBe(
      "2028-02-22T00:00:00.000|2028-02-29T23:59:59.999",
    );
  });
});

describe("getMonthRange", () => {
  test("covers the whole month", () => {
    expect(getMonthRange(2026, 9)).toBe(
      "2026-10-01T00:00:00.000|2026-10-31T23:59:59.999",
    );
  });

  test("handles 30-day months", () => {
    expect(getMonthRange(2026, 10)).toBe(
      "2026-11-01T00:00:00.000|2026-11-30T23:59:59.999",
    );
  });

  test("handles leap-year February", () => {
    expect(getMonthRange(2028, 1)).toBe(
      "2028-02-01T00:00:00.000|2028-02-29T23:59:59.999",
    );
  });
});

describe("getYearRange", () => {
  test("covers Jan 1 to Dec 31", () => {
    expect(getYearRange(2026)).toBe(
      "2026-01-01T00:00:00.000|2026-12-31T23:59:59.999",
    );
  });
});
