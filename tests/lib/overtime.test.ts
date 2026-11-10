import { describe, expect, it } from "vitest";
import {
  allocateOvertime,
  computeEntryOvertime,
  describeBanking,
  describeOvertime,
  formatThreshold,
  getOvertimeBanking,
  getOvertimeThresholds,
  isOvertimeEnabled,
  isValidBankAfterHours,
  isValidOvertimeThreshold,
  MAX_DAILY_OVERTIME_HOURS,
  paidOvertimeHours,
  sumOvertime,
  weekStartOf,
} from "@/lib/overtime";

const settings = (
  daily: number | null,
  weekly: number | null,
): {
  daily_threshold_hours: number | null;
  weekly_threshold_hours: number | null;
} => ({ daily_threshold_hours: daily, weekly_threshold_hours: weekly });

describe("getOvertimeThresholds", () => {
  it("treats missing, empty and out-of-range values as off", () => {
    expect(getOvertimeThresholds(null)).toEqual({ daily: null, weekly: null });
    expect(getOvertimeThresholds(undefined)).toEqual({
      daily: null,
      weekly: null,
    });
    expect(
      getOvertimeThresholds({
        daily_threshold_hours: 0,
        weekly_threshold_hours: 200,
      }),
    ).toEqual({ daily: null, weekly: null });
    expect(
      getOvertimeThresholds({
        daily_threshold_hours: "" as unknown as number,
        weekly_threshold_hours: Number.NaN,
      }),
    ).toEqual({ daily: null, weekly: null });
  });

  it("reads numeric strings (Postgres doubles can arrive as text)", () => {
    expect(
      getOvertimeThresholds({
        daily_threshold_hours: "7.5" as unknown as number,
        weekly_threshold_hours: 40,
      }),
    ).toEqual({ daily: 7.5, weekly: 40 });
  });
});

describe("isOvertimeEnabled", () => {
  it("is on when either threshold is set", () => {
    expect(isOvertimeEnabled(settings(null, null))).toBe(false);
    expect(isOvertimeEnabled(settings(8, null))).toBe(true);
    expect(isOvertimeEnabled(settings(null, 40))).toBe(true);
  });
});

describe("isValidOvertimeThreshold", () => {
  it("accepts null and positive numbers up to the max", () => {
    expect(isValidOvertimeThreshold(null, 24)).toBe(true);
    expect(isValidOvertimeThreshold(8, 24)).toBe(true);
    expect(isValidOvertimeThreshold(24, 24)).toBe(true);
    expect(isValidOvertimeThreshold(0, 24)).toBe(false);
    expect(isValidOvertimeThreshold(25, 24)).toBe(false);
    expect(isValidOvertimeThreshold(Number.NaN, 24)).toBe(false);
    expect(isValidOvertimeThreshold("8", 24)).toBe(false);
    expect(isValidOvertimeThreshold(undefined, 24)).toBe(false);
  });
});

describe("weekStartOf", () => {
  it("returns the Monday of the week", () => {
    expect(weekStartOf("2026-01-05")).toBe("2026-01-05"); // Monday
    expect(weekStartOf("2026-01-07")).toBe("2026-01-05"); // Wednesday
    expect(weekStartOf("2026-01-11")).toBe("2026-01-05"); // Sunday
    expect(weekStartOf("2026-01-01T10:00:00")).toBe("2025-12-29");
  });
});

describe("allocateOvertime", () => {
  const shift = (key: string, day: string, hours: number, worker = "a") => ({
    key,
    worker,
    day,
    hours,
  });

  it("counts nothing as overtime with no thresholds", () => {
    const result = allocateOvertime([shift("s1", "2026-01-05", 12)], null);
    expect(result.get("s1")).toEqual({
      regularHours: 12,
      overtimeHours: 0,
      dailyOvertimeHours: 0,
      weeklyOvertimeHours: 0,
    });
  });

  it("puts daily overtime on the shift that crosses the threshold", () => {
    const result = allocateOvertime(
      [
        shift("s1", "2026-01-05", 6),
        shift("s2", "2026-01-05", 4),
        shift("s3", "2026-01-05", 1),
      ],
      settings(8, null),
    );
    expect(result.get("s1")?.overtimeHours).toBe(0);
    expect(result.get("s2")).toEqual({
      regularHours: 2,
      overtimeHours: 2,
      dailyOvertimeHours: 2,
      weeklyOvertimeHours: 0,
    });
    expect(result.get("s3")?.dailyOvertimeHours).toBe(1);
  });

  it("counts weekly overtime once the week passes the threshold", () => {
    const days = ["05", "06", "07", "08", "09", "10"];
    const result = allocateOvertime(
      days.map((d) => shift(d, `2026-01-${d}`, 8)),
      settings(null, 40),
    );
    expect(result.get("09")?.overtimeHours).toBe(0);
    expect(result.get("10")).toEqual({
      regularHours: 0,
      overtimeHours: 8,
      dailyOvertimeHours: 0,
      weeklyOvertimeHours: 8,
    });
  });

  it("never counts daily overtime toward the weekly threshold", () => {
    // Five 10h days: 2h daily OT each; 8h/day regular = 40h -> no weekly OT.
    const days = ["05", "06", "07", "08", "09"];
    const result = allocateOvertime(
      days.map((d) => shift(d, `2026-01-${d}`, 10)),
      settings(8, 40),
    );
    const total = sumOvertime(result.values());
    expect(total).toEqual({
      regularHours: 40,
      overtimeHours: 10,
      dailyOvertimeHours: 10,
      weeklyOvertimeHours: 0,
    });

    // A sixth day is all weekly overtime (up to the daily threshold).
    const withSaturday = allocateOvertime(
      [...days, "10"].map((d) => shift(d, `2026-01-${d}`, 10)),
      settings(8, 40),
    );
    expect(withSaturday.get("10")).toEqual({
      regularHours: 0,
      overtimeHours: 10,
      dailyOvertimeHours: 2,
      weeklyOvertimeHours: 8,
    });
  });

  it("starts a new week on Monday and tracks each worker separately", () => {
    const result = allocateOvertime(
      [
        shift("sun", "2026-01-11", 10),
        shift("mon", "2026-01-12", 10),
        shift("b", "2026-01-12", 10, "b"),
      ],
      settings(null, 15),
    );
    expect(result.get("sun")?.overtimeHours).toBe(0);
    expect(result.get("mon")?.overtimeHours).toBe(0);
    expect(result.get("b")?.overtimeHours).toBe(0);
  });

  it("treats negative hours as zero", () => {
    const result = allocateOvertime(
      [shift("s1", "2026-01-05", -3)],
      settings(8, 40),
    );
    expect(result.get("s1")?.regularHours).toBe(0);
  });
});

describe("computeEntryOvertime", () => {
  const entry = (
    id: number | undefined,
    clockIn: string,
    clockOut: string | null,
    user = "u1",
  ) => ({ id, user_id: user, clock_in: clockIn, clock_out: clockOut });

  it("splits net hours by the day each shift started, in order worked", () => {
    const late = entry(2, "2026-01-05T14:00:00Z", "2026-01-05T18:00:00Z");
    const early = entry(1, "2026-01-05T08:00:00Z", "2026-01-05T14:00:00Z");
    const result = computeEntryOvertime([late, early], settings(8, null));
    expect(result.get(early)?.overtimeHours).toBe(0);
    expect(result.get(late)?.overtimeHours).toBe(2);
  });

  it("breaks start-time ties by id, treating a missing id as 0", () => {
    const a = entry(undefined, "2026-01-05T08:00:00Z", "2026-01-05T14:00:00Z");
    const b = entry(5, "2026-01-05T08:00:00Z", "2026-01-05T12:00:00Z");
    for (const order of [
      [b, a],
      [a, b],
    ]) {
      const result = computeEntryOvertime(order, settings(8, null));
      expect(result.get(a)?.overtimeHours).toBe(0);
      expect(result.get(b)?.overtimeHours).toBe(2);
    }
  });

  it("assigns days in the given timezone and counts running shifts to now", () => {
    // 03:00Z on Jan 6 is still Jan 5 in Regina (UTC-6).
    const first = entry(1, "2026-01-05T15:00:00Z", "2026-01-05T21:00:00Z");
    const second = entry(2, "2026-01-06T03:00:00Z", null);
    const now = new Date("2026-01-06T07:00:00Z").getTime();
    const result = computeEntryOvertime(
      [first, second],
      settings(8, null),
      null,
      "America/Regina",
      now,
    );
    expect(result.get(second)?.overtimeHours).toBe(2);

    const utc = computeEntryOvertime(
      [first, second],
      settings(8, null),
      null,
      undefined,
      now,
    );
    expect(utc.get(second)?.overtimeHours).toBe(0);
  });

  it("uses hours net of the lunch dock", () => {
    const shift = entry(1, "2026-01-05T08:00:00Z", "2026-01-05T17:00:00Z");
    const result = computeEntryOvertime([shift], settings(8, null), {
      org_id: "o",
      dock_lunch: true,
      lunch_duration_minutes: 60,
      lunch_min_shift_hours: 5,
    });
    expect(result.get(shift)?.overtimeHours).toBe(0);
  });
});

describe("describeOvertime", () => {
  it("describes the thresholds in force", () => {
    expect(describeOvertime(settings(8, 40))).toBe("over 8h/day or 40h/week");
    expect(describeOvertime(settings(7.5, null))).toBe("over 7.5h/day");
    expect(describeOvertime(settings(null, 44))).toBe("over 44h/week");
    expect(describeOvertime(null)).toBe("off");
  });

  it("formats thresholds without trailing zeros", () => {
    expect(formatThreshold(8)).toBe("8h");
    expect(formatThreshold(MAX_DAILY_OVERTIME_HOURS)).toBe("24h");
    expect(formatThreshold(7.333333)).toBe("7.33h");
  });
});

describe("banked overtime", () => {
  const shift = (key: string, day: string, hours: number, worker = "a") => ({
    key,
    worker,
    day,
    hours,
  });
  const banking = (afterHours: number | null) => ({
    daily_threshold_hours: 8,
    weekly_threshold_hours: null,
    bank_overtime: true,
    bank_after_overtime_hours: afterHours,
  });

  it("reads the banking rules, treating bad values as bank-all", () => {
    expect(getOvertimeBanking(null)).toEqual({
      enabled: false,
      afterHours: 0,
    });
    expect(getOvertimeBanking(banking(4))).toEqual({
      enabled: true,
      afterHours: 4,
    });
    expect(getOvertimeBanking(banking(-3)).afterHours).toBe(0);
    expect(getOvertimeBanking(banking(500)).afterHours).toBe(0);
    expect(getOvertimeBanking(banking(null)).afterHours).toBe(0);
  });

  it("validates the stored bank-after value", () => {
    expect(isValidBankAfterHours(null)).toBe(true);
    expect(isValidBankAfterHours(0)).toBe(true);
    expect(isValidBankAfterHours(168)).toBe(true);
    expect(isValidBankAfterHours(-1)).toBe(false);
    expect(isValidBankAfterHours(169)).toBe(false);
    expect(isValidBankAfterHours(Number.NaN)).toBe(false);
    expect(isValidBankAfterHours("4")).toBe(false);
  });

  it("leaves banking out of the split when it is off", () => {
    const result = allocateOvertime(
      [shift("s1", "2026-01-05", 10)],
      settings(8, null),
    );
    expect(result.get("s1")).not.toHaveProperty("bankedOvertimeHours");
    expect(sumOvertime(result.values())).not.toHaveProperty(
      "bankedOvertimeHours",
    );
  });

  it("banks all overtime when no paid allowance is set", () => {
    const result = allocateOvertime(
      [shift("s1", "2026-01-05", 10)],
      banking(0),
    );
    expect(result.get("s1")).toMatchObject({
      overtimeHours: 2,
      bankedOvertimeHours: 2,
    });
    expect(paidOvertimeHours(result.get("s1") as never)).toBe(0);
  });

  it("pays the first overtime hours each week and banks the rest", () => {
    // 3h OT Mon, 3h OT Tue, then 2h OT the next Monday (a new week).
    const result = allocateOvertime(
      [
        shift("mon", "2026-01-05", 11),
        shift("tue", "2026-01-06", 11),
        shift("b", "2026-01-06", 11, "b"),
        shift("next", "2026-01-12", 10),
      ],
      banking(4),
    );
    expect(result.get("mon")?.bankedOvertimeHours).toBe(0);
    expect(result.get("tue")?.bankedOvertimeHours).toBe(2);
    // Another worker has their own allowance.
    expect(result.get("b")?.bankedOvertimeHours).toBe(0);
    expect(result.get("next")?.bankedOvertimeHours).toBe(0);
    const total = sumOvertime(result.values());
    expect(total.overtimeHours).toBe(11);
    expect(total.bankedOvertimeHours).toBe(2);
    expect(paidOvertimeHours(total)).toBe(9);
  });

  it("describes the banking rule", () => {
    expect(describeBanking(null)).toBe("off");
    expect(describeBanking(banking(0))).toBe("all overtime is banked");
    expect(describeBanking(banking(5))).toBe("overtime past 5h/week is banked");
  });
});
