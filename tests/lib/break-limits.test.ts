import { describe, expect, it } from "vitest";
import {
  getBreakDeadlineMs,
  getBreakLimitMinutes,
  getBreakLimits,
  isBreakOverLimit,
  isMealLimitFromDeduction,
  isValidBreakLimit,
  MAX_BREAK_LIMIT_MINUTES,
} from "@/lib/break-utils";
import { makeBreak } from "../utils";

const START = new Date("2026-01-05T12:00:00Z");

describe("getBreakLimitMinutes", () => {
  it("reads each break type's own limit", () => {
    const settings = {
      max_meal_break_minutes: 45,
      max_unpaid_rest_break_minutes: 10,
      max_paid_break_minutes: 15,
    };
    expect(getBreakLimitMinutes("unpaid_meal", settings)).toBe(45);
    expect(getBreakLimitMinutes("unpaid_rest", settings)).toBe(10);
    expect(getBreakLimitMinutes("paid_rest", settings)).toBe(15);
  });

  it.each([
    ["no settings", undefined],
    ["null settings", null],
    ["a null limit", { max_paid_break_minutes: null }],
    ["a zero limit", { max_paid_break_minutes: 0 }],
    ["a negative limit", { max_paid_break_minutes: -5 }],
    ["a non-numeric limit", { max_paid_break_minutes: Number.NaN }],
  ])("treats %s as no limit", (_label, settings) => {
    expect(getBreakLimitMinutes("paid_rest", settings)).toBeNull();
  });

  it("has no limit for an unknown break type", () => {
    expect(
      getBreakLimitMinutes("siesta", { max_paid_break_minutes: 15 }),
    ).toBeNull();
  });

  it("uses the lunch deduction as the meal limit while lunch is docked", () => {
    const settings = {
      dock_lunch: true,
      lunch_duration_minutes: 30,
      max_meal_break_minutes: 60,
    };
    expect(isMealLimitFromDeduction(settings)).toBe(true);
    expect(getBreakLimitMinutes("unpaid_meal", settings)).toBe(30);
  });

  it("falls back to the manual meal limit when lunch is not docked", () => {
    const settings = {
      dock_lunch: false,
      lunch_duration_minutes: 30,
      max_meal_break_minutes: 60,
    };
    expect(isMealLimitFromDeduction(settings)).toBe(false);
    expect(getBreakLimitMinutes("unpaid_meal", settings)).toBe(60);
  });

  it("ignores a docked lunch with no usable duration", () => {
    const settings = {
      dock_lunch: true,
      lunch_duration_minutes: 0,
      max_meal_break_minutes: 20,
    };
    expect(isMealLimitFromDeduction(settings)).toBe(false);
    expect(isMealLimitFromDeduction(null)).toBe(false);
    expect(getBreakLimitMinutes("unpaid_meal", settings)).toBe(20);
  });
});

describe("getBreakLimits", () => {
  it("collects every break type's limit", () => {
    expect(
      getBreakLimits({
        dock_lunch: true,
        lunch_duration_minutes: 30,
        max_paid_break_minutes: 15,
      }),
    ).toEqual({ unpaid_meal: 30, unpaid_rest: null, paid_rest: 15 });
    expect(getBreakLimits(null)).toEqual({
      unpaid_meal: null,
      unpaid_rest: null,
      paid_rest: null,
    });
  });
});

describe("isValidBreakLimit", () => {
  it.each([
    [null, true],
    [1, true],
    [MAX_BREAK_LIMIT_MINUTES, true],
    [0, false],
    [MAX_BREAK_LIMIT_MINUTES + 1, false],
    [7.5, false],
    [Number.NaN, false],
    ["15", false],
    [undefined, false],
  ])("%s is valid: %s", (value, expected) => {
    expect(isValidBreakLimit(value)).toBe(expected);
  });
});

describe("break deadlines", () => {
  const settings = { max_paid_break_minutes: 15 };
  const paid = makeBreak({
    break_type: "paid_rest",
    break_start: START,
    break_end: null,
  });

  it("is the break start plus its type's limit", () => {
    expect(getBreakDeadlineMs(paid, settings)).toBe(
      START.getTime() + 15 * 60_000,
    );
  });

  it("is null when the type has no limit", () => {
    expect(
      getBreakDeadlineMs({ ...paid, break_type: "unpaid_rest" }, settings),
    ).toBeNull();
  });

  it("is null for an unreadable start", () => {
    expect(
      getBreakDeadlineMs({ ...paid, break_start: "not a date" }, settings),
    ).toBeNull();
  });

  it("flags a running break once it reaches its limit", () => {
    const deadline = START.getTime() + 15 * 60_000;
    expect(isBreakOverLimit(paid, settings, deadline - 1)).toBe(false);
    expect(isBreakOverLimit(paid, settings, deadline)).toBe(true);
  });

  it("never flags a finished break or one without a limit", () => {
    const late = START.getTime() + 60 * 60_000;
    expect(
      isBreakOverLimit({ ...paid, break_end: new Date(late) }, settings, late),
    ).toBe(false);
    expect(isBreakOverLimit(paid, null, late)).toBe(false);
  });

  it("defaults to the current time", () => {
    expect(
      isBreakOverLimit({ ...paid, break_start: new Date(0) }, settings),
    ).toBe(true);
  });
});
