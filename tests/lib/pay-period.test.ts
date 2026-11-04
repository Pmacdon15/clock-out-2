import { describe, expect, it } from "vitest";
import {
  describeHoldback,
  formatPayday,
  formatPayPeriodRange,
  getPayPeriod,
  isPayPeriodEnabled,
  isPayPeriodFrequency,
  isValidHoldbackDays,
  isValidPayPeriodInput,
  listPayPeriods,
  MAX_HOLDBACK_DAYS,
  parseDateOnly,
  payPeriodRangeValue,
} from "@/lib/pay-period";
import type { PayPeriodSettingsData } from "@/lib/types";

const settings = (
  overrides: Partial<PayPeriodSettingsData> = {},
): PayPeriodSettingsData => ({
  org_id: "org_1",
  enabled: true,
  frequency: "weekly",
  // A Friday.
  anchor_payday: "2026-11-13",
  holdback_days: 7,
  ...overrides,
});

const day = (value: string) => new Date(`${value}T00:00:00`);
const ymd = (date: Date) => date.toLocaleDateString("en-CA");

describe("isPayPeriodFrequency", () => {
  it("accepts weekly and bi-weekly only", () => {
    expect(isPayPeriodFrequency("weekly")).toBe(true);
    expect(isPayPeriodFrequency("bi-weekly")).toBe(true);
    expect(isPayPeriodFrequency("monthly")).toBe(false);
    expect(isPayPeriodFrequency(undefined)).toBe(false);
  });
});

describe("parseDateOnly", () => {
  it("parses a YYYY-MM-DD date as local midnight", () => {
    expect(parseDateOnly("2026-11-13")).toEqual(day("2026-11-13"));
  });

  it.each([
    ["a non-string", 20261113],
    ["a timestamp", "2026-11-13T00:00:00"],
    ["an impossible date", "2026-02-30"],
    ["an empty string", ""],
  ])("rejects %s", (_label, value) => {
    expect(parseDateOnly(value)).toBeNull();
  });
});

describe("isValidHoldbackDays", () => {
  it("accepts whole days from 0 to the maximum", () => {
    expect(isValidHoldbackDays(0)).toBe(true);
    expect(isValidHoldbackDays(7)).toBe(true);
    expect(isValidHoldbackDays(MAX_HOLDBACK_DAYS)).toBe(true);
  });

  it.each([-1, MAX_HOLDBACK_DAYS + 1, 1.5, Number.NaN, "7"])(
    "rejects %s",
    (value) => {
      expect(isValidHoldbackDays(value)).toBe(false);
    },
  );
});

describe("isValidPayPeriodInput", () => {
  const valid = {
    enabled: true,
    frequency: "bi-weekly",
    anchorPayday: "2026-11-13",
    holdbackDays: 0,
  };

  it("accepts complete settings", () => {
    expect(isValidPayPeriodInput(valid)).toBe(true);
    expect(isValidPayPeriodInput({ ...valid, enabled: false })).toBe(true);
  });

  it.each([
    ["a non-boolean enabled", { enabled: "yes" }],
    ["an unknown frequency", { frequency: "monthly" }],
    ["a bad payday", { anchorPayday: "soon" }],
    ["a bad hold-back", { holdbackDays: -7 }],
  ])("rejects %s", (_label, patch) => {
    expect(isValidPayPeriodInput({ ...valid, ...patch })).toBe(false);
  });
});

describe("isPayPeriodEnabled", () => {
  it("is true only for enabled, valid settings", () => {
    expect(isPayPeriodEnabled(settings())).toBe(true);
    expect(isPayPeriodEnabled(settings({ enabled: false }))).toBe(false);
    expect(isPayPeriodEnabled(settings({ anchor_payday: "nope" }))).toBe(false);
    expect(isPayPeriodEnabled(null)).toBe(false);
    expect(isPayPeriodEnabled(undefined)).toBe(false);
  });
});

describe("getPayPeriod", () => {
  it("pays a week held back by one week on the following Friday", () => {
    const period = getPayPeriod(settings(), day("2026-11-03"));
    expect(ymd(period.start)).toBe("2026-10-31");
    expect(ymd(period.end)).toBe("2026-11-06");
    expect(period.end.getHours()).toBe(23);
    expect(ymd(period.payday)).toBe("2026-11-13");
  });

  it("moves to the next period on the day after a period ends", () => {
    const period = getPayPeriod(settings(), day("2026-11-07"));
    expect(ymd(period.start)).toBe("2026-11-07");
    expect(ymd(period.payday)).toBe("2026-11-20");
  });

  it("ends the period on payday with no hold-back", () => {
    const period = getPayPeriod(
      settings({ holdback_days: 0 }),
      day("2026-11-13"),
    );
    expect(ymd(period.start)).toBe("2026-11-07");
    expect(ymd(period.end)).toBe("2026-11-13");
    expect(ymd(period.payday)).toBe("2026-11-13");
  });

  it("covers 14 days for bi-weekly pay, before and after the anchor", () => {
    const biWeekly = settings({ frequency: "bi-weekly" });
    const later = getPayPeriod(biWeekly, day("2026-12-01"));
    expect(ymd(later.start)).toBe("2026-11-21");
    expect(ymd(later.end)).toBe("2026-12-04");
    expect(ymd(later.payday)).toBe("2026-12-11");

    const earlier = getPayPeriod(biWeekly, day("2026-01-05"));
    expect(ymd(earlier.payday)).toBe("2026-01-23");
    expect(ymd(earlier.start)).toBe("2026-01-03");
    expect(ymd(earlier.end)).toBe("2026-01-16");
  });

  it("steps by offset", () => {
    const base = day("2026-11-03");
    expect(ymd(getPayPeriod(settings(), base, 1).payday)).toBe("2026-11-20");
    expect(ymd(getPayPeriod(settings(), base, -2).payday)).toBe("2026-10-30");
  });
});

describe("listPayPeriods", () => {
  it("lists upcoming, current then earlier periods, newest first", () => {
    const periods = listPayPeriods(settings(), day("2026-11-03"), 2, 1);
    expect(periods.map((p) => ymd(p.payday))).toEqual([
      "2026-11-20",
      "2026-11-13",
      "2026-11-06",
      "2026-10-30",
    ]);
  });
});

describe("formatting", () => {
  const period = getPayPeriod(settings(), day("2026-11-03"));

  it("formats the range param, dates and payday", () => {
    expect(payPeriodRangeValue(period)).toBe(
      "2026-10-31T00:00:00.000|2026-11-06T23:59:59.999",
    );
    expect(formatPayPeriodRange(period)).toBe("Oct 31 – Nov 6");
    expect(formatPayday(period)).toBe("Fri, Nov 13");
  });

  it.each([
    [0, "No hold-back"],
    [7, "1 week"],
    [14, "2 weeks"],
    [1, "1 day"],
    [3, "3 days"],
  ])("describes a %i-day hold-back", (days, text) => {
    expect(describeHoldback(days)).toBe(text);
  });
});
