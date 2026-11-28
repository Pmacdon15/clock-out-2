// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbClaimShiftSeriesWeeks: vi.fn(),
  dbCreateScheduledShift: vi.fn(),
  dbEndShiftSeries: vi.fn(),
  dbGetActiveShiftSeries: vi.fn(),
  dbGetApprovedTimeOffForPeriod: vi.fn(),
  dbGetOverlappingScheduledShift: vi.fn(),
  loadOrgMembers: vi.fn(),
  orgHasPlanFeature: vi.fn(),
  revalidateTag: vi.fn(),
  queueShiftAlertSync: vi.fn(),
  syncShiftReminderJob: vi.fn(),
  mirrorShiftToGoogleCalendar: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  dbClaimShiftSeriesWeeks: mocks.dbClaimShiftSeriesWeeks,
  dbCreateScheduledShift: mocks.dbCreateScheduledShift,
  dbEndShiftSeries: mocks.dbEndShiftSeries,
  dbGetActiveShiftSeries: mocks.dbGetActiveShiftSeries,
  dbGetApprovedTimeOffForPeriod: mocks.dbGetApprovedTimeOffForPeriod,
  dbGetOverlappingScheduledShift: mocks.dbGetOverlappingScheduledShift,
}));
vi.mock("@/lib/alerts-runner", () => ({
  loadOrgMembers: mocks.loadOrgMembers,
}));
vi.mock("@/lib/plan-features", () => ({
  orgHasPlanFeature: mocks.orgHasPlanFeature,
  SCHEDULING_FEATURE: "scheduling",
}));
vi.mock("next/cache", () => ({ revalidateTag: mocks.revalidateTag }));
vi.mock("@/lib/alert-jobs", () => ({
  queueShiftAlertSync: mocks.queueShiftAlertSync,
  syncShiftReminderJob: mocks.syncShiftReminderJob,
}));
vi.mock("@/lib/google-calendar", () => ({
  mirrorShiftToGoogleCalendar: mocks.mirrorShiftToGoogleCalendar,
}));

import {
  dueSeriesOccurrences,
  MAX_SERIES_WEEKS_PER_RUN,
  seriesOccurrence,
} from "@/lib/shift-series";
import {
  fillShiftSeries,
  runShiftSeries,
  syncNewSeriesShifts,
} from "@/lib/shift-series-runner";
import type { ShiftSeries } from "@/lib/types";

// Mon, Nov 23 2026, 9:00 AM – 5:30 PM in Calgary (UTC-6 year-round).
const series: ShiftSeries = {
  id: 4,
  org_id: "org_1",
  user_id: "user_1",
  first_start: new Date("2026-11-23T15:00:00Z"),
  first_end: new Date("2026-11-23T23:30:00Z"),
  timezone: "America/Edmonton",
  note: "Desk",
  site_id: 7,
  location: "Main Shop",
  location_address: "1 King St",
  next_index: 1,
  created_by: "admin_1",
  ended_at: null,
};

describe("seriesOccurrence", () => {
  it("is the first shift at week 0 and a week later at week 1", () => {
    expect(seriesOccurrence(series, 0)).toMatchObject({
      shiftStart: series.first_start,
      shiftEnd: series.first_end,
      localDays: { start: "2026-11-23", end: "2026-11-23" },
    });
    expect(seriesOccurrence(series, 1)).toMatchObject({
      index: 1,
      shiftStart: new Date("2026-11-30T15:00:00Z"),
      shiftEnd: new Date("2026-11-30T23:30:00Z"),
      localDays: { start: "2026-11-30", end: "2026-11-30" },
    });
  });

  it("keeps the same UTC time every week, without time zone rules", () => {
    // Saved by the browser as 13:00 UTC; week 16 is after a daylight saving
    // date, and the server doesn't re-read it through its own zone rules.
    const toronto = {
      first_start: new Date("2026-11-23T13:00:00Z"),
      first_end: new Date("2026-11-23T21:30:00Z"),
      timezone: "America/Toronto",
    };
    const week = seriesOccurrence(toronto, 16);
    expect(week.shiftStart).toEqual(new Date("2027-03-15T13:00:00Z"));
    expect(week.shiftEnd).toEqual(new Date("2027-03-15T21:30:00Z"));
  });

  it("keeps overnight shifts on their local days", () => {
    const overnight = {
      ...series,
      first_start: new Date("2026-11-24T05:00:00Z"), // 10 PM Mon
      first_end: new Date("2026-11-24T13:00:00Z"), // 6 AM Tue
    };
    expect(seriesOccurrence(overnight, 1).localDays).toEqual({
      start: "2026-11-30",
      end: "2026-12-01",
    });
  });

  it("falls back to UTC for an unknown zone", () => {
    const week = seriesOccurrence({ ...series, timezone: "Nowhere/Here" }, 1);
    expect(week.shiftStart).toEqual(new Date("2026-11-30T15:00:00Z"));
  });
});

describe("dueSeriesOccurrences", () => {
  const now = new Date("2026-11-21T12:00:00Z");

  it("makes the weeks starting within five weeks", () => {
    const due = dueSeriesOccurrences(series, now);
    expect(due.occurrences.map((o) => o.index)).toEqual([1, 2, 3, 4]);
    expect(due.nextIndex).toBe(5);
  });

  it("continues from where the last run stopped", () => {
    const due = dueSeriesOccurrences({ ...series, next_index: 5 }, now);
    expect(due.occurrences).toEqual([]);
    expect(due.nextIndex).toBe(5);
    const later = dueSeriesOccurrences(
      { ...series, next_index: 5 },
      new Date("2026-11-28T12:00:00Z"),
    );
    expect(later.occurrences.map((o) => o.index)).toEqual([5]);
    expect(later.nextIndex).toBe(6);
  });

  it("passes over weeks already over instead of making them", () => {
    const due = dueSeriesOccurrences(series, new Date("2027-06-01T00:00:00Z"));
    expect(due.occurrences[0].shiftStart.getTime()).toBeGreaterThan(
      new Date("2027-06-01T00:00:00Z").getTime(),
    );
    expect(due.occurrences.length).toBe(5);
  });

  it("makes at most a capped number of weeks in one run", () => {
    const due = dueSeriesOccurrences(series, now, 400);
    expect(due.occurrences).toHaveLength(MAX_SERIES_WEEKS_PER_RUN);
    expect(due.nextIndex).toBe(MAX_SERIES_WEEKS_PER_RUN + 1);
  });
});

describe("fillShiftSeries", () => {
  const now = new Date("2026-11-21T12:00:00Z");

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.dbClaimShiftSeriesWeeks.mockResolvedValue(true);
    mocks.dbGetApprovedTimeOffForPeriod.mockResolvedValue([]);
    mocks.dbGetOverlappingScheduledShift.mockResolvedValue(undefined);
    mocks.dbCreateScheduledShift.mockImplementation(
      async (_o, _u, start: Date) => ({ id: start.getTime() }),
    );
  });

  it("claims the weeks, then makes each with the series' details", async () => {
    const result = await fillShiftSeries(series, now);
    expect(mocks.dbClaimShiftSeriesWeeks).toHaveBeenCalledWith(4, 1, 5);
    expect(result.created).toHaveLength(4);
    expect(result.skipped).toEqual([]);
    expect(mocks.dbCreateScheduledShift).toHaveBeenCalledWith(
      "org_1",
      "user_1",
      new Date("2026-11-30T15:00:00Z"),
      new Date("2026-11-30T23:30:00Z"),
      "Desk",
      "admin_1",
      { site_id: 7, location: "Main Shop", location_address: "1 King St" },
      4,
    );
    expect(mocks.dbGetApprovedTimeOffForPeriod).toHaveBeenCalledWith(
      "user_1",
      "org_1",
      "2026-11-30",
      "2026-11-30",
    );
  });

  it("does nothing when nothing is due", async () => {
    await expect(
      fillShiftSeries({ ...series, next_index: 5 }, now),
    ).resolves.toEqual({ created: [], skipped: [] });
    expect(mocks.dbClaimShiftSeriesWeeks).not.toHaveBeenCalled();
  });

  it("does nothing when another run claimed the weeks first", async () => {
    mocks.dbClaimShiftSeriesWeeks.mockResolvedValue(false);
    await expect(fillShiftSeries(series, now)).resolves.toEqual({
      created: [],
      skipped: [],
    });
    expect(mocks.dbCreateScheduledShift).not.toHaveBeenCalled();
  });

  it("skips weeks with time off, another shift, or an error", async () => {
    mocks.dbGetApprovedTimeOffForPeriod
      .mockResolvedValueOnce([
        { start_date: "2026-11-30", end_date: "2026-11-30" },
      ])
      .mockResolvedValue([]);
    mocks.dbGetOverlappingScheduledShift
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValue(undefined);
    mocks.dbCreateScheduledShift
      .mockRejectedValueOnce(new Error("db"))
      .mockResolvedValue({ id: 9 });
    const result = await fillShiftSeries(series, now);
    expect(result.created).toEqual([{ id: 9 }]);
    expect(result.skipped.map((s) => s.shiftStart)).toEqual([
      "2026-11-30T15:00:00.000Z",
      "2026-12-07T15:00:00.000Z",
      "2026-12-14T15:00:00.000Z",
    ]);
    expect(result.skipped[0].reason).toMatch(/approved time off/);
    expect(result.skipped[1].reason).toMatch(/already has a shift/);
    expect(result.skipped[2].reason).toBe("Failed to create shift");
  });
});

describe("syncNewSeriesShifts", () => {
  it("schedules reminders and mirrors to Google, tolerating failures", async () => {
    mocks.syncShiftReminderJob.mockRejectedValue(new Error("qstash"));
    mocks.mirrorShiftToGoogleCalendar.mockResolvedValue(undefined);
    const shift = { id: 1 } as never;
    await expect(syncNewSeriesShifts([shift])).resolves.toBeUndefined();
    expect(mocks.syncShiftReminderJob).toHaveBeenCalledWith("added", shift);
    expect(mocks.mirrorShiftToGoogleCalendar).toHaveBeenCalledWith(
      "added",
      shift,
    );
  });
});

describe("runShiftSeries", () => {
  const now = new Date("2026-11-21T12:00:00Z");

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.orgHasPlanFeature.mockResolvedValue(true);
    mocks.loadOrgMembers.mockResolvedValue([{ userId: "user_1" }]);
    mocks.dbClaimShiftSeriesWeeks.mockResolvedValue(true);
    mocks.dbGetApprovedTimeOffForPeriod.mockResolvedValue([]);
    mocks.dbGetOverlappingScheduledShift.mockResolvedValue(undefined);
    mocks.dbCreateScheduledShift.mockResolvedValue({ id: 1 });
    mocks.dbEndShiftSeries.mockResolvedValue({ id: 5 });
    mocks.syncShiftReminderJob.mockResolvedValue(true);
    mocks.mirrorShiftToGoogleCalendar.mockResolvedValue(undefined);
  });

  it("tops up each series and refreshes the org's schedule", async () => {
    mocks.dbGetActiveShiftSeries.mockResolvedValue([series]);
    await expect(runShiftSeries(now)).resolves.toEqual({
      series: 1,
      created: 4,
      ended: 0,
    });
    expect(mocks.revalidateTag).toHaveBeenCalledWith("scheduled-shifts-org_1", {
      expire: 0,
    });
    expect(mocks.queueShiftAlertSync).toHaveBeenCalledWith("org_1");
    expect(mocks.syncShiftReminderJob).toHaveBeenCalledTimes(4);
  });

  it("stops series whose member left the org", async () => {
    mocks.dbGetActiveShiftSeries.mockResolvedValue([
      series,
      { ...series, id: 5, user_id: "gone" },
    ]);
    await expect(runShiftSeries(now)).resolves.toMatchObject({ ended: 1 });
    expect(mocks.dbEndShiftSeries).toHaveBeenCalledWith(5, "org_1");
  });

  it("doesn't count a series another run already stopped", async () => {
    mocks.dbGetActiveShiftSeries.mockResolvedValue([
      { ...series, user_id: "gone" },
    ]);
    mocks.dbEndShiftSeries.mockResolvedValue(undefined);
    await expect(runShiftSeries(now)).resolves.toMatchObject({ ended: 0 });
  });

  it("leaves orgs without Scheduling alone", async () => {
    mocks.dbGetActiveShiftSeries.mockResolvedValue([series]);
    mocks.orgHasPlanFeature.mockResolvedValue(false);
    await expect(runShiftSeries(now)).resolves.toEqual({
      series: 0,
      created: 0,
      ended: 0,
    });
    expect(mocks.dbClaimShiftSeriesWeeks).not.toHaveBeenCalled();
  });

  it("doesn't refresh anything when no week was made", async () => {
    mocks.dbGetActiveShiftSeries.mockResolvedValue([
      { ...series, next_index: 5 },
    ]);
    await runShiftSeries(now);
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });

  it("keeps going with other orgs when one fails", async () => {
    mocks.dbGetActiveShiftSeries.mockResolvedValue([
      series,
      { ...series, id: 6, org_id: "org_2" },
    ]);
    mocks.loadOrgMembers
      .mockRejectedValueOnce(new Error("clerk"))
      .mockResolvedValue([{ userId: "user_1" }]);
    await expect(runShiftSeries(now)).resolves.toMatchObject({ created: 4 });
    expect(mocks.revalidateTag).toHaveBeenCalledWith("scheduled-shifts-org_2", {
      expire: 0,
    });
  });
});
