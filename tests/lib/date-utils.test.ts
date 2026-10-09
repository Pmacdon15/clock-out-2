import { describe, expect, it } from "vitest";
import {
  getMonthRange,
  getWeekRange,
  getYearRange,
  toLocalISO,
} from "@/lib/date-utils";

describe("toLocalISO", () => {
  it("formats a date as a local ISO string without a zone suffix", () => {
    expect(toLocalISO(new Date(2026, 0, 2, 3, 4, 5, 6))).toBe(
      "2026-01-02T03:04:05.006",
    );
  });
});

describe("getWeekRange", () => {
  it("covers days 1-7 for week 1", () => {
    expect(getWeekRange(2026, 1, 1)).toBe(
      "2026-02-01T00:00:00.000|2026-02-07T23:59:59.999",
    );
  });

  it("covers days 15-21 for week 3", () => {
    expect(getWeekRange(2026, 2, 3)).toBe(
      "2026-03-15T00:00:00.000|2026-03-21T23:59:59.999",
    );
  });

  it("runs week 4 to the last day of the month", () => {
    expect(getWeekRange(2026, 1, 4)).toBe(
      "2026-02-22T00:00:00.000|2026-02-28T23:59:59.999",
    );
    expect(getWeekRange(2026, 0, 4)).toBe(
      "2026-01-22T00:00:00.000|2026-01-31T23:59:59.999",
    );
  });
});

describe("getMonthRange", () => {
  it("spans the whole month", () => {
    expect(getMonthRange(2024, 1)).toBe(
      "2024-02-01T00:00:00.000|2024-02-29T23:59:59.999",
    );
  });
});

describe("getYearRange", () => {
  it("spans the whole year", () => {
    expect(getYearRange(2026)).toBe(
      "2026-01-01T00:00:00.000|2026-12-31T23:59:59.999",
    );
  });
});
