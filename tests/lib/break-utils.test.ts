import { describe, expect, it } from "vitest";
import {
  getDockedMinutes,
  getEffectiveDurationMs,
  getEffectiveHours,
} from "@/lib/break-utils";
import type { BreakSettingsData } from "@/lib/types";
import { makeEntry } from "../utils";

const activeBreakSettings: BreakSettingsData = {
  org_id: "org_1",
  dock_lunch: true,
  lunch_duration_minutes: 30,
  lunch_min_shift_hours: 5,
};

describe("break-utils", () => {
  it("returns 0 docked minutes when break settings are absent or disabled", () => {
    const shift = makeEntry({
      clock_in: new Date("2026-01-05T09:00:00Z"),
      clock_out: new Date("2026-01-05T17:00:00Z"),
    });
    expect(getDockedMinutes(shift)).toBe(0);
    expect(getDockedMinutes(shift, null)).toBe(0);
    expect(
      getDockedMinutes(shift, { ...activeBreakSettings, dock_lunch: false }),
    ).toBe(0);
    expect(getEffectiveHours(shift, null)).toBe(8);
  });

  it("returns 0 docked minutes when the shift is marked skip_lunch (not docked)", () => {
    const shift = makeEntry({
      clock_in: new Date("2026-01-05T09:00:00Z"),
      clock_out: new Date("2026-01-05T17:00:00Z"),
      skip_lunch: true,
    });
    expect(getDockedMinutes(shift, activeBreakSettings)).toBe(0);
    expect(getEffectiveHours(shift, activeBreakSettings)).toBe(8);
  });

  it("returns 0 docked minutes when lunch_duration_minutes is 0 or negative", () => {
    const shift = makeEntry({
      clock_in: new Date("2026-01-05T09:00:00Z"),
      clock_out: new Date("2026-01-05T17:00:00Z"),
    });
    expect(
      getDockedMinutes(shift, {
        ...activeBreakSettings,
        lunch_duration_minutes: 0,
      }),
    ).toBe(0);
  });

  it("returns 0 docked minutes when the shift is shorter than lunch_min_shift_hours", () => {
    const shortShift = makeEntry({
      clock_in: new Date("2026-01-05T09:00:00Z"),
      clock_out: new Date("2026-01-05T13:30:00Z"), // 4.5 hours < 5 hours
    });
    expect(getDockedMinutes(shortShift, activeBreakSettings)).toBe(0);
    expect(getEffectiveHours(shortShift, activeBreakSettings)).toBe(4.5);
  });

  it("docks the configured minutes when the shift meets or exceeds lunch_min_shift_hours", () => {
    const fullShift = makeEntry({
      clock_in: new Date("2026-01-05T09:00:00Z"),
      clock_out: new Date("2026-01-05T17:00:00Z"), // 8 hours
    });
    expect(getDockedMinutes(fullShift, activeBreakSettings)).toBe(30);
    expect(getEffectiveDurationMs(fullShift, activeBreakSettings)).toBe(
      7.5 * 3_600_000,
    );
    expect(getEffectiveHours(fullShift, activeBreakSettings)).toBe(7.5);
  });

  it("evaluates open shifts against the provided nowMs timestamp", () => {
    const openShift = makeEntry({
      clock_in: new Date("2026-01-05T09:00:00Z"),
      clock_out: null,
    });
    const sixHoursLater = new Date("2026-01-05T15:00:00Z").getTime();
    expect(
      getDockedMinutes(openShift, activeBreakSettings, sixHoursLater),
    ).toBe(30);
    expect(
      getEffectiveHours(openShift, activeBreakSettings, sixHoursLater),
    ).toBe(5.5);
  });

  it("clamps effective duration at 0 if docked minutes exceed shift length", () => {
    const tinyShift = makeEntry({
      clock_in: new Date("2026-01-05T09:00:00Z"),
      clock_out: new Date("2026-01-05T09:15:00Z"),
    });
    const settings: BreakSettingsData = {
      org_id: "org_1",
      dock_lunch: true,
      lunch_duration_minutes: 30,
      lunch_min_shift_hours: 0,
    };
    expect(getEffectiveDurationMs(tinyShift, settings)).toBe(0);
    expect(getEffectiveHours(tinyShift, settings)).toBe(0);
  });
});
