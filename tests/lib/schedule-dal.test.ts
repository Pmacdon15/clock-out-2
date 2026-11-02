import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  protect: vi.fn(),
  fetchAllPages: vi.fn(),
  getProcessedMembers: vi.fn(),
  dbGetScheduledShifts: vi.fn(),
  dbCreateScheduledShift: vi.fn(),
  dbDeleteScheduledShift: vi.fn(),
  dbGetOrgTimeEntries: vi.fn(),
  dbGetTimeEntries: vi.fn(),
  dbGetApprovedTimeOffForPeriod: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: { protect: mocks.protect },
  clerkClient: vi.fn(async () => ({
    organizations: { getOrganizationMembershipList: vi.fn() },
  })),
}));
vi.mock("@/lib/clerk-pagination", () => ({
  fetchAllPages: mocks.fetchAllPages,
}));
vi.mock("@/lib/utils-clerk", () => ({
  getProcessedMembers: mocks.getProcessedMembers,
  isOverMemberShipLimit: vi.fn(),
}));
vi.mock("@/lib/geoapify", () => ({ reverseGeocode: vi.fn() }));
vi.mock("@/lib/db", () => ({
  dbGetScheduledShifts: mocks.dbGetScheduledShifts,
  dbCreateScheduledShift: mocks.dbCreateScheduledShift,
  dbDeleteScheduledShift: mocks.dbDeleteScheduledShift,
  dbGetOrgTimeEntries: mocks.dbGetOrgTimeEntries,
  dbGetTimeEntries: mocks.dbGetTimeEntries,
  dbGetApprovedTimeOffForPeriod: mocks.dbGetApprovedTimeOffForPeriod,
}));

import {
  createScheduledShiftDal,
  deleteScheduledShiftDal,
  getSchedule,
} from "@/lib/dal";

const member = { userId: "user_1", orgId: "org_1", orgRole: "org:member" };
const admin = { userId: "admin_1", orgId: "org_1", orgRole: "org:admin" };
const noUser = { userId: null, orgId: "org_1", orgRole: "org:admin" };
const noOrg = { userId: "admin_1", orgId: null, orgRole: "org:admin" };

const shiftStart = new Date("2026-01-05T09:00:00Z");
const shiftEnd = new Date("2026-01-05T17:00:00Z");
const shift = {
  id: 1,
  org_id: "org_1",
  user_id: "user_1",
  shift_start: shiftStart,
  shift_end: shiftEnd,
  note: null,
  created_by: "admin_1",
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-05T12:30:00Z"));
  mocks.fetchAllPages.mockResolvedValue([]);
  mocks.getProcessedMembers.mockResolvedValue([{ id: "user_1", name: "Sam" }]);
  mocks.dbGetApprovedTimeOffForPeriod.mockResolvedValue([]);
});

describe("getSchedule", () => {
  it.each([
    ["no user", noUser],
    ["no org", noOrg],
  ])("rejects %s", async (_label, session) => {
    mocks.protect.mockResolvedValue(session);
    await expect(getSchedule()).resolves.toEqual({
      ok: false,
      error: { reason: "Unauthorized or no organization selected" },
    });
    expect(mocks.dbGetScheduledShifts).not.toHaveBeenCalled();
  });

  it("gives admins every member's shifts compared with org entries", async () => {
    mocks.protect.mockResolvedValue(admin);
    mocks.dbGetScheduledShifts.mockResolvedValue([shift]);
    mocks.dbGetOrgTimeEntries.mockResolvedValue([
      {
        id: 9,
        user_id: "user_1",
        clock_in: new Date("2026-01-05T09:12:00Z"),
        clock_out: null,
      },
    ]);
    const result = await getSchedule();
    expect(result).toMatchObject({
      ok: true,
      value: [{ id: 1, status: "late", minutes_late: 12 }],
    });
    expect(mocks.dbGetScheduledShifts).toHaveBeenCalledWith(
      "org_1",
      null,
      new Date("2025-12-22T00:00:00Z"),
      new Date("2026-02-03T00:00:00Z"),
    );
    expect(mocks.dbGetOrgTimeEntries).toHaveBeenCalledWith(
      "org_1",
      new Date("2025-12-21T00:00:00Z"),
      new Date("2026-02-03T00:00:00Z"),
    );
    expect(mocks.dbGetTimeEntries).not.toHaveBeenCalled();
  });

  it("gives members only their own shifts and entries", async () => {
    mocks.protect.mockResolvedValue(member);
    mocks.dbGetScheduledShifts.mockResolvedValue([shift]);
    mocks.dbGetTimeEntries.mockResolvedValue([]);
    const result = await getSchedule();
    expect(result).toMatchObject({
      ok: true,
      value: [{ id: 1, status: "not_clocked_in" }],
    });
    expect(mocks.dbGetScheduledShifts.mock.calls[0][1]).toBe("user_1");
    expect(mocks.dbGetTimeEntries).toHaveBeenCalledWith(
      "user_1",
      "org_1",
      new Date("2025-12-21T00:00:00Z"),
      new Date("2026-02-03T00:00:00Z"),
    );
    expect(mocks.dbGetOrgTimeEntries).not.toHaveBeenCalled();
  });

  it("reports a failed read", async () => {
    mocks.protect.mockResolvedValue(member);
    mocks.dbGetScheduledShifts.mockRejectedValue(new Error("db"));
    mocks.dbGetTimeEntries.mockResolvedValue([]);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(getSchedule()).resolves.toEqual({
      ok: false,
      error: { reason: "Error fetching schedule" },
    });
  });
});

describe("createScheduledShiftDal", () => {
  it.each([
    ["no user", noUser],
    ["no org", noOrg],
    ["a non-admin", member],
  ])("rejects %s", async (_label, session) => {
    mocks.protect.mockResolvedValue(session);
    expect(
      (
        await createScheduledShiftDal("user_1", shiftStart, shiftEnd)
      )._unsafeUnwrapErr(),
    ).toEqual({ reason: "Unauthorized" });
    expect(mocks.dbCreateScheduledShift).not.toHaveBeenCalled();
  });

  it("rejects invalid times", async () => {
    mocks.protect.mockResolvedValue(admin);
    expect(
      (
        await createScheduledShiftDal("user_1", shiftEnd, shiftStart)
      )._unsafeUnwrapErr(),
    ).toEqual({ reason: "Shift must end after it starts" });
  });

  it("rejects a note that is too long", async () => {
    mocks.protect.mockResolvedValue(admin);
    expect(
      (
        await createScheduledShiftDal(
          "user_1",
          shiftStart,
          shiftEnd,
          "x".repeat(501),
        )
      )._unsafeUnwrapErr(),
    ).toEqual({ reason: "Note is too long" });
  });

  it("rejects someone who is not a member of the org", async () => {
    mocks.protect.mockResolvedValue(admin);
    expect(
      (
        await createScheduledShiftDal("stranger", shiftStart, shiftEnd)
      )._unsafeUnwrapErr(),
    ).toEqual({ reason: "Member not found" });
    expect(mocks.dbCreateScheduledShift).not.toHaveBeenCalled();
  });

  it("publishes the shift with a trimmed note", async () => {
    mocks.protect.mockResolvedValue(admin);
    mocks.dbCreateScheduledShift.mockResolvedValue(shift);
    expect(
      (
        await createScheduledShiftDal(
          "user_1",
          shiftStart,
          shiftEnd,
          "  Front desk ",
        )
      )._unsafeUnwrap(),
    ).toEqual(shift);
    expect(mocks.dbCreateScheduledShift).toHaveBeenCalledWith(
      "org_1",
      "user_1",
      shiftStart,
      shiftEnd,
      "Front desk",
      "admin_1",
    );
  });

  it("stores a blank or missing note as null", async () => {
    mocks.protect.mockResolvedValue(admin);
    mocks.dbCreateScheduledShift.mockResolvedValue(shift);
    await createScheduledShiftDal("user_1", shiftStart, shiftEnd, "   ");
    await createScheduledShiftDal("user_1", shiftStart, shiftEnd);
    expect(mocks.dbCreateScheduledShift.mock.calls[0][4]).toBeNull();
    expect(mocks.dbCreateScheduledShift.mock.calls[1][4]).toBeNull();
  });

  it("rejects a shift on the member's approved time off", async () => {
    mocks.protect.mockResolvedValue(admin);
    mocks.dbGetApprovedTimeOffForPeriod.mockResolvedValue([
      {
        id: 3,
        status: "approved",
        start_date: "2026-01-04",
        end_date: "2026-01-06",
      },
    ]);
    expect(
      (
        await createScheduledShiftDal("user_1", shiftStart, shiftEnd)
      )._unsafeUnwrapErr(),
    ).toEqual({
      reason: "This member has approved time off on Jan 4 – Jan 6, 2026",
    });
    expect(mocks.dbGetApprovedTimeOffForPeriod).toHaveBeenCalledWith(
      "user_1",
      "org_1",
      "2026-01-05",
      "2026-01-05",
    );
    expect(mocks.dbCreateScheduledShift).not.toHaveBeenCalled();
  });

  it("checks time off on the scheduler's local days", async () => {
    mocks.protect.mockResolvedValue(admin);
    mocks.dbCreateScheduledShift.mockResolvedValue(shift);
    // 6pm–2am in UTC-7 is 01:00–09:00 UTC the next day.
    await createScheduledShiftDal(
      "user_1",
      new Date("2026-01-06T01:00:00Z"),
      new Date("2026-01-06T09:00:00Z"),
      null,
      { start: "2026-01-05", end: "2026-01-06" },
    );
    expect(mocks.dbGetApprovedTimeOffForPeriod).toHaveBeenCalledWith(
      "user_1",
      "org_1",
      "2026-01-05",
      "2026-01-06",
    );
  });

  it("reports a failed time off check", async () => {
    mocks.protect.mockResolvedValue(admin);
    mocks.dbGetApprovedTimeOffForPeriod.mockRejectedValue(new Error("db"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      (
        await createScheduledShiftDal("user_1", shiftStart, shiftEnd)
      )._unsafeUnwrapErr(),
    ).toEqual({ reason: "Failed to create shift" });
    expect(mocks.dbCreateScheduledShift).not.toHaveBeenCalled();
  });

  it("reports a failed insert", async () => {
    mocks.protect.mockResolvedValue(admin);
    mocks.dbCreateScheduledShift.mockRejectedValue(new Error("db"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      (
        await createScheduledShiftDal("user_1", shiftStart, shiftEnd)
      )._unsafeUnwrapErr(),
    ).toEqual({ reason: "Failed to create shift" });
  });
});

describe("deleteScheduledShiftDal", () => {
  it.each([
    ["no user", noUser],
    ["no org", noOrg],
    ["a non-admin", member],
  ])("rejects %s", async (_label, session) => {
    mocks.protect.mockResolvedValue(session);
    expect((await deleteScheduledShiftDal(1))._unsafeUnwrapErr()).toEqual({
      reason: "Unauthorized",
    });
    expect(mocks.dbDeleteScheduledShift).not.toHaveBeenCalled();
  });

  it("deletes the shift within the org", async () => {
    mocks.protect.mockResolvedValue(admin);
    mocks.dbDeleteScheduledShift.mockResolvedValue(shift);
    expect((await deleteScheduledShiftDal(1))._unsafeUnwrap()).toEqual(shift);
    expect(mocks.dbDeleteScheduledShift).toHaveBeenCalledWith(1, "org_1");
  });

  it("reports a shift that is not in this org", async () => {
    mocks.protect.mockResolvedValue(admin);
    mocks.dbDeleteScheduledShift.mockResolvedValue(undefined);
    expect((await deleteScheduledShiftDal(1))._unsafeUnwrapErr()).toEqual({
      reason: "Shift not found",
    });
  });

  it("reports a failed delete", async () => {
    mocks.protect.mockResolvedValue(admin);
    mocks.dbDeleteScheduledShift.mockRejectedValue(new Error("db"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await deleteScheduledShiftDal(1))._unsafeUnwrapErr()).toEqual({
      reason: "Failed to delete shift",
    });
  });
});
