import { err, ok } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateTag: vi.fn(),
  createScheduledShiftDal: vi.fn(),
  deleteScheduledShiftDal: vi.fn(),
  updateScheduledShiftDal: vi.fn(),
  after: vi.fn((fn: () => unknown) => fn()),
  notifyScheduleChange: vi.fn(),
  syncShiftReminderJob: vi.fn(() => Promise.resolve(true)),
  mirrorShiftToGoogleCalendar: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/google-calendar", () => ({
  mirrorShiftToGoogleCalendar: mocks.mirrorShiftToGoogleCalendar,
}));

vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/schedule-notify", () => ({
  notifyScheduleChange: mocks.notifyScheduleChange,
}));

vi.mock("@/lib/alert-jobs", () => ({
  queueShiftAlertSync: vi.fn(),
  syncShiftReminderJob: mocks.syncShiftReminderJob,
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: { protect: vi.fn() } }));
vi.mock("next/cache", () => ({ updateTag: mocks.updateTag }));
vi.mock("@/lib/geoapify", () => ({}));
vi.mock("@/lib/reports", () => ({}));
vi.mock("@/lib/dal", () => ({
  createScheduledShiftDal: mocks.createScheduledShiftDal,
  deleteScheduledShiftDal: mocks.deleteScheduledShiftDal,
  updateScheduledShiftDal: mocks.updateScheduledShiftDal,
}));

import {
  createScheduledShiftAction,
  deleteScheduledShiftAction,
  updateScheduledShiftAction,
} from "@/lib/actions";

const shift = { id: 1, org_id: "org_1", user_id: "user_1" };

describe("createScheduledShiftAction", () => {
  it("parses the times and revalidates the schedule", async () => {
    mocks.createScheduledShiftDal.mockResolvedValue(ok(shift));
    await expect(
      createScheduledShiftAction(
        "user_1",
        "2026-01-05T09:00:00.000Z",
        "2026-01-05T17:00:00.000Z",
        "Desk",
        "America/Regina",
        { start: "2026-01-05", end: "2026-01-05" },
      ),
    ).resolves.toEqual({ success: true, data: shift });
    // The member is told after the response, in the admin's zone as a fallback.
    // The member is told, and the shift's reminder job is scheduled.
    // …and their Google Calendar follows, if they turned it on.
    expect(mocks.after).toHaveBeenCalledTimes(3);
    expect(mocks.notifyScheduleChange).toHaveBeenCalledWith(
      "added",
      shift,
      "America/Regina",
    );
    expect(mocks.syncShiftReminderJob).toHaveBeenCalledWith("added", shift);
    expect(mocks.createScheduledShiftDal).toHaveBeenCalledWith(
      "user_1",
      new Date("2026-01-05T09:00:00.000Z"),
      new Date("2026-01-05T17:00:00.000Z"),
      "Desk",
      { start: "2026-01-05", end: "2026-01-05" },
    );
    expect(mocks.updateTag).toHaveBeenCalledWith("scheduled-shifts-org_1");
  });

  it("returns the error", async () => {
    mocks.createScheduledShiftDal.mockResolvedValue(err({ reason: "nope" }));
    await expect(
      createScheduledShiftAction("user_1", "a", "b"),
    ).resolves.toEqual({ success: false, error: "nope" });
    expect(mocks.updateTag).not.toHaveBeenCalled();
    expect(mocks.notifyScheduleChange).not.toHaveBeenCalled();
  });
});

describe("deleteScheduledShiftAction", () => {
  it("revalidates the schedule", async () => {
    mocks.deleteScheduledShiftDal.mockResolvedValue(ok(shift));
    await expect(deleteScheduledShiftAction(1, "UTC")).resolves.toEqual({
      success: true,
    });
    expect(mocks.updateTag).toHaveBeenCalledWith("scheduled-shifts-org_1");
    expect(mocks.notifyScheduleChange).toHaveBeenCalledWith(
      "removed",
      shift,
      "UTC",
    );
    expect(mocks.syncShiftReminderJob).toHaveBeenCalledWith("removed", shift);
  });

  it("returns the error", async () => {
    mocks.deleteScheduledShiftDal.mockResolvedValue(err({ reason: "nope" }));
    await expect(deleteScheduledShiftAction(1)).resolves.toEqual({
      success: false,
      error: "nope",
    });
  });
});

describe("updateScheduledShiftAction", () => {
  it("parses the times, revalidates and tells the member", async () => {
    mocks.updateScheduledShiftDal.mockResolvedValue(ok(shift));
    await expect(
      updateScheduledShiftAction(
        1,
        "2026-01-06T09:00:00.000Z",
        "2026-01-06T17:00:00.000Z",
        "Desk",
        "UTC",
        { start: "2026-01-06", end: "2026-01-06" },
      ),
    ).resolves.toEqual({ success: true, data: shift });
    expect(mocks.updateScheduledShiftDal).toHaveBeenCalledWith(
      1,
      new Date("2026-01-06T09:00:00.000Z"),
      new Date("2026-01-06T17:00:00.000Z"),
      "Desk",
      { start: "2026-01-06", end: "2026-01-06" },
    );
    expect(mocks.updateTag).toHaveBeenCalledWith("scheduled-shifts-org_1");
    expect(mocks.notifyScheduleChange).toHaveBeenCalledWith(
      "changed",
      shift,
      "UTC",
    );
    expect(mocks.syncShiftReminderJob).toHaveBeenCalledWith("changed", shift);
  });

  it("returns the error", async () => {
    mocks.updateScheduledShiftDal.mockResolvedValue(err({ reason: "nope" }));
    await expect(updateScheduledShiftAction(1, "a", "b")).resolves.toEqual({
      success: false,
      error: "nope",
    });
    expect(mocks.notifyScheduleChange).not.toHaveBeenCalled();
  });
});

describe("shift reminder scheduling", () => {
  it("logs, and never fails the save, when the reminder can't be scheduled", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = new Error("qstash down");
    mocks.syncShiftReminderJob.mockRejectedValueOnce(boom);
    mocks.createScheduledShiftDal.mockResolvedValue(ok(shift));
    await expect(
      createScheduledShiftAction(
        "user_1",
        "2026-01-05T09:00:00.000Z",
        "2026-01-05T17:00:00.000Z",
      ),
    ).resolves.toEqual({ success: true, data: shift });
    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        "[Jobs] Failed to schedule shift reminder:",
        boom,
      ),
    );
  });
});

describe("Google Calendar mirroring", () => {
  it("mirrors each shift change to the member's Google Calendar", async () => {
    mocks.createScheduledShiftDal.mockResolvedValue(ok(shift));
    mocks.updateScheduledShiftDal.mockResolvedValue(ok(shift));
    mocks.deleteScheduledShiftDal.mockResolvedValue(ok(shift));
    mocks.mirrorShiftToGoogleCalendar.mockClear();
    await createScheduledShiftAction(
      "user_1",
      "2026-01-05T09:00:00Z",
      "2026-01-05T17:00:00Z",
    );
    await updateScheduledShiftAction(
      1,
      "2026-01-05T09:00:00Z",
      "2026-01-05T17:00:00Z",
    );
    await deleteScheduledShiftAction(1);
    expect(mocks.mirrorShiftToGoogleCalendar.mock.calls).toEqual([
      ["added", shift],
      ["changed", shift],
      ["removed", shift],
    ]);
  });

  it("logs a failed mirror instead of failing the change", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.deleteScheduledShiftDal.mockResolvedValue(ok(shift));
    mocks.mirrorShiftToGoogleCalendar.mockRejectedValueOnce(new Error("down"));
    await expect(deleteScheduledShiftAction(1)).resolves.toEqual({
      success: true,
    });
    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        "[Google Calendar] Failed to update a shift event:",
        expect.any(Error),
      ),
    );
    error.mockRestore();
  });
});
