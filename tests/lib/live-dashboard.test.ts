import { describe, expect, it } from "vitest";
import {
  formatDuration,
  hoursWithin,
  type LiveDashboardData,
  type LiveShift,
  summarizeLive,
} from "@/lib/live-dashboard";
import type { BreakSettingsData } from "@/lib/types";

const at = (iso: string) => new Date(iso).getTime();
const NOW = at("2026-03-10T15:00:00Z");
const DAY = at("2026-03-10T00:00:00Z");

const shift = (over: Partial<LiveShift> = {}): LiveShift => ({
  id: 1,
  userId: "u1",
  clockIn: "2026-03-10T09:00:00Z",
  clockOut: null,
  skipLunch: false,
  breaks: [],
  siteName: null,
  ...over,
});

const data = (over: Partial<LiveDashboardData> = {}): LiveDashboardData => ({
  members: [
    { id: "u1", name: "Ann" },
    { id: "u2", name: "Bo" },
    { id: "u3", name: "Cy" },
  ],
  shifts: [],
  breakSettings: null,
  hourlyRates: {},
  ...over,
});

describe("hoursWithin", () => {
  it("counts a running shift up to now", () => {
    expect(hoursWithin(shift(), null, DAY, NOW)).toBe(6);
  });

  it("counts only the part of an overnight shift after midnight", () => {
    const s = shift({
      clockIn: "2026-03-09T22:00:00Z",
      clockOut: "2026-03-10T02:00:00Z",
    });
    expect(hoursWithin(s, null, DAY, NOW)).toBe(2);
  });

  it("spreads unpaid breaks over the shift", () => {
    const s = shift({
      clockIn: "2026-03-09T22:00:00Z",
      clockOut: "2026-03-10T02:00:00Z",
      breaks: [
        {
          break_type: "unpaid_meal",
          break_start: "2026-03-09T23:00:00Z" as never,
          break_end: "2026-03-10T00:00:00Z" as never,
        },
      ],
    });
    // 3 net hours, half of the shift is today.
    expect(hoursWithin(s, null, DAY, NOW)).toBe(1.5);
  });

  it("ignores shifts that ended before today, start later, or have no length", () => {
    expect(
      hoursWithin(
        shift({
          clockIn: "2026-03-09T08:00:00Z",
          clockOut: "2026-03-09T12:00:00Z",
        }),
        null,
        DAY,
        NOW,
      ),
    ).toBe(0);
    expect(
      hoursWithin(shift({ clockIn: "2026-03-10T16:00:00Z" }), null, DAY, NOW),
    ).toBe(0);
    expect(
      hoursWithin(shift({ clockOut: "2026-03-10T09:00:00Z" }), null, DAY, NOW),
    ).toBe(0);
  });

  it("applies the org's lunch dock", () => {
    const settings = {
      dock_lunch: true,
      lunch_duration_minutes: 30,
      lunch_min_shift_hours: 5,
    } as BreakSettingsData;
    expect(hoursWithin(shift(), settings, DAY, NOW)).toBe(5.5);
  });
});

describe("summarizeLive", () => {
  it("lists who's working, oldest punch first, with breaks and rates", () => {
    const summary = summarizeLive(
      data({
        hourlyRates: { u1: 20 },
        shifts: [
          shift({ id: 1, userId: "u1", siteName: "Depot" }),
          shift({
            id: 2,
            userId: "u2",
            clockIn: "2026-03-10T08:00:00Z",
            breaks: [
              {
                break_type: "paid_rest",
                break_start: "2026-03-10T14:50:00Z" as never,
                break_end: null,
              },
            ],
          }),
          shift({
            id: 3,
            userId: "u3",
            clockIn: "2026-03-10T07:00:00Z",
            clockOut: "2026-03-10T11:00:00Z",
          }),
          shift({ id: 4, userId: "gone", clockIn: "2026-03-10T09:00:00Z" }),
        ],
      }),
      NOW,
      DAY,
    );

    expect(summary.working.map((w) => [w.name, w.breakType])).toEqual([
      ["Bo", "paid_rest"],
      ["Ann", null],
      ["Former member", null],
    ]);
    expect(summary.working[1]).toMatchObject({
      siteName: "Depot",
      shiftHours: 6,
      hourlyRate: 20,
    });
    expect(summary.working[0]?.hourlyRate).toBeNull();
    expect(summary.headcount).toEqual({
      onClock: 3,
      onBreak: 1,
      off: 1,
      members: 3,
    });
    // Ann 6h + Bo 7h + Cy 4h + former 6h = 23h; only Ann is costed.
    expect(summary.today).toEqual({
      hours: 23,
      cost: 120,
      unratedHours: 17,
      unratedMembers: ["Bo", "Cy", "Former member"],
    });
  });

  it("breaks punch-time ties by name and skips clock-ins in the future", () => {
    const summary = summarizeLive(
      data({
        shifts: [
          shift({ id: 1, userId: "u2" }),
          shift({ id: 2, userId: "u1" }),
          shift({ id: 3, userId: "u3", clockIn: "2026-03-10T16:00:00Z" }),
        ],
      }),
      NOW,
      DAY,
    );
    expect(summary.working.map((w) => w.name)).toEqual(["Ann", "Bo"]);
    expect(summary.headcount.off).toBe(1);
  });

  it("reports an empty org", () => {
    expect(summarizeLive(data({ members: [] }), NOW, DAY)).toEqual({
      working: [],
      headcount: { onClock: 0, onBreak: 0, off: 0, members: 0 },
      today: { hours: 0, cost: 0, unratedHours: 0, unratedMembers: [] },
    });
  });
});

describe("formatDuration", () => {
  it("shows hours and zero-padded minutes", () => {
    expect(formatDuration(3.0833)).toBe("3h 04m");
    expect(formatDuration(0)).toBe("0h 00m");
    expect(formatDuration(-1)).toBe("0h 00m");
  });
});
