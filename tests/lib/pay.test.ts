import { describe, expect, it } from "vitest";
import {
  computePay,
  DEFAULT_OVERTIME_MULTIPLIER,
  formatMoney,
  formatMultiplier,
  isValidHourlyRate,
  isValidOvertimeMultiplier,
  MAX_HOURLY_RATE,
  payRateMap,
  sumPay,
  toPayRate,
} from "@/lib/pay";

describe("isValidHourlyRate", () => {
  it.each([0, 15.5, MAX_HOURLY_RATE])("accepts %s", (value) => {
    expect(isValidHourlyRate(value)).toBe(true);
  });

  it.each([
    -0.01,
    MAX_HOURLY_RATE + 1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    "20",
    null,
  ])("rejects %s", (value) => {
    expect(isValidHourlyRate(value)).toBe(false);
  });
});

describe("isValidOvertimeMultiplier", () => {
  it.each([1, 1.5, 2, 5])("accepts %s", (value) => {
    expect(isValidOvertimeMultiplier(value)).toBe(true);
  });

  it.each([0.99, 5.01, Number.NaN, "1.5", undefined])("rejects %s", (value) => {
    expect(isValidOvertimeMultiplier(value)).toBe(false);
  });
});

describe("toPayRate", () => {
  it("reads a stored row", () => {
    expect(toPayRate({ hourly_rate: 20, overtime_multiplier: 2 })).toEqual({
      hourlyRate: 20,
      overtimeMultiplier: 2,
    });
  });

  it("accepts numeric strings, as Postgres drivers may return", () => {
    expect(
      toPayRate({
        hourly_rate: "22.5" as unknown as number,
        overtime_multiplier: "1.5" as unknown as number,
      }),
    ).toEqual({ hourlyRate: 22.5, overtimeMultiplier: 1.5 });
  });

  it("defaults a missing or invalid multiplier to time and a half", () => {
    expect(toPayRate({ hourly_rate: 20 })?.overtimeMultiplier).toBe(
      DEFAULT_OVERTIME_MULTIPLIER,
    );
    expect(
      toPayRate({ hourly_rate: 20, overtime_multiplier: 0.2 })
        ?.overtimeMultiplier,
    ).toBe(DEFAULT_OVERTIME_MULTIPLIER);
  });

  it("returns null for no row or an unusable rate", () => {
    expect(toPayRate(null)).toBeNull();
    expect(toPayRate(undefined)).toBeNull();
    expect(toPayRate({ hourly_rate: -5 })).toBeNull();
    expect(toPayRate({})).toBeNull();
  });
});

describe("payRateMap", () => {
  it("keys usable rates by user id and drops the rest", () => {
    const map = payRateMap([
      { user_id: "a", hourly_rate: 20, overtime_multiplier: 1.5 },
      { user_id: "b", hourly_rate: -1, overtime_multiplier: 1.5 },
      { hourly_rate: 30, overtime_multiplier: 1.5 },
    ]);
    expect([...map.keys()]).toEqual(["a"]);
    expect(map.get("a")).toEqual({ hourlyRate: 20, overtimeMultiplier: 1.5 });
  });

  it("is empty without rows", () => {
    expect(payRateMap(undefined).size).toBe(0);
    expect(payRateMap(null).size).toBe(0);
  });
});

describe("computePay", () => {
  const rate = { hourlyRate: 20, overtimeMultiplier: 1.5 };

  it("pays regular hours at the rate and overtime at the multiplier", () => {
    expect(computePay({ regularHours: 40, overtimeHours: 4 }, rate)).toEqual({
      regularPay: 800,
      overtimePay: 120,
      grossPay: 920,
    });
  });

  it("never pays negative hours", () => {
    expect(computePay({ regularHours: -1, overtimeHours: -2 }, rate)).toEqual({
      regularPay: 0,
      overtimePay: 0,
      grossPay: 0,
    });
  });
});

describe("sumPay", () => {
  it("adds pay figures together", () => {
    expect(
      sumPay([
        { regularPay: 10, overtimePay: 1, grossPay: 11 },
        { regularPay: 5, overtimePay: 2, grossPay: 7 },
      ]),
    ).toEqual({ regularPay: 15, overtimePay: 3, grossPay: 18 });
    expect(sumPay([])).toEqual({ regularPay: 0, overtimePay: 0, grossPay: 0 });
  });
});

describe("formatting", () => {
  it("formats money with two decimals and thousands separators", () => {
    expect(formatMoney(0)).toBe("$0.00");
    expect(formatMoney(1234.5)).toBe("$1,234.50");
  });

  it("formats multipliers", () => {
    expect(formatMultiplier(1.5)).toBe("1.5x");
    expect(formatMultiplier(2)).toBe("2x");
    expect(formatMultiplier(1.3333)).toBe("1.33x");
  });
});

describe("computePay with banked overtime", () => {
  it("leaves banked overtime hours out of overtime pay", () => {
    const rate = { hourlyRate: 20, overtimeMultiplier: 1.5 };
    expect(
      computePay(
        { regularHours: 40, overtimeHours: 4, bankedOvertimeHours: 3 },
        rate,
      ),
    ).toEqual({ regularPay: 800, overtimePay: 30, grossPay: 830 });
  });
});
