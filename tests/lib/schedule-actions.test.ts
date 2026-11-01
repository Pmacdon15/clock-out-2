import { err, ok } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateTag: vi.fn(),
  createScheduledShiftDal: vi.fn(),
  deleteScheduledShiftDal: vi.fn(),
  after: vi.fn((fn: () => unknown) => fn()),
  notifyScheduleChange: vi.fn(),
}));

vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/schedule-notify", () => ({
  notifyScheduleChange: mocks.notifyScheduleChange,
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: { protect: vi.fn() } }));
vi.mock("next/cache", () => ({ updateTag: mocks.updateTag }));
vi.mock("@/lib/geoapify", () => ({}));
vi.mock("@/lib/reports", () => ({}));
vi.mock("@/lib/dal", () => ({
  createScheduledShiftDal: mocks.createScheduledShiftDal,
  deleteScheduledShiftDal: mocks.deleteScheduledShiftDal,
}));

import {
  createScheduledShiftAction,
  deleteScheduledShiftAction,
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
    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(mocks.notifyScheduleChange).toHaveBeenCalledWith(
      "added",
      shift,
      "America/Regina",
    );
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
  });

  it("returns the error", async () => {
    mocks.deleteScheduledShiftDal.mockResolvedValue(err({ reason: "nope" }));
    await expect(deleteScheduledShiftAction(1)).resolves.toEqual({
      success: false,
      error: "nope",
    });
  });
});
