import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  protect: vi.fn(),
  getOrganizationMembershipList: vi.fn(),
  dbCheckActiveEntry: vi.fn(),
  dbClockIn: vi.fn(),
  dbClockOut: vi.fn(),
  dbDeleteTimeEntry: vi.fn(),
  dbGetActiveEntry: vi.fn(),
  dbGetOrgTimeEntries: vi.fn(),
  dbGetReportingSettings: vi.fn(),
  dbGetTimeEntries: vi.fn(),
  dbUpdateReportingSettings: vi.fn(),
  dbUpdateTimeEntry: vi.fn(),
  getProcessedMembers: vi.fn(),
  isOverMemberShipLimit: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: { protect: mocks.protect },
  clerkClient: vi.fn(async () => ({
    organizations: {
      getOrganizationMembershipList: mocks.getOrganizationMembershipList,
    },
  })),
}));

vi.mock("@/lib/db", () => ({
  dbCheckActiveEntry: mocks.dbCheckActiveEntry,
  dbClockIn: mocks.dbClockIn,
  dbClockOut: mocks.dbClockOut,
  dbDeleteTimeEntry: mocks.dbDeleteTimeEntry,
  dbGetActiveEntry: mocks.dbGetActiveEntry,
  dbGetOrgTimeEntries: mocks.dbGetOrgTimeEntries,
  dbGetReportingSettings: mocks.dbGetReportingSettings,
  dbGetTimeEntries: mocks.dbGetTimeEntries,
  dbUpdateReportingSettings: mocks.dbUpdateReportingSettings,
  dbUpdateTimeEntry: mocks.dbUpdateTimeEntry,
}));

vi.mock("@/lib/utils-clerk", () => ({
  getProcessedMembers: mocks.getProcessedMembers,
  isOverMemberShipLimit: mocks.isOverMemberShipLimit,
}));

import {
  clockIn,
  clockOut,
  deleteTimeEntry,
  getActiveEntry,
  getOrgMembers,
  getOrgReportingSettings,
  getOrgTimeEntries,
  getTimeEntries,
  updateReportingSettingsDal,
  updateTimeEntry,
} from "@/lib/dal";

const member = { userId: "user_1", orgId: "org_1", orgRole: "org:member" };
const admin = { userId: "user_1", orgId: "org_1", orgRole: "org:admin" };
const noUser = { userId: null, orgId: "org_1", orgRole: "org:admin" };
const noOrg = { userId: "user_1", orgId: null, orgRole: "org:admin" };

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("getOrgMembers", () => {
  it("returns no members when there is no active org", async () => {
    mocks.protect.mockResolvedValue(noOrg);
    await expect(getOrgMembers()).resolves.toEqual([]);
  });

  it("returns no members for non-admins", async () => {
    mocks.protect.mockResolvedValue(member);
    await expect(getOrgMembers()).resolves.toEqual([]);
    expect(mocks.getOrganizationMembershipList).not.toHaveBeenCalled();
  });

  it("returns processed members for admins", async () => {
    mocks.protect.mockResolvedValue(admin);
    mocks.getOrganizationMembershipList.mockResolvedValue({ data: ["raw"] });
    mocks.getProcessedMembers.mockReturnValue([{ id: "u", name: "U" }]);

    await expect(getOrgMembers()).resolves.toEqual([{ id: "u", name: "U" }]);
    expect(mocks.getOrganizationMembershipList).toHaveBeenCalledWith({
      organizationId: "org_1",
    });
    expect(mocks.getProcessedMembers).toHaveBeenCalledWith("org_1", ["raw"]);
  });

  it("returns no members when Clerk fails", async () => {
    mocks.protect.mockResolvedValue(admin);
    mocks.getOrganizationMembershipList.mockRejectedValue(new Error("down"));
    await expect(getOrgMembers()).resolves.toEqual([]);
    expect(console.error).toHaveBeenCalled();
  });
});

describe("getTimeEntries", () => {
  it.each([
    ["no user", noUser],
    ["no org", noOrg],
  ])("rejects requests with %s", async (_label, session) => {
    mocks.protect.mockResolvedValue(session);
    await expect(getTimeEntries()).resolves.toEqual({
      ok: false,
      error: { reason: "Unauthorized or no organization selected" },
    });
  });

  it("forbids non-admins from reading another user's entries", async () => {
    mocks.protect.mockResolvedValue(member);
    const result = await getTimeEntries("user_2");
    expect(result.ok).toBe(false);
    expect(mocks.dbGetTimeEntries).not.toHaveBeenCalled();
  });

  it("lets admins read another user's entries", async () => {
    mocks.protect.mockResolvedValue(admin);
    mocks.dbGetTimeEntries.mockResolvedValue([{ id: 1 }]);
    await expect(getTimeEntries("user_2")).resolves.toEqual({
      ok: true,
      value: [{ id: 1 }],
    });
    expect(mocks.dbGetTimeEntries).toHaveBeenCalledWith(
      "user_2",
      "org_1",
      undefined,
      undefined,
    );
  });

  it("defaults to the caller and converts date-only filters in the given timezone", async () => {
    mocks.protect.mockResolvedValue(member);
    mocks.dbGetTimeEntries.mockResolvedValue([]);
    await getTimeEntries(undefined, {
      start: "2026-01-05",
      end: "2026-01-05",
      timezone: "America/Regina",
    });
    const [userId, orgId, start, end] = mocks.dbGetTimeEntries.mock.calls[0];
    expect(userId).toBe("user_1");
    expect(orgId).toBe("org_1");
    expect(start.toISOString()).toBe("2026-01-05T06:00:00.000Z");
    // A date-only end date is pushed to the end of that day.
    expect(end.toISOString()).toBe("2026-01-06T05:59:59.999Z");
  });

  it("uses UTC and keeps explicit end times", async () => {
    mocks.protect.mockResolvedValue(member);
    mocks.dbGetTimeEntries.mockResolvedValue([]);
    await getTimeEntries(undefined, {
      start: "2026-01-05T08:00:00",
      end: "2026-01-05T12:00:00",
    });
    const [, , start, end] = mocks.dbGetTimeEntries.mock.calls[0];
    expect(start.toISOString()).toBe("2026-01-05T08:00:00.000Z");
    expect(end.toISOString()).toBe("2026-01-05T12:00:00.000Z");
  });

  it("returns an error result when the query fails", async () => {
    mocks.protect.mockResolvedValue(member);
    mocks.dbGetTimeEntries.mockRejectedValue(new Error("db"));
    await expect(getTimeEntries()).resolves.toEqual({
      ok: false,
      error: { reason: "Error user fetching entries" },
    });
  });
});

describe("getOrgTimeEntries", () => {
  it.each([
    ["no user", noUser],
    ["no org", noOrg],
    ["a non-admin", member],
  ])("rejects %s", async (_label, session) => {
    mocks.protect.mockResolvedValue(session);
    const result = await getOrgTimeEntries();
    expect(result.ok).toBe(false);
  });

  it("returns org entries for admins with filters applied", async () => {
    mocks.protect.mockResolvedValue(admin);
    mocks.dbGetOrgTimeEntries.mockResolvedValue([{ id: 2 }]);
    await expect(
      getOrgTimeEntries({
        start: "2026-01-01",
        end: "2026-01-31",
        timezone: "UTC",
      }),
    ).resolves.toEqual({ ok: true, value: [{ id: 2 }] });
    const [orgId, start, end] = mocks.dbGetOrgTimeEntries.mock.calls[0];
    expect(orgId).toBe("org_1");
    expect(start.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-01-31T23:59:59.999Z");
  });

  it("returns all org entries when no filters are given", async () => {
    mocks.protect.mockResolvedValue(admin);
    mocks.dbGetOrgTimeEntries.mockResolvedValue([]);
    await getOrgTimeEntries();
    expect(mocks.dbGetOrgTimeEntries).toHaveBeenCalledWith(
      "org_1",
      undefined,
      undefined,
    );
  });

  it("returns an error result when the query fails", async () => {
    mocks.protect.mockResolvedValue(admin);
    mocks.dbGetOrgTimeEntries.mockRejectedValue(new Error("db"));
    await expect(getOrgTimeEntries()).resolves.toEqual({
      ok: false,
      error: { reason: "Error fetching org entries" },
    });
  });
});

describe("clockIn", () => {
  it("rejects requests without a user or org", async () => {
    mocks.protect.mockResolvedValue(noOrg);
    const result = await clockIn();
    expect(result._unsafeUnwrapErr()).toEqual({
      reason: "Unauthorized or no organization selected",
    });
  });

  it("refuses when the org is over its membership limit", async () => {
    mocks.protect.mockResolvedValue(member);
    mocks.isOverMemberShipLimit.mockResolvedValue(true);
    mocks.dbCheckActiveEntry.mockResolvedValue([]);
    const result = await clockIn();
    expect(result._unsafeUnwrapErr()).toEqual({
      reason: "Over organization membership limit.",
    });
    expect(mocks.dbClockIn).not.toHaveBeenCalled();
  });

  it("refuses when the membership limit cannot be checked", async () => {
    mocks.protect.mockResolvedValue(member);
    mocks.isOverMemberShipLimit.mockRejectedValue(new Error("clerk"));
    mocks.dbCheckActiveEntry.mockResolvedValue([]);
    const result = await clockIn();
    expect(result._unsafeUnwrapErr()).toEqual({
      reason: "Unable to verify organization membership limit.",
    });
  });

  it("refuses when the active-entry check fails", async () => {
    mocks.protect.mockResolvedValue(member);
    mocks.isOverMemberShipLimit.mockResolvedValue(false);
    mocks.dbCheckActiveEntry.mockRejectedValue(new Error("db"));
    const result = await clockIn();
    expect(result._unsafeUnwrapErr()).toEqual({
      reason: "Error checking active clock-in entry",
    });
  });

  it("refuses when the user is already clocked in", async () => {
    mocks.protect.mockResolvedValue(member);
    mocks.isOverMemberShipLimit.mockResolvedValue(false);
    mocks.dbCheckActiveEntry.mockResolvedValue([{ id: 1 }]);
    const result = await clockIn();
    expect(result._unsafeUnwrapErr()).toEqual({ reason: "Already clocked in" });
  });

  it("clocks in and returns the new entry", async () => {
    mocks.protect.mockResolvedValue(member);
    mocks.isOverMemberShipLimit.mockResolvedValue(false);
    mocks.dbCheckActiveEntry.mockResolvedValue([]);
    mocks.dbClockIn.mockResolvedValue({ id: 10 });
    const result = await clockIn();
    expect(result._unsafeUnwrap()).toEqual({ id: 10 });
    expect(mocks.dbClockIn).toHaveBeenCalledWith("user_1", "org_1");
  });

  it("returns an error when the insert fails", async () => {
    mocks.protect.mockResolvedValue(member);
    mocks.isOverMemberShipLimit.mockResolvedValue(false);
    mocks.dbCheckActiveEntry.mockResolvedValue([]);
    mocks.dbClockIn.mockRejectedValue(new Error("db"));
    const result = await clockIn();
    expect(result._unsafeUnwrapErr()).toEqual({ reason: "Error clocking in." });
  });
});

describe("clockOut", () => {
  it("rejects requests without a user or org", async () => {
    mocks.protect.mockResolvedValue(noUser);
    expect((await clockOut()).isErr()).toBe(true);
  });

  it("returns the closed entry", async () => {
    mocks.protect.mockResolvedValue(member);
    mocks.dbClockOut.mockResolvedValue({ id: 11 });
    expect((await clockOut())._unsafeUnwrap()).toEqual({ id: 11 });
    expect(mocks.dbClockOut).toHaveBeenCalledWith("user_1", "org_1");
  });

  it("returns an error when the update fails", async () => {
    mocks.protect.mockResolvedValue(member);
    mocks.dbClockOut.mockRejectedValue(new Error("db"));
    expect((await clockOut())._unsafeUnwrapErr()).toEqual({
      reason: "Error clocking out.",
    });
  });
});

describe("deleteTimeEntry", () => {
  it.each([
    ["no user", noUser],
    ["no org", noOrg],
    ["a non-admin", member],
  ])("rejects %s", async (_label, session) => {
    mocks.protect.mockResolvedValue(session);
    expect((await deleteTimeEntry(1))._unsafeUnwrapErr()).toEqual({
      reason: "Unauthorized",
    });
  });

  it("deletes the entry within the admin's org", async () => {
    mocks.protect.mockResolvedValue(admin);
    mocks.dbDeleteTimeEntry.mockResolvedValue({ id: 1 });
    expect((await deleteTimeEntry(1))._unsafeUnwrap()).toEqual({ id: 1 });
    expect(mocks.dbDeleteTimeEntry).toHaveBeenCalledWith(1, "org_1");
  });

  it("returns an error when the delete fails", async () => {
    mocks.protect.mockResolvedValue(admin);
    mocks.dbDeleteTimeEntry.mockRejectedValue(new Error("db"));
    expect((await deleteTimeEntry(1))._unsafeUnwrapErr()).toEqual({
      reason: "Failed to delete entry",
    });
  });
});

describe("updateTimeEntry", () => {
  const clockInAt = new Date("2026-01-05T09:00:00Z");
  const clockOutAt = new Date("2026-01-05T17:00:00Z");

  it("rejects requests without a user or org", async () => {
    mocks.protect.mockResolvedValue(noOrg);
    expect(
      (await updateTimeEntry(1, clockInAt, clockOutAt))._unsafeUnwrapErr(),
    ).toEqual({ reason: "Unauthorized" });
  });

  it("passes the admin flag through to the query", async () => {
    mocks.protect.mockResolvedValue(admin);
    mocks.dbUpdateTimeEntry.mockResolvedValue({ id: 1 });
    expect(
      (await updateTimeEntry(1, clockInAt, clockOutAt))._unsafeUnwrap(),
    ).toEqual({ id: 1 });
    expect(mocks.dbUpdateTimeEntry).toHaveBeenCalledWith(
      1,
      clockInAt,
      clockOutAt,
      "org_1",
      true,
    );
  });

  it("marks non-admin updates so the query can refuse them", async () => {
    mocks.protect.mockResolvedValue(member);
    mocks.dbUpdateTimeEntry.mockResolvedValue(undefined);
    await updateTimeEntry(1, clockInAt, null);
    expect(mocks.dbUpdateTimeEntry).toHaveBeenCalledWith(
      1,
      clockInAt,
      null,
      "org_1",
      false,
    );
  });

  it("returns an error when the update fails", async () => {
    mocks.protect.mockResolvedValue(admin);
    mocks.dbUpdateTimeEntry.mockRejectedValue(new Error("db"));
    expect(
      (await updateTimeEntry(1, clockInAt, null))._unsafeUnwrapErr(),
    ).toEqual({ reason: "Failed to update entry" });
  });
});

describe("getActiveEntry", () => {
  it("rejects requests without a user or org", async () => {
    mocks.protect.mockResolvedValue(noUser);
    expect((await getActiveEntry()).ok).toBe(false);
  });

  it("returns the active entry", async () => {
    mocks.protect.mockResolvedValue(member);
    mocks.dbGetActiveEntry.mockResolvedValue({ id: 3 });
    await expect(getActiveEntry()).resolves.toEqual({
      ok: true,
      value: { id: 3 },
    });
  });

  it("returns null when there is no active entry", async () => {
    mocks.protect.mockResolvedValue(member);
    mocks.dbGetActiveEntry.mockResolvedValue(undefined);
    await expect(getActiveEntry()).resolves.toEqual({ ok: true, value: null });
  });

  it("returns an error result when the query fails", async () => {
    mocks.protect.mockResolvedValue(member);
    mocks.dbGetActiveEntry.mockRejectedValue(new Error("db"));
    await expect(getActiveEntry()).resolves.toEqual({
      ok: false,
      error: { reason: "Error fetching active entries" },
    });
  });
});

describe("updateReportingSettingsDal", () => {
  const withFeature = (session: object, hasFeature: boolean) => ({
    ...session,
    has: vi.fn(() => hasFeature),
  });

  it.each([
    ["no user", withFeature(noUser, true)],
    ["no org", withFeature(noOrg, true)],
    ["a non-admin", withFeature(member, true)],
    ["an org without the reporting feature", withFeature(admin, false)],
  ])("rejects %s", async (_label, session) => {
    mocks.protect.mockResolvedValue(session);
    expect(
      (await updateReportingSettingsDal("weekly"))._unsafeUnwrapErr(),
    ).toEqual({ reason: "Unauthorized" });
    expect(mocks.dbUpdateReportingSettings).not.toHaveBeenCalled();
  });

  it("saves with default day and interval", async () => {
    const session = withFeature(admin, true);
    mocks.protect.mockResolvedValue(session);
    mocks.dbUpdateReportingSettings.mockResolvedValue({ org_id: "org_1" });
    expect(
      (await updateReportingSettingsDal("weekly"))._unsafeUnwrap(),
    ).toEqual({ org_id: "org_1" });
    expect(session.has).toHaveBeenCalledWith({ feature: "reporting" });
    expect(mocks.dbUpdateReportingSettings).toHaveBeenCalledWith(
      "org_1",
      "weekly",
      null,
      1,
    );
  });

  it("saves a custom day and interval", async () => {
    mocks.protect.mockResolvedValue(withFeature(admin, true));
    mocks.dbUpdateReportingSettings.mockResolvedValue({ org_id: "org_1" });
    await updateReportingSettingsDal("custom", "Friday", 2);
    expect(mocks.dbUpdateReportingSettings).toHaveBeenCalledWith(
      "org_1",
      "custom",
      "Friday",
      2,
    );
  });

  it("returns an error when the save fails", async () => {
    mocks.protect.mockResolvedValue(withFeature(admin, true));
    mocks.dbUpdateReportingSettings.mockRejectedValue(new Error("db"));
    expect(
      (await updateReportingSettingsDal("weekly"))._unsafeUnwrapErr(),
    ).toEqual({ reason: "Failed to update settings" });
  });
});

describe("getOrgReportingSettings", () => {
  it("rejects requests without a user or org", async () => {
    mocks.protect.mockResolvedValue(noOrg);
    expect((await getOrgReportingSettings()).ok).toBe(false);
  });

  it("returns the stored settings", async () => {
    mocks.protect.mockResolvedValue(member);
    mocks.dbGetReportingSettings.mockResolvedValue({ org_id: "org_1" });
    await expect(getOrgReportingSettings()).resolves.toEqual({
      ok: true,
      value: { org_id: "org_1" },
    });
  });

  it("returns null when nothing is stored", async () => {
    mocks.protect.mockResolvedValue(member);
    mocks.dbGetReportingSettings.mockResolvedValue(undefined);
    await expect(getOrgReportingSettings()).resolves.toEqual({
      ok: true,
      value: null,
    });
  });

  it("returns an error result when the query fails", async () => {
    mocks.protect.mockResolvedValue(member);
    mocks.dbGetReportingSettings.mockRejectedValue(new Error("db"));
    await expect(getOrgReportingSettings()).resolves.toEqual({
      ok: false,
      error: { reason: "Error fetching settings." },
    });
  });
});
