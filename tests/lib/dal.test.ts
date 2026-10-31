import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  protect: vi.fn(),
  getOrganizationMembershipList: vi.fn(),
  dbCheckActiveEntry: vi.fn(),
  dbClockIn: vi.fn(),
  dbClockOut: vi.fn(),
  dbDeleteBreak: vi.fn(),
  dbCreateSite: vi.fn(),
  dbDeleteSite: vi.fn(),
  dbDeleteTimeEntry: vi.fn(),
  dbEndOpenBreak: vi.fn(),
  dbGetActiveEntry: vi.fn(),
  dbGetBreakSettings: vi.fn(),
  dbGetBreaksForEntriesInOrg: vi.fn(),
  dbGetBreakWithEntry: vi.fn(),
  dbGetEntryBreaks: vi.fn(),
  dbGetLocationSettings: vi.fn(),
  dbGetOrgTimeEntries: vi.fn(),
  dbGetReportingSettings: vi.fn(),
  dbGetSites: vi.fn(),
  dbGetSitesForEnforcement: vi.fn(),
  dbGetTimeEntries: vi.fn(),
  dbStartBreak: vi.fn(),
  dbUpdateBreak: vi.fn(),
  dbUpdateBreakSettings: vi.fn(),
  dbUpdateLocationSettings: vi.fn(),
  dbUpdateReportingSettings: vi.fn(),
  dbUpdateSite: vi.fn(),
  dbUpdateTimeEntry: vi.fn(),
  getProcessedMembers: vi.fn(),
  isOverMemberShipLimit: vi.fn(),
  reverseGeocode: vi.fn(),
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
  dbDeleteBreak: mocks.dbDeleteBreak,
  dbCreateSite: mocks.dbCreateSite,
  dbDeleteSite: mocks.dbDeleteSite,
  dbDeleteTimeEntry: mocks.dbDeleteTimeEntry,
  dbEndOpenBreak: mocks.dbEndOpenBreak,
  dbGetActiveEntry: mocks.dbGetActiveEntry,
  dbGetBreakSettings: mocks.dbGetBreakSettings,
  dbGetBreaksForEntriesInOrg: mocks.dbGetBreaksForEntriesInOrg,
  dbGetBreakWithEntry: mocks.dbGetBreakWithEntry,
  dbGetEntryBreaks: mocks.dbGetEntryBreaks,
  dbGetLocationSettings: mocks.dbGetLocationSettings,
  dbGetOrgTimeEntries: mocks.dbGetOrgTimeEntries,
  dbGetReportingSettings: mocks.dbGetReportingSettings,
  dbGetSites: mocks.dbGetSites,
  dbGetSitesForEnforcement: mocks.dbGetSitesForEnforcement,
  dbGetTimeEntries: mocks.dbGetTimeEntries,
  dbStartBreak: mocks.dbStartBreak,
  dbUpdateBreak: mocks.dbUpdateBreak,
  dbUpdateBreakSettings: mocks.dbUpdateBreakSettings,
  dbUpdateLocationSettings: mocks.dbUpdateLocationSettings,
  dbUpdateReportingSettings: mocks.dbUpdateReportingSettings,
  dbUpdateSite: mocks.dbUpdateSite,
  dbUpdateTimeEntry: mocks.dbUpdateTimeEntry,
}));

vi.mock("@/lib/utils-clerk", () => ({
  getProcessedMembers: mocks.getProcessedMembers,
  isOverMemberShipLimit: mocks.isOverMemberShipLimit,
}));

vi.mock("@/lib/geoapify", () => ({
  reverseGeocode: mocks.reverseGeocode,
}));

import {
  clockIn,
  clockOut,
  createSiteDal,
  deleteBreakDal,
  deleteSiteDal,
  deleteTimeEntry,
  endBreak,
  getActiveEntry,
  getBreaksForEntries,
  getOrgBreakSettings,
  getOrgLocationSettings,
  getOrgMembers,
  getOrgReportingSettings,
  getOrgSites,
  getOrgTimeEntries,
  getTimeEntries,
  startBreak,
  updateBreakDal,
  updateBreakSettingsDal,
  updateLocationSettingsDal,
  updateReportingSettingsDal,
  updateSiteDal,
  updateTimeEntry,
} from "@/lib/dal";

const noFeature = () => false;
const member = {
  userId: "user_1",
  orgId: "org_1",
  orgRole: "org:member",
  has: noFeature,
};
const admin = {
  userId: "user_1",
  orgId: "org_1",
  orgRole: "org:admin",
  has: noFeature,
};
const noUser = {
  userId: null,
  orgId: "org_1",
  orgRole: "org:admin",
  has: noFeature,
};
const noOrg = {
  userId: "user_1",
  orgId: null,
  orgRole: "org:admin",
  has: noFeature,
};

/** A session whose plan includes the given feature slugs. */
const withFeatures = (session: object, ...slugs: string[]) => ({
  ...session,
  has: vi.fn(({ feature }: { feature: string }) => slugs.includes(feature)),
});

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.reverseGeocode.mockResolvedValue(null);
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
      limit: 100,
      offset: 0,
    });
    expect(mocks.getProcessedMembers).toHaveBeenCalledWith("org_1", ["raw"]);
  });

  it("collects members past the first Clerk page", async () => {
    const members = Array.from({ length: 101 }, (_, i) => `member_${i + 1}`);
    mocks.protect.mockResolvedValue(admin);
    mocks.getOrganizationMembershipList.mockImplementation(
      async ({ limit, offset }: { limit: number; offset: number }) => ({
        data: members.slice(offset, offset + limit),
        totalCount: members.length,
      }),
    );
    mocks.getProcessedMembers.mockReturnValue([]);

    await getOrgMembers();

    expect(mocks.getOrganizationMembershipList).toHaveBeenCalledTimes(2);
    expect(mocks.getProcessedMembers).toHaveBeenCalledWith("org_1", members);
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
    expect(mocks.dbClockIn).toHaveBeenCalledWith("user_1", "org_1", null);
  });

  it("refuses when a concurrent clock-in won the race", async () => {
    mocks.protect.mockResolvedValue(member);
    mocks.isOverMemberShipLimit.mockResolvedValue(false);
    mocks.dbCheckActiveEntry.mockResolvedValue([]);
    mocks.dbClockIn.mockResolvedValue(undefined);
    const result = await clockIn();
    expect(result._unsafeUnwrapErr()).toEqual({ reason: "Already clocked in" });
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
    expect(mocks.dbClockOut).toHaveBeenCalledWith("user_1", "org_1", null);
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

  it("returns an error instead of success when no row was updated", async () => {
    mocks.protect.mockResolvedValue(member);
    mocks.dbUpdateTimeEntry.mockResolvedValue(undefined);
    expect(
      (await updateTimeEntry(1, clockInAt, clockOutAt))._unsafeUnwrapErr(),
    ).toEqual({ reason: "Time entry not found" });
  });

  it.each([
    ["clock-in", new Date("not a date"), clockOutAt],
    ["clock-out", clockInAt, new Date("not a date")],
  ])("rejects an invalid %s time", async (_label, inAt, outAt) => {
    mocks.protect.mockResolvedValue(admin);
    expect((await updateTimeEntry(1, inAt, outAt))._unsafeUnwrapErr()).toEqual({
      reason: "Invalid clock-in or clock-out time",
    });
    expect(mocks.dbUpdateTimeEntry).not.toHaveBeenCalled();
  });

  it.each([
    ["before", new Date("2026-01-05T08:00:00Z")],
    ["equal to", clockInAt],
  ])("rejects a clock-out %s the clock-in", async (_label, outAt) => {
    mocks.protect.mockResolvedValue(admin);
    expect(
      (await updateTimeEntry(1, clockInAt, outAt))._unsafeUnwrapErr(),
    ).toEqual({ reason: "Clock out must be after clock in" });
    expect(mocks.dbUpdateTimeEntry).not.toHaveBeenCalled();
  });

  it("passes skip_lunch through to dbUpdateTimeEntry when provided", async () => {
    mocks.protect.mockResolvedValue(admin);
    mocks.dbUpdateTimeEntry.mockResolvedValue({ id: 1, skip_lunch: true });
    expect(
      (await updateTimeEntry(1, clockInAt, clockOutAt, true))._unsafeUnwrap(),
    ).toEqual({ id: 1, skip_lunch: true });
    expect(mocks.dbUpdateTimeEntry).toHaveBeenCalledWith(
      1,
      clockInAt,
      clockOutAt,
      "org_1",
      true,
      true,
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

describe("updateBreakSettingsDal", () => {
  it.each([
    ["no user", noUser],
    ["no org", noOrg],
    ["a non-admin", member],
  ])("rejects %s", async (_label, session) => {
    mocks.protect.mockResolvedValue(session);
    expect((await updateBreakSettingsDal(true))._unsafeUnwrapErr()).toEqual({
      reason: "Unauthorized",
    });
    expect(mocks.dbUpdateBreakSettings).not.toHaveBeenCalled();
  });

  it.each([
    ["negative duration", -1, 5],
    ["excessive duration", 500, 5],
    ["negative min shift hours", 30, -1],
    ["excessive min shift hours", 30, 25],
    ["NaN duration", Number.NaN, 5],
  ])("rejects %s", async (_label, duration, minHours) => {
    mocks.protect.mockResolvedValue(admin);
    expect(
      (
        await updateBreakSettingsDal(true, duration, minHours)
      )._unsafeUnwrapErr(),
    ).toEqual({ reason: "Invalid break settings" });
    expect(mocks.dbUpdateBreakSettings).not.toHaveBeenCalled();
  });

  it("saves with default duration and min shift hours", async () => {
    mocks.protect.mockResolvedValue(admin);
    mocks.dbUpdateBreakSettings.mockResolvedValue({ org_id: "org_1" });
    expect((await updateBreakSettingsDal(true))._unsafeUnwrap()).toEqual({
      org_id: "org_1",
    });
    expect(mocks.dbUpdateBreakSettings).toHaveBeenCalledWith(
      "org_1",
      true,
      30,
      5,
    );
  });

  it("lets admins on the free plan save lunch breaks (no paywall)", async () => {
    const has = vi.fn(() => false);
    mocks.protect.mockResolvedValue({ ...admin, has });
    mocks.dbUpdateBreakSettings.mockResolvedValue({ org_id: "org_1" });
    expect((await updateBreakSettingsDal(true, 30, 5)).isOk()).toBe(true);
    expect(mocks.dbUpdateBreakSettings).toHaveBeenCalledWith(
      "org_1",
      true,
      30,
      5,
    );
    expect(has).not.toHaveBeenCalled();
  });

  it("saves custom duration and min shift hours", async () => {
    mocks.protect.mockResolvedValue(admin);
    mocks.dbUpdateBreakSettings.mockResolvedValue({ org_id: "org_1" });
    await updateBreakSettingsDal(true, 45, 6);
    expect(mocks.dbUpdateBreakSettings).toHaveBeenCalledWith(
      "org_1",
      true,
      45,
      6,
    );
  });

  it("returns an error when the save fails", async () => {
    mocks.protect.mockResolvedValue(admin);
    mocks.dbUpdateBreakSettings.mockRejectedValue(new Error("db"));
    expect((await updateBreakSettingsDal(true))._unsafeUnwrapErr()).toEqual({
      reason: "Failed to update break settings",
    });
  });
});

describe("getOrgBreakSettings", () => {
  it("rejects requests without a user or org", async () => {
    mocks.protect.mockResolvedValue(noOrg);
    expect((await getOrgBreakSettings()).ok).toBe(false);
  });

  it("returns the stored break settings", async () => {
    mocks.protect.mockResolvedValue(member);
    mocks.dbGetBreakSettings.mockResolvedValue({
      org_id: "org_1",
      dock_lunch: true,
    });
    await expect(getOrgBreakSettings()).resolves.toEqual({
      ok: true,
      value: { org_id: "org_1", dock_lunch: true },
    });
  });

  it("returns null when nothing is stored", async () => {
    mocks.protect.mockResolvedValue(member);
    mocks.dbGetBreakSettings.mockResolvedValue(undefined);
    await expect(getOrgBreakSettings()).resolves.toEqual({
      ok: true,
      value: null,
    });
  });

  it("returns an error result when the query fails", async () => {
    mocks.protect.mockResolvedValue(member);
    mocks.dbGetBreakSettings.mockRejectedValue(new Error("db"));
    await expect(getOrgBreakSettings()).resolves.toEqual({
      ok: false,
      error: { reason: "Error fetching break settings." },
    });
  });
});

describe("startBreak", () => {
  it("rejects requests without a user or org", async () => {
    mocks.protect.mockResolvedValue(noOrg);
    const result = await startBreak();
    expect(result._unsafeUnwrapErr()).toEqual({
      reason: "Unauthorized or no organization selected",
    });
  });

  it("rejects an unknown break type", async () => {
    mocks.protect.mockResolvedValue(member);
    const result = await startBreak("siesta" as never);
    expect(result._unsafeUnwrapErr()).toEqual({ reason: "Unknown break type" });
    expect(mocks.dbStartBreak).not.toHaveBeenCalled();
  });

  it("refuses when the active-entry lookup fails", async () => {
    mocks.protect.mockResolvedValue(member);
    mocks.dbGetActiveEntry.mockRejectedValue(new Error("db"));
    const result = await startBreak();
    expect(result._unsafeUnwrapErr()).toEqual({
      reason: "Error checking active clock-in entry",
    });
  });

  it("refuses when the member is not clocked in", async () => {
    mocks.protect.mockResolvedValue(member);
    mocks.dbGetActiveEntry.mockResolvedValue(null);
    const result = await startBreak();
    expect(result._unsafeUnwrapErr()).toEqual({ reason: "Not clocked in" });
    expect(mocks.dbStartBreak).not.toHaveBeenCalled();
  });

  it("refuses a second break while one is running", async () => {
    mocks.protect.mockResolvedValue(member);
    mocks.dbGetActiveEntry.mockResolvedValue({
      id: 1,
      breaks: [{ id: 2, break_end: null }],
    });
    const result = await startBreak("unpaid_rest");
    expect(result._unsafeUnwrapErr()).toEqual({
      reason: "A break is already running",
    });
    expect(mocks.dbStartBreak).not.toHaveBeenCalled();
  });

  it("starts the break and returns it with its owner", async () => {
    mocks.protect.mockResolvedValue(member);
    mocks.dbGetActiveEntry.mockResolvedValue({ id: 1, breaks: [] });
    mocks.dbStartBreak.mockResolvedValue({ id: 9, time_entry_id: 1 });
    const result = await startBreak("paid_rest");
    expect(result._unsafeUnwrap()).toEqual({
      id: 9,
      time_entry_id: 1,
      user_id: "user_1",
      org_id: "org_1",
    });
    expect(mocks.dbStartBreak).toHaveBeenCalledWith(
      "user_1",
      "org_1",
      "paid_rest",
    );
  });

  it("refuses when a concurrent request opened a break first", async () => {
    mocks.protect.mockResolvedValue(member);
    mocks.dbGetActiveEntry.mockResolvedValue({ id: 1 });
    mocks.dbStartBreak.mockResolvedValue(undefined);
    const result = await startBreak();
    expect(result._unsafeUnwrapErr()).toEqual({
      reason: "A break is already running",
    });
  });

  it("reports a failed insert", async () => {
    mocks.protect.mockResolvedValue(member);
    mocks.dbGetActiveEntry.mockResolvedValue({ id: 1, breaks: [] });
    mocks.dbStartBreak.mockRejectedValue(new Error("db"));
    const result = await startBreak();
    expect(result._unsafeUnwrapErr()).toEqual({
      reason: "Error starting break.",
    });
  });
});

describe("endBreak", () => {
  it("rejects requests without a user or org", async () => {
    mocks.protect.mockResolvedValue(noUser);
    const result = await endBreak();
    expect(result._unsafeUnwrapErr()).toEqual({
      reason: "Unauthorized or no organization selected",
    });
  });

  it("closes the running break", async () => {
    mocks.protect.mockResolvedValue(member);
    mocks.dbEndOpenBreak.mockResolvedValue({ id: 9 });
    const result = await endBreak();
    expect(result._unsafeUnwrap()).toEqual({
      id: 9,
      user_id: "user_1",
      org_id: "org_1",
    });
    expect(mocks.dbEndOpenBreak).toHaveBeenCalledWith("user_1", "org_1");
  });

  it("refuses when no break is running", async () => {
    mocks.protect.mockResolvedValue(member);
    mocks.dbEndOpenBreak.mockResolvedValue(undefined);
    const result = await endBreak();
    expect(result._unsafeUnwrapErr()).toEqual({
      reason: "No break is running",
    });
  });

  it("reports a failed update", async () => {
    mocks.protect.mockResolvedValue(member);
    mocks.dbEndOpenBreak.mockRejectedValue(new Error("db"));
    const result = await endBreak();
    expect(result._unsafeUnwrapErr()).toEqual({
      reason: "Error ending break.",
    });
  });
});

describe("getBreaksForEntries", () => {
  it("rejects requests without a user or org", async () => {
    mocks.protect.mockResolvedValue(noOrg);
    await expect(getBreaksForEntries([1])).resolves.toEqual({
      ok: false,
      error: { reason: "Unauthorized or no organization selected" },
    });
  });

  it("lists the breaks for the caller's own entries", async () => {
    mocks.protect.mockResolvedValue(member);
    mocks.dbGetBreaksForEntriesInOrg.mockResolvedValue([{ id: 1 }]);
    await expect(getBreaksForEntries([1, Number.NaN, 2])).resolves.toEqual({
      ok: true,
      value: [{ id: 1 }],
    });
    expect(mocks.dbGetBreaksForEntriesInOrg).toHaveBeenCalledWith(
      [1, 2],
      "org_1",
      "user_1",
      false,
    );
  });

  it("lets admins list every member's breaks", async () => {
    mocks.protect.mockResolvedValue(admin);
    mocks.dbGetBreaksForEntriesInOrg.mockResolvedValue([]);
    await getBreaksForEntries([3]);
    expect(mocks.dbGetBreaksForEntriesInOrg).toHaveBeenCalledWith(
      [3],
      "org_1",
      "user_1",
      true,
    );
  });

  it("reports a failed query", async () => {
    mocks.protect.mockResolvedValue(member);
    mocks.dbGetBreaksForEntriesInOrg.mockRejectedValue(new Error("db"));
    await expect(getBreaksForEntries([1])).resolves.toEqual({
      ok: false,
      error: { reason: "Error fetching breaks" },
    });
  });
});
describe("clockIn location enforcement", () => {
  const coordinates = { latitude: 45.4215, longitude: -75.6972, accuracy: 8 };
  const depot = {
    id: 1,
    org_id: "org_1",
    name: "Depot",
    latitude: 45.4215,
    longitude: -75.6972,
    radius_meters: 150,
  };
  const restricted = {
    org_id: "org_1",
    capture_mode: "required",
    restrict_clock_in: true,
  };

  /**
   * A member who is cleared to clock in and whose org pays for geofencing, so
   * only the location decision is in play.
   */
  function readyToClockIn(...slugs: string[]) {
    mocks.protect.mockResolvedValue(withFeatures(member, ...slugs));
    mocks.isOverMemberShipLimit.mockResolvedValue(false);
    mocks.dbCheckActiveEntry.mockResolvedValue([]);
    mocks.dbClockIn.mockResolvedValue({ id: 20 });
  }

  it("stores no coordinates and reads no sites when capture is off", async () => {
    readyToClockIn("geofencing");
    mocks.dbGetLocationSettings.mockResolvedValue({
      org_id: "org_1",
      capture_mode: "off",
      restrict_clock_in: false,
    });

    expect((await clockIn(coordinates))._unsafeUnwrap()).toEqual({ id: 20 });
    expect(mocks.dbGetSitesForEnforcement).not.toHaveBeenCalled();
    expect(mocks.dbClockIn).toHaveBeenCalledWith("user_1", "org_1", null);
  });

  it("stores no coordinates for an org that never configured location", async () => {
    readyToClockIn("geofencing");
    mocks.dbGetLocationSettings.mockResolvedValue(undefined);

    expect((await clockIn(coordinates)).isOk()).toBe(true);
    expect(mocks.dbClockIn).toHaveBeenCalledWith("user_1", "org_1", null);
  });

  it("ignores a configured geofence for an org without the paid feature", async () => {
    // The restriction rows are still in the database, but the plan no longer
    // includes geofencing: clocking in must work exactly as it did before.
    readyToClockIn();
    mocks.dbGetLocationSettings.mockResolvedValue(restricted);
    mocks.dbGetSitesForEnforcement.mockResolvedValue([depot]);

    expect(
      (await clockIn({ latitude: 43.6532, longitude: -79.3832 })).isOk(),
    ).toBe(true);
    expect(mocks.dbGetLocationSettings).not.toHaveBeenCalled();
    expect(mocks.dbGetSitesForEnforcement).not.toHaveBeenCalled();
    expect(mocks.dbClockIn).toHaveBeenCalledWith("user_1", "org_1", null);
  });

  it("lets a member with no coordinates clock in without the paid feature", async () => {
    readyToClockIn();
    mocks.dbGetLocationSettings.mockResolvedValue(restricted);

    expect((await clockIn()).isOk()).toBe(true);
    expect(mocks.dbClockIn).toHaveBeenCalledWith("user_1", "org_1", null);
  });

  it("stores the coordinates and matched site when capture is optional", async () => {
    readyToClockIn("geofencing");
    mocks.dbGetLocationSettings.mockResolvedValue({
      org_id: "org_1",
      capture_mode: "optional",
      restrict_clock_in: false,
    });
    mocks.dbGetSitesForEnforcement.mockResolvedValue([depot]);

    expect((await clockIn(coordinates)).isOk()).toBe(true);
    expect(mocks.dbClockIn).toHaveBeenCalledWith("user_1", "org_1", {
      latitude: 45.4215,
      longitude: -75.6972,
      accuracy: 8,
      siteName: "Depot",
      address: null,
    });
  });

  it("falls back to the matched site's configured address when reverse geocode is null", async () => {
    readyToClockIn("geofencing");
    mocks.dbGetLocationSettings.mockResolvedValue({
      org_id: "org_1",
      capture_mode: "optional",
      restrict_clock_in: false,
    });
    mocks.reverseGeocode.mockResolvedValueOnce(null);
    mocks.dbGetSitesForEnforcement.mockResolvedValue([
      { ...depot, address: "111 Albert St, Ottawa, ON" },
    ]);

    expect((await clockIn(coordinates)).isOk()).toBe(true);
    expect(mocks.dbClockIn).toHaveBeenCalledWith("user_1", "org_1", {
      latitude: 45.4215,
      longitude: -75.6972,
      accuracy: 8,
      siteName: "Depot",
      address: "111 Albert St, Ottawa, ON",
    });
  });

  it("handles reverseGeocode throwing gracefully", async () => {
    readyToClockIn("geofencing");
    mocks.dbGetLocationSettings.mockResolvedValue({
      org_id: "org_1",
      capture_mode: "optional",
      restrict_clock_in: false,
    });
    mocks.reverseGeocode.mockRejectedValueOnce(new Error("Network failed"));
    mocks.dbGetSitesForEnforcement.mockResolvedValue([depot]);

    expect((await clockIn(coordinates)).isOk()).toBe(true);
    expect(mocks.dbClockIn).toHaveBeenCalledWith("user_1", "org_1", {
      latitude: 45.4215,
      longitude: -75.6972,
      accuracy: 8,
      siteName: "Depot",
      address: null,
    });
  });

  it("uses the reverse-geocoded address when available", async () => {
    readyToClockIn("geofencing");
    mocks.dbGetLocationSettings.mockResolvedValue({
      org_id: "org_1",
      capture_mode: "optional",
      restrict_clock_in: false,
    });
    mocks.reverseGeocode.mockResolvedValueOnce("742 Evergreen Terrace");
    mocks.dbGetSitesForEnforcement.mockResolvedValue([depot]);

    expect((await clockIn(coordinates)).isOk()).toBe(true);
    expect(mocks.dbClockIn).toHaveBeenCalledWith("user_1", "org_1", {
      latitude: 45.4215,
      longitude: -75.6972,
      accuracy: 8,
      siteName: "Depot",
      address: "742 Evergreen Terrace",
    });
  });

  it("clocks in without coordinates when capture is only optional", async () => {
    readyToClockIn("geofencing");
    mocks.dbGetLocationSettings.mockResolvedValue({
      org_id: "org_1",
      capture_mode: "optional",
      restrict_clock_in: false,
    });
    mocks.dbGetSitesForEnforcement.mockResolvedValue([depot]);

    expect((await clockIn()).isOk()).toBe(true);
    expect(mocks.dbClockIn).toHaveBeenCalledWith("user_1", "org_1", null);
  });

  it("refuses a clock-in with no coordinates when capture is required", async () => {
    readyToClockIn("geofencing");
    mocks.dbGetLocationSettings.mockResolvedValue({
      org_id: "org_1",
      capture_mode: "required",
      restrict_clock_in: false,
    });
    mocks.dbGetSitesForEnforcement.mockResolvedValue([]);

    const result = await clockIn();
    expect(result._unsafeUnwrapErr().reason).toContain(
      "requires your location",
    );
    expect(mocks.dbClockIn).not.toHaveBeenCalled();
  });

  it("refuses a clock-in outside every site when clock-in is restricted", async () => {
    readyToClockIn("geofencing");
    mocks.dbGetLocationSettings.mockResolvedValue(restricted);
    mocks.dbGetSitesForEnforcement.mockResolvedValue([depot]);

    const result = await clockIn({ latitude: 43.6532, longitude: -79.3832 });
    expect(result._unsafeUnwrapErr().reason).toContain(
      "not at an approved work site",
    );
    expect(mocks.dbClockIn).not.toHaveBeenCalled();
  });

  it("does not trust a client that sends impossible coordinates", async () => {
    readyToClockIn("geofencing");
    mocks.dbGetLocationSettings.mockResolvedValue(restricted);
    mocks.dbGetSitesForEnforcement.mockResolvedValue([depot]);

    const result = await clockIn({ latitude: 999, longitude: 999 });
    expect(result.isErr()).toBe(true);
    expect(mocks.dbClockIn).not.toHaveBeenCalled();
  });

  it("allows a restricted clock-in inside a site", async () => {
    readyToClockIn("geofencing");
    mocks.dbGetLocationSettings.mockResolvedValue(restricted);
    mocks.dbGetSitesForEnforcement.mockResolvedValue([depot]);

    expect((await clockIn(coordinates)).isOk()).toBe(true);
    expect(mocks.dbClockIn).toHaveBeenCalledWith(
      "user_1",
      "org_1",
      expect.objectContaining({ siteName: "Depot" }),
    );
  });

  it("refuses the punch when the location lookup itself fails", async () => {
    readyToClockIn("geofencing");
    mocks.dbGetLocationSettings.mockRejectedValue(new Error("db"));

    expect((await clockIn(coordinates))._unsafeUnwrapErr()).toEqual({
      reason: "Unable to verify your location.",
    });
    expect(mocks.dbClockIn).not.toHaveBeenCalled();
  });
});

describe("clockOut location capture", () => {
  const coordinates = { latitude: 43.6532, longitude: -79.3832, accuracy: 30 };
  const depot = {
    id: 1,
    org_id: "org_1",
    name: "Depot",
    latitude: 45.4215,
    longitude: -75.6972,
    radius_meters: 150,
  };

  it("records where a clock-out happened without geofencing it", async () => {
    mocks.protect.mockResolvedValue(withFeatures(member, "geofencing"));
    mocks.dbClockOut.mockResolvedValue({ id: 21 });
    mocks.dbGetLocationSettings.mockResolvedValue({
      org_id: "org_1",
      capture_mode: "required",
      restrict_clock_in: true,
    });
    mocks.dbGetSitesForEnforcement.mockResolvedValue([depot]);

    // Miles away from the only site, and it still goes through.
    expect((await clockOut(coordinates))._unsafeUnwrap()).toEqual({ id: 21 });
    expect(mocks.dbClockOut).toHaveBeenCalledWith("user_1", "org_1", {
      latitude: 43.6532,
      longitude: -79.3832,
      accuracy: 30,
      siteName: null,
      address: null,
    });
  });

  it("stores nothing for an org without the paid feature", async () => {
    mocks.protect.mockResolvedValue(member);
    mocks.dbClockOut.mockResolvedValue({ id: 23 });
    mocks.dbGetLocationSettings.mockResolvedValue({
      org_id: "org_1",
      capture_mode: "required",
      restrict_clock_in: true,
    });

    expect((await clockOut(coordinates)).isOk()).toBe(true);
    expect(mocks.dbGetLocationSettings).not.toHaveBeenCalled();
    expect(mocks.dbClockOut).toHaveBeenCalledWith("user_1", "org_1", null);
  });

  it("clocks out anyway when the location lookup fails", async () => {
    mocks.protect.mockResolvedValue(withFeatures(member, "geofencing"));
    mocks.dbClockOut.mockResolvedValue({ id: 22 });
    mocks.dbGetLocationSettings.mockRejectedValue(new Error("db"));

    expect((await clockOut(coordinates)).isOk()).toBe(true);
    expect(mocks.dbClockOut).toHaveBeenCalledWith("user_1", "org_1", null);
  });
});

describe("getOrgLocationSettings", () => {
  it("rejects requests without a user or org", async () => {
    mocks.protect.mockResolvedValue(noOrg);
    expect((await getOrgLocationSettings()).ok).toBe(false);
  });

  it("returns the stored location settings", async () => {
    mocks.protect.mockResolvedValue(member);
    mocks.dbGetLocationSettings.mockResolvedValue({
      org_id: "org_1",
      capture_mode: "optional",
    });
    await expect(getOrgLocationSettings()).resolves.toEqual({
      ok: true,
      value: { org_id: "org_1", capture_mode: "optional" },
    });
  });

  it("returns null when nothing is stored", async () => {
    mocks.protect.mockResolvedValue(member);
    mocks.dbGetLocationSettings.mockResolvedValue(undefined);
    await expect(getOrgLocationSettings()).resolves.toEqual({
      ok: true,
      value: null,
    });
  });

  it("returns an error result when the query fails", async () => {
    mocks.protect.mockResolvedValue(member);
    mocks.dbGetLocationSettings.mockRejectedValue(new Error("db"));
    await expect(getOrgLocationSettings()).resolves.toEqual({
      ok: false,
      error: { reason: "Error fetching location settings." },
    });
  });
});

describe("updateBreakDal", () => {
  const breakStart = new Date("2026-01-05T12:00:00Z");
  const breakEnd = new Date("2026-01-05T12:30:00Z");
  const existing = {
    id: 4,
    time_entry_id: 1,
    break_type: "unpaid_meal",
    break_start: breakStart,
    break_end: breakEnd,
    user_id: "user_2",
    org_id: "org_1",
    clock_in: new Date("2026-01-05T09:00:00Z"),
    clock_out: new Date("2026-01-05T17:00:00Z"),
  };

  it("is admin-only", async () => {
    mocks.protect.mockResolvedValue(member);
    const result = await updateBreakDal(4, breakStart, breakEnd, "unpaid_meal");
    expect(result._unsafeUnwrapErr()).toEqual({ reason: "Unauthorized" });
    expect(mocks.dbUpdateBreak).not.toHaveBeenCalled();
  });

  it("fails when the break does not exist in the org", async () => {
    mocks.protect.mockResolvedValue(admin);
    mocks.dbGetBreakWithEntry.mockResolvedValue(undefined);
    const result = await updateBreakDal(4, breakStart, breakEnd, "unpaid_meal");
    expect(result._unsafeUnwrapErr()).toEqual({ reason: "Break not found" });
  });

  it("fails when the break lookup errors", async () => {
    mocks.protect.mockResolvedValue(admin);
    mocks.dbGetBreakWithEntry.mockRejectedValue(new Error("db"));
    const result = await updateBreakDal(4, breakStart, breakEnd, "unpaid_meal");
    expect(result._unsafeUnwrapErr()).toEqual({ reason: "Break not found" });
  });

  it("fails when the entry's other breaks cannot be read", async () => {
    mocks.protect.mockResolvedValue(admin);
    mocks.dbGetBreakWithEntry.mockResolvedValue(existing);
    mocks.dbGetEntryBreaks.mockRejectedValue(new Error("db"));
    const result = await updateBreakDal(4, breakStart, breakEnd, "unpaid_meal");
    expect(result._unsafeUnwrapErr()).toEqual({
      reason: "Error fetching breaks",
    });
  });

  it("rejects a window outside the shift", async () => {
    mocks.protect.mockResolvedValue(admin);
    mocks.dbGetBreakWithEntry.mockResolvedValue(existing);
    mocks.dbGetEntryBreaks.mockResolvedValue([existing]);
    const result = await updateBreakDal(
      4,
      new Date("2026-01-05T08:00:00Z"),
      new Date("2026-01-05T08:30:00Z"),
      "unpaid_meal",
    );
    expect(result._unsafeUnwrapErr()).toEqual({
      reason: "Break cannot start before the shift's clock-in",
    });
    expect(mocks.dbUpdateBreak).not.toHaveBeenCalled();
  });

  it("rejects an overlap with another break on the entry", async () => {
    mocks.protect.mockResolvedValue(admin);
    mocks.dbGetBreakWithEntry.mockResolvedValue(existing);
    mocks.dbGetEntryBreaks.mockResolvedValue([
      existing,
      {
        id: 5,
        break_type: "unpaid_rest",
        break_start: new Date("2026-01-05T14:00:00Z"),
        break_end: new Date("2026-01-05T14:30:00Z"),
      },
    ]);
    const result = await updateBreakDal(
      4,
      new Date("2026-01-05T14:15:00Z"),
      new Date("2026-01-05T14:45:00Z"),
      "unpaid_meal",
    );
    expect(result._unsafeUnwrapErr()).toEqual({
      reason: "Break overlaps another break on this entry",
    });
  });

  it("updates the break and keeps the shift's owner", async () => {
    mocks.protect.mockResolvedValue(admin);
    mocks.dbGetBreakWithEntry.mockResolvedValue(existing);
    mocks.dbGetEntryBreaks.mockResolvedValue([existing]);
    mocks.dbUpdateBreak.mockResolvedValue({ id: 4, break_type: "paid_rest" });
    const result = await updateBreakDal(4, breakStart, breakEnd, "paid_rest");
    expect(result._unsafeUnwrap()).toEqual({
      id: 4,
      break_type: "paid_rest",
      user_id: "user_2",
      org_id: "org_1",
    });
    expect(mocks.dbUpdateBreak).toHaveBeenCalledWith(
      4,
      "org_1",
      breakStart,
      breakEnd,
      "paid_rest",
    );
  });

  it("fails when no row was updated", async () => {
    mocks.protect.mockResolvedValue(admin);
    mocks.dbGetBreakWithEntry.mockResolvedValue(existing);
    mocks.dbGetEntryBreaks.mockResolvedValue([existing]);
    mocks.dbUpdateBreak.mockResolvedValue(undefined);
    const result = await updateBreakDal(4, breakStart, breakEnd, "unpaid_meal");
    expect(result._unsafeUnwrapErr()).toEqual({ reason: "Break not found" });
  });

  it("reports a failed update", async () => {
    mocks.protect.mockResolvedValue(admin);
    mocks.dbGetBreakWithEntry.mockResolvedValue(existing);
    mocks.dbGetEntryBreaks.mockResolvedValue([existing]);
    mocks.dbUpdateBreak.mockRejectedValue(new Error("db"));
    const result = await updateBreakDal(4, breakStart, breakEnd, "unpaid_meal");
    expect(result._unsafeUnwrapErr()).toEqual({
      reason: "Failed to update break",
    });
  });
});
describe("updateLocationSettingsDal", () => {
  it.each([
    ["no user", withFeatures(noUser, "geofencing")],
    ["no org", withFeatures(noOrg, "geofencing")],
    ["a non-admin", withFeatures(member, "geofencing")],
    ["an org without the geofencing feature", withFeatures(admin)],
  ])("rejects %s", async (_label, session) => {
    mocks.protect.mockResolvedValue(session);
    expect(
      (await updateLocationSettingsDal("optional", false))._unsafeUnwrapErr(),
    ).toEqual({ reason: "Unauthorized" });
    expect(mocks.dbUpdateLocationSettings).not.toHaveBeenCalled();
  });

  it("rejects an unknown capture mode", async () => {
    mocks.protect.mockResolvedValue(withFeatures(admin, "geofencing"));
    expect(
      (await updateLocationSettingsDal("always", false))._unsafeUnwrapErr(),
    ).toEqual({ reason: "Invalid location settings" });
    expect(mocks.dbUpdateLocationSettings).not.toHaveBeenCalled();
  });

  it.each(["off", "optional", "required"])(
    "saves the %s mode",
    async (mode) => {
      const session = withFeatures(admin, "geofencing");
      mocks.protect.mockResolvedValue(session);
      mocks.dbUpdateLocationSettings.mockResolvedValue({ org_id: "org_1" });
      expect((await updateLocationSettingsDal(mode, true)).isOk()).toBe(true);
      expect(session.has).toHaveBeenCalledWith({ feature: "geofencing" });
      expect(mocks.dbUpdateLocationSettings).toHaveBeenCalledWith(
        "org_1",
        mode,
        true,
      );
    },
  );

  it("returns an error when the save fails", async () => {
    mocks.protect.mockResolvedValue(withFeatures(admin, "geofencing"));
    mocks.dbUpdateLocationSettings.mockRejectedValue(new Error("db"));
    expect(
      (await updateLocationSettingsDal("optional", false))._unsafeUnwrapErr(),
    ).toEqual({ reason: "Failed to update location settings" });
  });
});

describe("getOrgSites", () => {
  it("rejects requests without a user or org", async () => {
    mocks.protect.mockResolvedValue(noOrg);
    expect((await getOrgSites()).ok).toBe(false);
  });

  it("returns the org's sites to any member", async () => {
    mocks.protect.mockResolvedValue(member);
    mocks.dbGetSites.mockResolvedValue([{ id: 1, name: "Depot" }]);
    await expect(getOrgSites()).resolves.toEqual({
      ok: true,
      value: [{ id: 1, name: "Depot" }],
    });
  });

  it("returns an error result when the query fails", async () => {
    mocks.protect.mockResolvedValue(member);
    mocks.dbGetSites.mockRejectedValue(new Error("db"));
    await expect(getOrgSites()).resolves.toEqual({
      ok: false,
      error: { reason: "Error fetching sites." },
    });
  });
});

describe.each([
  ["createSiteDal", false],
  ["updateSiteDal", true],
] as const)("%s", (_name, isUpdate) => {
  const call = (
    siteName: string,
    lat: number,
    lon: number,
    radius: number,
    address?: string | null,
  ) =>
    isUpdate
      ? updateSiteDal(7, siteName, lat, lon, radius, address)
      : createSiteDal(siteName, lat, lon, radius, address);
  const dbFn = () => (isUpdate ? mocks.dbUpdateSite : mocks.dbCreateSite);
  const failureReason = isUpdate
    ? "Failed to update site"
    : "Failed to create site";

  it.each([
    ["no user", withFeatures(noUser, "geofencing")],
    ["no org", withFeatures(noOrg, "geofencing")],
    ["a non-admin", withFeatures(member, "geofencing")],
    ["an org without the geofencing feature", withFeatures(admin)],
  ])("rejects %s", async (_label, session) => {
    mocks.protect.mockResolvedValue(session);
    expect((await call("Depot", 45, -75, 150))._unsafeUnwrapErr()).toEqual({
      reason: "Unauthorized",
    });
    expect(dbFn()).not.toHaveBeenCalled();
  });

  it.each([
    ["a blank name", "   ", 45, -75, 150, "Site name is required"],
    [
      "a latitude out of range",
      "Depot",
      91,
      -75,
      150,
      "Invalid site coordinates",
    ],
    [
      "a latitude below the south pole",
      "Depot",
      -91,
      -75,
      150,
      "Invalid site coordinates",
    ],
    [
      "a longitude out of range",
      "Depot",
      45,
      181,
      150,
      "Invalid site coordinates",
    ],
    [
      "a longitude below the antimeridian",
      "Depot",
      45,
      -181,
      150,
      "Invalid site coordinates",
    ],
    [
      "a NaN latitude",
      "Depot",
      Number.NaN,
      -75,
      150,
      "Invalid site coordinates",
    ],
    [
      "a NaN longitude",
      "Depot",
      45,
      Number.NaN,
      150,
      "Invalid site coordinates",
    ],
    ["a negative radius", "Depot", 45, -75, -1, "Invalid site radius"],
    ["an absurd radius", "Depot", 45, -75, 200_000, "Invalid site radius"],
    ["a NaN radius", "Depot", 45, -75, Number.NaN, "Invalid site radius"],
  ])("rejects %s", async (_label, siteName, lat, lon, radius, reason) => {
    mocks.protect.mockResolvedValue(withFeatures(admin, "geofencing"));
    expect((await call(siteName, lat, lon, radius))._unsafeUnwrapErr()).toEqual(
      { reason },
    );
    expect(dbFn()).not.toHaveBeenCalled();
  });

  it("trims the name and saves", async () => {
    mocks.protect.mockResolvedValue(withFeatures(admin, "geofencing"));
    dbFn().mockResolvedValue({ id: 7, org_id: "org_1", name: "Depot" });
    expect((await call("  Depot  ", 45, -75, 150)).isOk()).toBe(true);
    expect(dbFn()).toHaveBeenCalledWith(
      ...(isUpdate
        ? [7, "org_1", "Depot", 45, -75, 150]
        : ["org_1", "Depot", 45, -75, 150]),
    );
  });

  it("saves site with address when provided", async () => {
    mocks.protect.mockResolvedValue(withFeatures(admin, "geofencing"));
    dbFn().mockResolvedValue({
      id: 7,
      org_id: "org_1",
      name: "Depot",
      address: "111 Albert St",
    });
    expect(
      (await call("  Depot  ", 45, -75, 150, "111 Albert St")).isOk(),
    ).toBe(true);
    expect(dbFn()).toHaveBeenCalledWith(
      ...(isUpdate
        ? [7, "org_1", "Depot", 45, -75, 150, "111 Albert St"]
        : ["org_1", "Depot", 45, -75, 150, "111 Albert St"]),
    );
  });

  it("returns an error when the query fails", async () => {
    mocks.protect.mockResolvedValue(withFeatures(admin, "geofencing"));
    dbFn().mockRejectedValue(new Error("db"));
    expect((await call("Depot", 45, -75, 150))._unsafeUnwrapErr()).toEqual({
      reason: failureReason,
    });
  });
});

describe("deleteBreakDal", () => {
  const existing = { id: 4, time_entry_id: 1, user_id: "user_2" };

  it("is admin-only", async () => {
    mocks.protect.mockResolvedValue(member);
    const result = await deleteBreakDal(4);
    expect(result._unsafeUnwrapErr()).toEqual({ reason: "Unauthorized" });
    expect(mocks.dbDeleteBreak).not.toHaveBeenCalled();
  });

  it("fails when the break does not exist in the org", async () => {
    mocks.protect.mockResolvedValue(admin);
    mocks.dbGetBreakWithEntry.mockResolvedValue(undefined);
    const result = await deleteBreakDal(4);
    expect(result._unsafeUnwrapErr()).toEqual({ reason: "Break not found" });
  });

  it("fails when the break lookup errors", async () => {
    mocks.protect.mockResolvedValue(admin);
    mocks.dbGetBreakWithEntry.mockRejectedValue(new Error("db"));
    const result = await deleteBreakDal(4);
    expect(result._unsafeUnwrapErr()).toEqual({ reason: "Break not found" });
  });

  it("deletes the break", async () => {
    mocks.protect.mockResolvedValue(admin);
    mocks.dbGetBreakWithEntry.mockResolvedValue(existing);
    mocks.dbDeleteBreak.mockResolvedValue({ id: 4 });
    const result = await deleteBreakDal(4);
    expect(result._unsafeUnwrap()).toEqual({
      id: 4,
      user_id: "user_2",
      org_id: "org_1",
    });
    expect(mocks.dbDeleteBreak).toHaveBeenCalledWith(4, "org_1");
  });

  it("fails when no row was deleted", async () => {
    mocks.protect.mockResolvedValue(admin);
    mocks.dbGetBreakWithEntry.mockResolvedValue(existing);
    mocks.dbDeleteBreak.mockResolvedValue(undefined);
    const result = await deleteBreakDal(4);
    expect(result._unsafeUnwrapErr()).toEqual({ reason: "Break not found" });
  });

  it("reports a failed delete", async () => {
    mocks.protect.mockResolvedValue(admin);
    mocks.dbGetBreakWithEntry.mockResolvedValue(existing);
    mocks.dbDeleteBreak.mockRejectedValue(new Error("db"));
    const result = await deleteBreakDal(4);
    expect(result._unsafeUnwrapErr()).toEqual({
      reason: "Failed to delete break",
    });
  });
});
describe("updateSiteDal", () => {
  it("reports a site that is not in this org", async () => {
    mocks.protect.mockResolvedValue(withFeatures(admin, "geofencing"));
    mocks.dbUpdateSite.mockResolvedValue(undefined);
    expect(
      (await updateSiteDal(7, "Depot", 45, -75, 150))._unsafeUnwrapErr(),
    ).toEqual({ reason: "Site not found" });
  });
});

describe("deleteSiteDal", () => {
  it.each([
    ["no user", withFeatures(noUser, "geofencing")],
    ["no org", withFeatures(noOrg, "geofencing")],
    ["a non-admin", withFeatures(member, "geofencing")],
    ["an org without the geofencing feature", withFeatures(admin)],
  ])("rejects %s", async (_label, session) => {
    mocks.protect.mockResolvedValue(session);
    expect((await deleteSiteDal(7))._unsafeUnwrapErr()).toEqual({
      reason: "Unauthorized",
    });
    expect(mocks.dbDeleteSite).not.toHaveBeenCalled();
  });

  it("deletes the site within the org", async () => {
    mocks.protect.mockResolvedValue(withFeatures(admin, "geofencing"));
    mocks.dbDeleteSite.mockResolvedValue({ id: 7, org_id: "org_1" });
    expect((await deleteSiteDal(7))._unsafeUnwrap()).toEqual({
      id: 7,
      org_id: "org_1",
    });
    expect(mocks.dbDeleteSite).toHaveBeenCalledWith(7, "org_1");
  });

  it("reports a site that is not in this org", async () => {
    mocks.protect.mockResolvedValue(withFeatures(admin, "geofencing"));
    mocks.dbDeleteSite.mockResolvedValue(undefined);
    expect((await deleteSiteDal(7))._unsafeUnwrapErr()).toEqual({
      reason: "Site not found",
    });
  });

  it("returns an error when the delete fails", async () => {
    mocks.protect.mockResolvedValue(withFeatures(admin, "geofencing"));
    mocks.dbDeleteSite.mockRejectedValue(new Error("db"));
    expect((await deleteSiteDal(7))._unsafeUnwrapErr()).toEqual({
      reason: "Failed to delete site",
    });
  });
});
