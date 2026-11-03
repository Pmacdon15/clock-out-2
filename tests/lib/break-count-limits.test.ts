import { describe, expect, it } from "vitest";
import {
  breakCountLimitMessage,
  countBreaksOfKind,
  getBreakCountLimits,
  getRemainingBreakCount,
  isBreakCountReached,
  isValidBreakCountLimit,
  MAX_BREAK_COUNT_LIMIT,
} from "@/lib/break-utils";
import { makeBreak } from "../utils";

const shift = (...types: string[]) => ({
  breaks: types.map((break_type, i) =>
    makeBreak({ id: i + 1, break_type: break_type as never }),
  ),
});

describe("getBreakCountLimits", () => {
  it("reads the paid and unpaid per-shift limits", () => {
    expect(
      getBreakCountLimits({
        max_paid_breaks_per_shift: 2,
        max_unpaid_breaks_per_shift: 1,
      }),
    ).toEqual({ paid: 2, unpaid: 1 });
  });

  it.each([
    ["no settings", undefined],
    ["null settings", null],
    ["null limits", { max_paid_breaks_per_shift: null }],
    ["a zero limit", { max_paid_breaks_per_shift: 0 }],
    ["a negative limit", { max_paid_breaks_per_shift: -1 }],
    ["a fractional limit", { max_paid_breaks_per_shift: 1.5 }],
  ])("treats %s as no limit", (_label, settings) => {
    expect(getBreakCountLimits(settings).paid).toBeNull();
  });
});

describe("isValidBreakCountLimit", () => {
  it.each([null, 1, 5, MAX_BREAK_COUNT_LIMIT])("accepts %s", (value) => {
    expect(isValidBreakCountLimit(value)).toBe(true);
  });

  it.each([0, -1, 1.5, MAX_BREAK_COUNT_LIMIT + 1, Number.NaN, "2", undefined])(
    "rejects %s",
    (value) => {
      expect(isValidBreakCountLimit(value)).toBe(false);
    },
  );
});

describe("countBreaksOfKind", () => {
  it("counts paid and unpaid breaks separately, running ones included", () => {
    const entry = {
      breaks: [
        makeBreak({ id: 1, break_type: "paid_rest" }),
        makeBreak({ id: 2, break_type: "unpaid_meal" }),
        makeBreak({ id: 3, break_type: "unpaid_rest", break_end: null }),
      ],
    };
    expect(countBreaksOfKind(entry, true)).toBe(1);
    expect(countBreaksOfKind(entry, false)).toBe(2);
  });

  it("handles an entry without breaks", () => {
    expect(countBreaksOfKind(undefined, true)).toBe(0);
    expect(countBreaksOfKind({ breaks: null }, false)).toBe(0);
  });
});

describe("getRemainingBreakCount / isBreakCountReached", () => {
  const settings = {
    max_paid_breaks_per_shift: 2,
    max_unpaid_breaks_per_shift: 1,
  };

  it("is null (unlimited) when the org sets no limit for that kind", () => {
    const entry = shift("paid_rest", "paid_rest", "paid_rest");
    expect(getRemainingBreakCount(entry, "paid_rest", null)).toBeNull();
    expect(isBreakCountReached(entry, "paid_rest", null)).toBe(false);
  });

  it("counts down the breaks left of the type's kind", () => {
    const entry = shift("paid_rest");
    expect(getRemainingBreakCount(entry, "paid_rest", settings)).toBe(1);
    expect(getRemainingBreakCount(entry, "unpaid_meal", settings)).toBe(1);
    expect(isBreakCountReached(entry, "paid_rest", settings)).toBe(false);
  });

  it("shares the unpaid limit between meal periods and unpaid rest breaks", () => {
    const entry = shift("unpaid_meal");
    expect(isBreakCountReached(entry, "unpaid_rest", settings)).toBe(true);
    expect(isBreakCountReached(entry, "unpaid_meal", settings)).toBe(true);
    expect(isBreakCountReached(entry, "paid_rest", settings)).toBe(false);
  });

  it("counts a paid lunch against the paid limit", () => {
    const entry = shift("paid_meal", "paid_rest");
    expect(isBreakCountReached(entry, "paid_rest", settings)).toBe(true);
    expect(getRemainingBreakCount(entry, "unpaid_rest", settings)).toBe(1);
  });

  it("never goes below zero", () => {
    const entry = shift("paid_rest", "paid_rest", "paid_rest");
    expect(getRemainingBreakCount(entry, "paid_rest", settings)).toBe(0);
    expect(isBreakCountReached(entry, "paid_rest", settings)).toBe(true);
  });
});

describe("breakCountLimitMessage", () => {
  it("names the kind and the limit", () => {
    expect(
      breakCountLimitMessage("paid_rest", { max_paid_breaks_per_shift: 2 }),
    ).toBe("You've used all 2 paid breaks allowed this shift.");
    expect(
      breakCountLimitMessage("unpaid_rest", {
        max_unpaid_breaks_per_shift: 1,
      }),
    ).toBe("You've used all 1 unpaid break allowed this shift.");
  });

  it("falls back to zero when no limit is set", () => {
    expect(breakCountLimitMessage("paid_rest", null)).toBe(
      "You've used all 0 paid breaks allowed this shift.",
    );
  });
});
