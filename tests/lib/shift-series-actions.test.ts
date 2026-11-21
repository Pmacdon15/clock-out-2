import { err, ok } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateTag: vi.fn(),
  after: vi.fn((fn: () => unknown) => fn()),
  createScheduledShiftDal: vi.fn(),
  startShiftSeriesDal: vi.fn(),
  stopShiftSeriesDal: vi.fn(),
  fillShiftSeries: vi.fn(),
  syncNewSeriesShifts: vi.fn(),
  notifyScheduleChange: vi.fn(),
  notifyWeeklyShiftsAdded: vi.fn(),
  syncShiftReminderJob: vi.fn(() => Promise.resolve(true)),
  queueShiftAlertSync: vi.fn(),
  mirrorShiftToGoogleCalendar: vi.fn(() => Promise.resolve()),
}));

vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("next/cache", () => ({ updateTag: mocks.updateTag }));
vi.mock("@clerk/nextjs/server", () => ({ auth: { protect: vi.fn() } }));
vi.mock("@/lib/geoapify", () => ({}));
vi.mock("@/lib/reports", () => ({}));
vi.mock("@/lib/rate-limit", () => ({}));
vi.mock("@/lib/dal", () => ({
  createScheduledShiftDal: mocks.createScheduledShiftDal,
  startShiftSeriesDal: mocks.startShiftSeriesDal,
  stopShiftSeriesDal: mocks.stopShiftSeriesDal,
}));
vi.mock("@/lib/shift-series-runner", () => ({
  fillShiftSeries: mocks.fillShiftSeries,
  syncNewSeriesShifts: mocks.syncNewSeriesShifts,
}));
vi.mock("@/lib/schedule-notify", () => ({
  notifyScheduleChange: mocks.notifyScheduleChange,
  notifyWeeklyShiftsAdded: mocks.notifyWeeklyShiftsAdded,
}));
vi.mock("@/lib/alert-jobs", () => ({
  queueShiftAlertSync: mocks.queueShiftAlertSync,
  syncShiftReminderJob: mocks.syncShiftReminderJob,
}));
vi.mock("@/lib/google-calendar", () => ({
  mirrorShiftToGoogleCalendar: mocks.mirrorShiftToGoogleCalendar,
}));

import {
  createRepeatingShiftAction,
  repeatShiftWeeklyAction,
  stopRepeatingShiftAction,
} from "@/lib/actions";

const first = { id: 1, org_id: "org_1", user_id: "user_1" };
const series = { id: 4 };
const week2 = { id: 2, org_id: "org_1", user_id: "user_1" };
const skipped = [
  { shiftStart: "2026-12-07T15:00:00.000Z", reason: "Time off" },
];

describe("createRepeatingShiftAction", () => {
  it("publishes the first shift, starts repeating and makes the next weeks", async () => {
    mocks.createScheduledShiftDal.mockResolvedValue(ok(first));
    mocks.startShiftSeriesDal.mockResolvedValue(ok({ shift: first, series }));
    mocks.fillShiftSeries.mockResolvedValue({ created: [week2], skipped });
    await expect(
      createRepeatingShiftAction(
        "user_1",
        "2026-11-23T15:00:00.000Z",
        "2026-11-23T23:30:00.000Z",
        "Desk",
        "America/Edmonton",
        { start: "2026-11-23", end: "2026-11-23" },
        { siteId: 7 },
      ),
    ).resolves.toEqual({ success: true, data: [first, week2], skipped });
    expect(mocks.createScheduledShiftDal).toHaveBeenCalledWith(
      "user_1",
      new Date("2026-11-23T15:00:00.000Z"),
      new Date("2026-11-23T23:30:00.000Z"),
      "Desk",
      { start: "2026-11-23", end: "2026-11-23" },
      { siteId: 7 },
    );
    expect(mocks.startShiftSeriesDal).toHaveBeenCalledWith(
      1,
      "America/Edmonton",
    );
    expect(mocks.fillShiftSeries).toHaveBeenCalledWith(series);
    // One notice for the whole run, not one per week.
    expect(mocks.notifyWeeklyShiftsAdded).toHaveBeenCalledWith(
      [first, week2],
      "America/Edmonton",
    );
    expect(mocks.syncNewSeriesShifts).toHaveBeenCalledWith([first, week2]);
    expect(mocks.updateTag).toHaveBeenCalledWith("scheduled-shifts-org_1");
    expect(mocks.queueShiftAlertSync).toHaveBeenCalledWith("org_1");
  });

  it("returns the publish error without starting a series", async () => {
    mocks.createScheduledShiftDal.mockResolvedValue(err({ reason: "nope" }));
    await expect(
      createRepeatingShiftAction("user_1", "a", "b"),
    ).resolves.toEqual({ success: false, error: "nope" });
    expect(mocks.startShiftSeriesDal).not.toHaveBeenCalled();
  });

  it("says the shift was published when repeating couldn't start", async () => {
    mocks.createScheduledShiftDal.mockResolvedValue(ok(first));
    mocks.startShiftSeriesDal.mockResolvedValue(
      err({ reason: "Couldn't tell your time zone" }),
    );
    await expect(
      createRepeatingShiftAction("user_1", "a", "b", null, "bad"),
    ).resolves.toEqual({
      success: false,
      error:
        "Shift published, but it couldn't be set to repeat: Couldn't tell your time zone",
    });
    expect(mocks.notifyScheduleChange).toHaveBeenCalledWith(
      "added",
      first,
      "bad",
    );
    expect(mocks.syncNewSeriesShifts).toHaveBeenCalledWith([first]);
    expect(mocks.updateTag).toHaveBeenCalledWith("scheduled-shifts-org_1");
  });
});

describe("repeatShiftWeeklyAction", () => {
  it("starts repeating an existing shift and makes only the new weeks", async () => {
    mocks.startShiftSeriesDal.mockResolvedValue(ok({ shift: first, series }));
    mocks.fillShiftSeries.mockResolvedValue({ created: [week2], skipped: [] });
    await expect(repeatShiftWeeklyAction(1, "UTC")).resolves.toEqual({
      success: true,
      data: [week2],
      skipped: [],
    });
    expect(mocks.notifyWeeklyShiftsAdded).toHaveBeenCalledWith([week2], "UTC");
  });

  it("doesn't notify when no week was made", async () => {
    mocks.startShiftSeriesDal.mockResolvedValue(ok({ shift: first, series }));
    mocks.fillShiftSeries.mockResolvedValue({ created: [], skipped });
    await expect(repeatShiftWeeklyAction(1, "UTC")).resolves.toMatchObject({
      success: true,
      data: [],
    });
    expect(mocks.notifyWeeklyShiftsAdded).not.toHaveBeenCalled();
    expect(mocks.updateTag).toHaveBeenCalledWith("scheduled-shifts-org_1");
  });

  it("returns the error", async () => {
    mocks.startShiftSeriesDal.mockResolvedValue(
      err({ reason: "This shift already repeats weekly" }),
    );
    await expect(repeatShiftWeeklyAction(1, "UTC")).resolves.toEqual({
      success: false,
      error: "This shift already repeats weekly",
    });
    expect(mocks.fillShiftSeries).not.toHaveBeenCalled();
  });
});

describe("stopRepeatingShiftAction", () => {
  it("clears the removed weeks from reminders and Google Calendar", async () => {
    mocks.stopShiftSeriesDal.mockResolvedValue(
      ok({ shift: first, removed: [week2] }),
    );
    await expect(stopRepeatingShiftAction(1)).resolves.toEqual({
      success: true,
      removed: 1,
    });
    expect(mocks.syncShiftReminderJob).toHaveBeenCalledWith("removed", week2);
    expect(mocks.mirrorShiftToGoogleCalendar).toHaveBeenCalledWith(
      "removed",
      week2,
    );
    expect(mocks.updateTag).toHaveBeenCalledWith("scheduled-shifts-org_1");
    expect(mocks.queueShiftAlertSync).toHaveBeenCalledWith("org_1");
  });

  it("returns the error", async () => {
    mocks.stopShiftSeriesDal.mockResolvedValue(
      err({ reason: "This shift doesn't repeat" }),
    );
    await expect(stopRepeatingShiftAction(1)).resolves.toEqual({
      success: false,
      error: "This shift doesn't repeat",
    });
    expect(mocks.updateTag).not.toHaveBeenCalled();
  });
});
