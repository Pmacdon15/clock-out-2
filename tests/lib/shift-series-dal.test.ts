import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  protect: vi.fn(),
  dbGetScheduledShiftById: vi.fn(),
  dbGetShiftSeriesById: vi.fn(),
  dbCreateShiftSeries: vi.fn(),
  dbEndShiftSeries: vi.fn(),
  dbDeleteShiftSeriesShiftsAfter: vi.fn(),
}));

vi.mock("next/server", () => ({ connection: () => Promise.resolve() }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: { protect: mocks.protect },
  clerkClient: vi.fn(),
}));
vi.mock("@/lib/geoapify", () => ({ reverseGeocode: vi.fn() }));
vi.mock("@/lib/db", () => ({
  dbGetScheduledShiftById: mocks.dbGetScheduledShiftById,
  dbGetShiftSeriesById: mocks.dbGetShiftSeriesById,
  dbCreateShiftSeries: mocks.dbCreateShiftSeries,
  dbEndShiftSeries: mocks.dbEndShiftSeries,
  dbDeleteShiftSeriesShiftsAfter: mocks.dbDeleteShiftSeriesShiftsAfter,
}));

import { startShiftSeriesDal, stopShiftSeriesDal } from "@/lib/dal";

const admin = {
  userId: "admin_1",
  orgId: "org_1",
  orgRole: "org:admin",
  has: () => true,
};
const shift = {
  id: 3,
  org_id: "org_1",
  user_id: "user_1",
  shift_start: new Date("2026-11-23T15:00:00Z"),
  shift_end: new Date("2026-11-23T23:30:00Z"),
  series_id: null,
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.protect.mockResolvedValue(admin);
  mocks.dbGetScheduledShiftById.mockResolvedValue(shift);
});

describe("startShiftSeriesDal", () => {
  it("only lets admins on the Scheduling plan repeat shifts", async () => {
    mocks.protect.mockResolvedValueOnce({ ...admin, orgRole: "org:member" });
    expect((await startShiftSeriesDal(3, "UTC")).isErr()).toBe(true);
    mocks.protect.mockResolvedValueOnce({ ...admin, has: () => false });
    const res = await startShiftSeriesDal(3, "UTC");
    expect(res.isErr() && res.error.reason).toMatch(/plan|upgrade/i);
    expect(mocks.dbCreateShiftSeries).not.toHaveBeenCalled();
  });

  it("needs a real time zone", async () => {
    const res = await startShiftSeriesDal(3, "Nowhere/Here");
    expect(res.isErr() && res.error.reason).toBe(
      "Couldn't tell your time zone",
    );
  });

  it("saves the repeating shift from the published one", async () => {
    mocks.dbCreateShiftSeries.mockResolvedValue({ id: 9 });
    const res = await startShiftSeriesDal(3, "America/Edmonton");
    expect(res.isOk() && res.value).toEqual({ shift, series: { id: 9 } });
    expect(mocks.dbGetScheduledShiftById).toHaveBeenCalledWith(3, "org_1");
    expect(mocks.dbCreateShiftSeries).toHaveBeenCalledWith(
      shift,
      "America/Edmonton",
      "admin_1",
    );
  });

  it("refuses a missing shift or one that already repeats", async () => {
    mocks.dbGetScheduledShiftById.mockResolvedValueOnce(undefined);
    let res = await startShiftSeriesDal(3, "UTC");
    expect(res.isErr() && res.error.reason).toBe("Shift not found");

    mocks.dbGetScheduledShiftById.mockResolvedValueOnce({
      ...shift,
      series_id: 4,
    });
    mocks.dbGetShiftSeriesById.mockResolvedValueOnce({ id: 4, ended_at: null });
    res = await startShiftSeriesDal(3, "UTC");
    expect(res.isErr() && res.error.reason).toBe(
      "This shift already repeats weekly",
    );
    expect(mocks.dbCreateShiftSeries).not.toHaveBeenCalled();
  });

  it("can restart a series that was stopped", async () => {
    mocks.dbGetScheduledShiftById.mockResolvedValueOnce({
      ...shift,
      series_id: 4,
    });
    mocks.dbGetShiftSeriesById.mockResolvedValueOnce({
      id: 4,
      ended_at: new Date(),
    });
    mocks.dbCreateShiftSeries.mockResolvedValue({ id: 10 });
    expect((await startShiftSeriesDal(3, "UTC")).isOk()).toBe(true);
  });

  it("reports database failures", async () => {
    mocks.dbCreateShiftSeries.mockRejectedValue(new Error("db"));
    const res = await startShiftSeriesDal(3, "UTC");
    expect(res.isErr() && res.error.reason).toBe("Failed to repeat shift");
  });
});

describe("stopShiftSeriesDal", () => {
  it("only lets admins stop repeating", async () => {
    mocks.protect.mockResolvedValueOnce({ ...admin, orgRole: "org:member" });
    expect((await stopShiftSeriesDal(3)).isErr()).toBe(true);
    mocks.protect.mockResolvedValueOnce({ ...admin, has: () => false });
    expect((await stopShiftSeriesDal(3)).isErr()).toBe(true);
    expect(mocks.dbEndShiftSeries).not.toHaveBeenCalled();
  });

  it("ends the series and removes its weeks after the shift", async () => {
    const repeating = { ...shift, series_id: 4 };
    mocks.dbGetScheduledShiftById.mockResolvedValue(repeating);
    mocks.dbDeleteShiftSeriesShiftsAfter.mockResolvedValue([{ id: 5 }]);
    const res = await stopShiftSeriesDal(3);
    expect(res.isOk() && res.value).toEqual({
      shift: repeating,
      removed: [{ id: 5 }],
    });
    expect(mocks.dbEndShiftSeries).toHaveBeenCalledWith(4, "org_1");
    expect(mocks.dbDeleteShiftSeriesShiftsAfter).toHaveBeenCalledWith(
      4,
      "org_1",
      shift.shift_start,
    );
  });

  it("refuses a missing shift or one that doesn't repeat", async () => {
    mocks.dbGetScheduledShiftById.mockResolvedValueOnce(undefined);
    let res = await stopShiftSeriesDal(3);
    expect(res.isErr() && res.error.reason).toBe("Shift not found");
    res = await stopShiftSeriesDal(3);
    expect(res.isErr() && res.error.reason).toBe("This shift doesn't repeat");
  });

  it("reports database failures", async () => {
    mocks.dbGetScheduledShiftById.mockRejectedValue(new Error("db"));
    const res = await stopShiftSeriesDal(3);
    expect(res.isErr() && res.error.reason).toBe("Failed to stop repeating");
  });
});
