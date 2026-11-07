import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getUserOrgMemberships: vi.fn(),
  getOrgMemberships: vi.fn(),
  getBillingSubscription: vi.fn(),
  updateMembership: vi.fn(),
  deleteMembership: vi.fn(),
  revalidateTag: vi.fn(),
  notifyScheduleChange: vi.fn(async () => true),
  dbGetScheduledShifts: vi.fn(async () => [] as unknown[]),
  dbGetScheduledShiftById: vi.fn(),
  dbCreateScheduledShift: vi.fn(),
  dbUpdateScheduledShift: vi.fn(),
  dbDeleteScheduledShift: vi.fn(),
  dbGetApprovedTimeOffForPeriod: vi.fn(async () => [] as unknown[]),
  dbGetOrgTimeEntries: vi.fn(async () => []),
  dbGetTimeEntries: vi.fn(async () => []),
  dbGetTimeOffRequests: vi.fn(async () => [] as unknown[]),
  dbCreateTimeOffRequest: vi.fn(),
  dbGetTimeOffByExternalRef: vi.fn(),
  dbReviewTimeOffRequest: vi.fn(),
  dbCancelTimeOffRequest: vi.fn(),
  dbGetOvertimeSettings: vi.fn(),
  dbUpdateOvertimeSettings: vi.fn(),
  dbGetPayPeriodSettings: vi.fn(),
  dbUpdatePayPeriodSettings: vi.fn(),
  dbGetLocationSettings: vi.fn(),
  dbUpdateLocationSettings: vi.fn(),
  dbGetSites: vi.fn(async () => [] as unknown[]),
  dbCreateSite: vi.fn(),
  dbUpdateSite: vi.fn(),
  dbDeleteSite: vi.fn(),
  dbGetAlertSettings: vi.fn(),
  dbUpdateAlertSettings: vi.fn(),
  searchAddress: vi.fn(async () => [] as unknown[]),
}));

vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: vi.fn(async () => ({
    users: { getOrganizationMembershipList: m.getUserOrgMemberships },
    organizations: {
      getOrganizationMembershipList: m.getOrgMemberships,
      updateOrganizationMembership: m.updateMembership,
      deleteOrganizationMembership: m.deleteMembership,
    },
    billing: { getOrganizationBillingSubscription: m.getBillingSubscription },
  })),
}));
vi.mock("next/cache", () => ({ revalidateTag: m.revalidateTag }));
vi.mock("@/mcp/db", () => ({}));
vi.mock("@/lib/reports", () => ({}));
vi.mock("@/lib/utils-clerk", () => ({}));
vi.mock("@/lib/schedule-notify", () => ({
  notifyScheduleChange: m.notifyScheduleChange,
}));
vi.mock("@/lib/geoapify", () => ({
  reverseGeocode: vi.fn(async () => null),
  searchAddress: m.searchAddress,
}));
vi.mock("@/lib/alerts-db", () => ({
  dbGetAlertSettings: m.dbGetAlertSettings,
  dbUpdateAlertSettings: m.dbUpdateAlertSettings,
}));
vi.mock("@/lib/db", () => ({
  dbGetScheduledShifts: m.dbGetScheduledShifts,
  dbGetScheduledShiftById: m.dbGetScheduledShiftById,
  dbCreateScheduledShift: m.dbCreateScheduledShift,
  dbUpdateScheduledShift: m.dbUpdateScheduledShift,
  dbDeleteScheduledShift: m.dbDeleteScheduledShift,
  dbGetApprovedTimeOffForPeriod: m.dbGetApprovedTimeOffForPeriod,
  dbGetOrgTimeEntries: m.dbGetOrgTimeEntries,
  dbGetTimeEntries: m.dbGetTimeEntries,
  dbGetTimeOffRequests: m.dbGetTimeOffRequests,
  dbCreateTimeOffRequest: m.dbCreateTimeOffRequest,
  dbGetTimeOffByExternalRef: m.dbGetTimeOffByExternalRef,
  dbReviewTimeOffRequest: m.dbReviewTimeOffRequest,
  dbCancelTimeOffRequest: m.dbCancelTimeOffRequest,
  dbGetOvertimeSettings: m.dbGetOvertimeSettings,
  dbUpdateOvertimeSettings: m.dbUpdateOvertimeSettings,
  dbGetPayPeriodSettings: m.dbGetPayPeriodSettings,
  dbUpdatePayPeriodSettings: m.dbUpdatePayPeriodSettings,
  dbGetLocationSettings: m.dbGetLocationSettings,
  dbUpdateLocationSettings: m.dbUpdateLocationSettings,
  dbGetSites: m.dbGetSites,
  dbCreateSite: m.dbCreateSite,
  dbUpdateSite: m.dbUpdateSite,
  dbDeleteSite: m.dbDeleteSite,
}));

import {
  MAX_TIME_OFF_EXTERNAL_REF_LENGTH,
  manageAlertSettingsTool,
  manageLocationSettingsTool,
  manageMemberTool,
  manageOvertimeSettingsTool,
  managePayPeriodSettingsTool,
  manageScheduleTool,
  manageTimeOffTool,
  resolveShiftTimes,
} from "@/mcp/admin-tools";

const admin = { userId: "user_admin", client: "Claude" };
const member = { userId: "user_sam", client: "Claude" };
const TZ = "America/Regina"; // UTC-6, no DST

function asRole(role: "org:admin" | "org:member") {
  m.getUserOrgMemberships.mockResolvedValue({
    data: [{ role, organization: { id: "org_1", name: "Acme", slug: "acme" } }],
  });
}

const shift = {
  id: 7,
  org_id: "org_1",
  user_id: "user_sam",
  shift_start: new Date("2026-11-03T15:00:00Z"),
  shift_end: new Date("2026-11-03T23:00:00Z"),
  note: null,
  created_by: "user_admin",
};

const timeOff = {
  id: 4,
  org_id: "org_1",
  user_id: "user_sam",
  request_type: "vacation" as const,
  start_date: "2026-11-03",
  end_date: "2026-11-04",
  hours_per_day: 8,
  note: null,
  status: "approved" as const,
  reviewed_by: "user_admin",
  reviewed_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  asRole("org:admin");
  m.getOrgMemberships.mockResolvedValue({
    data: [
      {
        role: "org:admin",
        publicUserData: {
          userId: "user_admin",
          firstName: "Pat",
          lastName: "Mac",
          identifier: "pat@example.com",
        },
      },
      {
        role: "org:member",
        publicUserData: {
          userId: "user_sam",
          firstName: "Sam",
          lastName: "Lee",
          identifier: "sam@example.com",
        },
      },
    ],
    totalCount: 2,
  });
  m.dbGetApprovedTimeOffForPeriod.mockResolvedValue([]);
  m.dbGetScheduledShifts.mockResolvedValue([]);
});

describe("resolveShiftTimes", () => {
  it("reads local times on the given day and rolls overnight shifts", () => {
    expect(resolveShiftTimes("2026-11-03", "9:00 AM", "17:00", TZ)).toEqual({
      start: new Date("2026-11-03T15:00:00Z"),
      end: new Date("2026-11-03T23:00:00Z"),
    });
    expect(resolveShiftTimes("2026-11-03", "22:00", "06:00", TZ)).toEqual({
      start: new Date("2026-11-04T04:00:00Z"),
      end: new Date("2026-11-04T12:00:00Z"),
    });
  });
});

describe("manage_schedule", () => {
  beforeEach(() => {
    m.getBillingSubscription.mockResolvedValue({
      subscriptionItems: [{ plan: { features: [{ slug: "scheduling" }] } }],
    });
  });

  it("needs the scheduling plan feature", async () => {
    m.getBillingSubscription.mockResolvedValue({ subscriptionItems: [] });
    const res = await manageScheduleTool(admin, { action: "list" });
    expect(res.isError).toBe(true);
    expect(res.data.status).toBe("scheduling_not_enabled");
    expect(m.getBillingSubscription).toHaveBeenCalledWith("org_1");
  });

  it("lets an admin schedule a shift for a member and notifies them", async () => {
    m.dbCreateScheduledShift.mockResolvedValue(shift);
    const res = await manageScheduleTool(admin, {
      action: "create",
      member: "Sam",
      date: "2026-11-03",
      start_time: "09:00",
      end_time: "17:00",
      note: "  Front desk ",
      timezone: TZ,
    });
    expect(res.data.status).toBe("created");
    expect(m.dbCreateScheduledShift).toHaveBeenCalledWith(
      "org_1",
      "user_sam",
      new Date("2026-11-03T15:00:00Z"),
      new Date("2026-11-03T23:00:00Z"),
      "Front desk",
      "user_admin",
    );
    expect(m.dbGetApprovedTimeOffForPeriod).toHaveBeenCalledWith(
      "user_sam",
      "org_1",
      "2026-11-03",
      "2026-11-03",
    );
    expect(m.revalidateTag).toHaveBeenCalledWith("scheduled-shifts-org_1", {
      expire: 0,
    });
    expect(m.notifyScheduleChange).toHaveBeenCalledWith("added", shift, TZ);
  });

  it("refuses a shift on the member's approved time off", async () => {
    m.dbGetApprovedTimeOffForPeriod.mockResolvedValue([timeOff]);
    const res = await manageScheduleTool(admin, {
      action: "create",
      member: "Sam",
      date: "2026-11-03",
      start_time: "09:00",
      end_time: "17:00",
      timezone: TZ,
    });
    expect(res.isError).toBe(true);
    expect(res.data.status).toBe("time_off_conflict");
    expect(m.dbCreateScheduledShift).not.toHaveBeenCalled();
  });

  it("asks for the missing fields when creating", async () => {
    const res = await manageScheduleTool(admin, {
      action: "create",
      member: "Sam",
    });
    expect(res.data.status).toBe("invalid_input");
  });

  it.each([
    [
      "create",
      {
        member: "Sam",
        date: "2026-11-03",
        start_time: "9:00",
        end_time: "17:00",
      },
    ],
    ["update", { shift_id: 7, start_time: "10:00" }],
    ["cancel", { shift_id: 7 }],
  ] as const)("forbids members from %s", async (action, extra) => {
    asRole("org:member");
    const res = await manageScheduleTool(member, { action, ...extra });
    expect(res.data.status).toBe("forbidden");
    expect(m.dbCreateScheduledShift).not.toHaveBeenCalled();
    expect(m.dbUpdateScheduledShift).not.toHaveBeenCalled();
    expect(m.dbDeleteScheduledShift).not.toHaveBeenCalled();
  });

  it("shows members only their own shifts", async () => {
    asRole("org:member");
    m.dbGetScheduledShifts.mockResolvedValue([shift]);
    const res = await manageScheduleTool(member, { timezone: TZ });
    expect(m.dbGetScheduledShifts.mock.calls[0][1]).toBe("user_sam");
    expect(res.data.shifts).toHaveLength(1);
    expect((res.data.shifts as { member: string }[])[0]?.member).toBe(
      "Sam Lee",
    );
  });

  it("shows admins everyone's shifts", async () => {
    m.dbGetScheduledShifts.mockResolvedValue([shift]);
    await manageScheduleTool(admin, {});
    expect(m.dbGetScheduledShifts.mock.calls[0][1]).toBeNull();
    expect(m.dbGetOrgTimeEntries).toHaveBeenCalled();
  });

  it("moves a shift, keeping what isn't changed", async () => {
    m.dbGetScheduledShiftById.mockResolvedValue({ ...shift, note: "Desk" });
    m.dbUpdateScheduledShift.mockResolvedValue(shift);
    const res = await manageScheduleTool(admin, {
      action: "update",
      shift_id: 7,
      start_time: "10:00",
      timezone: TZ,
    });
    expect(res.data.status).toBe("updated");
    expect(m.dbUpdateScheduledShift).toHaveBeenCalledWith(
      7,
      "org_1",
      new Date("2026-11-03T16:00:00Z"),
      new Date("2026-11-03T23:00:00Z"),
      "Desk",
    );
    expect(m.notifyScheduleChange).toHaveBeenCalledWith("changed", shift, TZ);
  });

  it("asks what to change on an empty update", async () => {
    m.dbGetScheduledShiftById.mockResolvedValue(shift);
    const res = await manageScheduleTool(admin, {
      action: "update",
      shift_id: 7,
    });
    expect(res.data.status).toBe("invalid_input");
    expect(m.dbUpdateScheduledShift).not.toHaveBeenCalled();
  });

  it("reports a shift from another org", async () => {
    m.dbGetScheduledShiftById.mockResolvedValue(undefined);
    const res = await manageScheduleTool(admin, {
      action: "cancel",
      shift_id: 99,
    });
    expect(res.data.status).toBe("not_found");
    expect(m.dbDeleteScheduledShift).not.toHaveBeenCalled();
  });

  it("cancels a shift by member and date and notifies the member", async () => {
    m.dbGetScheduledShifts.mockResolvedValue([shift]);
    m.dbGetScheduledShiftById.mockResolvedValue(shift);
    m.dbDeleteScheduledShift.mockResolvedValue(shift);
    const res = await manageScheduleTool(admin, {
      action: "cancel",
      member: "Sam",
      date: "2026-11-03",
      timezone: TZ,
    });
    expect(res.data.status).toBe("cancelled");
    expect(m.dbGetScheduledShifts).toHaveBeenCalledWith(
      "org_1",
      "user_sam",
      new Date("2026-11-03T06:00:00Z"),
      new Date("2026-11-04T06:00:00Z"),
    );
    expect(m.dbDeleteScheduledShift).toHaveBeenCalledWith(7, "org_1");
    expect(m.notifyScheduleChange).toHaveBeenCalledWith("removed", shift, TZ);
  });

  it("asks for a shift_id when the day has no single shift", async () => {
    const res = await manageScheduleTool(admin, {
      action: "cancel",
      member: "Sam",
      date: "2026-11-03",
    });
    expect(res.data.status).toBe("invalid_input");
    expect(res.summary).toContain("has no shift");
  });
});

describe("manage_time_off", () => {
  beforeEach(() => {
    m.getBillingSubscription.mockResolvedValue({
      subscriptionItems: [{ plan: { features: [{ slug: "time_off" }] } }],
    });
  });

  it("needs the time_off plan feature", async () => {
    m.getBillingSubscription.mockResolvedValue({ subscriptionItems: [] });
    const res = await manageTimeOffTool(admin, { action: "list" });
    expect(res.isError).toBe(true);
    expect(res.data.status).toBe("time_off_not_enabled");
    expect(m.getBillingSubscription).toHaveBeenCalledWith("org_1");
  });

  it("lets an admin add approved time off for a member", async () => {
    m.dbCreateTimeOffRequest.mockResolvedValue(timeOff);
    const res = await manageTimeOffTool(admin, {
      action: "request",
      member: "Sam",
      start_date: "2026-11-03",
      end_date: "2026-11-04",
    });
    expect(res.data.status).toBe("approved");
    expect(m.dbCreateTimeOffRequest).toHaveBeenCalledWith(
      "org_1",
      "user_sam",
      "vacation",
      "2026-11-03",
      "2026-11-04",
      8,
      null,
      "user_admin",
      null,
    );
    expect(m.dbGetTimeOffByExternalRef).not.toHaveBeenCalled();
    expect(res.data.request).toMatchObject({ external_ref: null });
    expect(m.revalidateTag).toHaveBeenCalledWith("time-off-org_1", {
      expire: 0,
    });
  });

  it("files calendar imports with their external_ref", async () => {
    asRole("org:member");
    m.dbGetTimeOffByExternalRef.mockResolvedValue(undefined);
    m.dbCreateTimeOffRequest.mockResolvedValue({
      ...timeOff,
      user_id: "user_sam",
      status: "pending",
      external_ref: "google-calendar:primary:evt1",
    });
    const res = await manageTimeOffTool(member, {
      action: "request",
      start_date: "2026-11-03",
      external_ref: "  google-calendar:primary:evt1 ",
    });
    expect(res.data.status).toBe("pending");
    expect(m.dbGetTimeOffByExternalRef).toHaveBeenCalledWith(
      "org_1",
      "user_sam",
      "google-calendar:primary:evt1",
    );
    expect(m.dbCreateTimeOffRequest.mock.calls[0][8]).toBe(
      "google-calendar:primary:evt1",
    );
    expect(res.data.request).toMatchObject({
      external_ref: "google-calendar:primary:evt1",
    });
  });

  it("returns the existing request instead of importing an event twice", async () => {
    m.dbGetTimeOffByExternalRef.mockResolvedValue({
      ...timeOff,
      status: "denied",
      external_ref: "google-calendar:primary:evt1",
    });
    const own = await manageTimeOffTool(admin, {
      action: "request",
      start_date: "2026-11-03",
      external_ref: "google-calendar:primary:evt1",
    });
    expect(own.isError).toBeUndefined();
    expect(own.data.status).toBe("already_imported");
    expect(own.summary).toContain("Already imported: your vacation");
    expect(own.summary).toContain("(denied)");
    expect(own.data.request).toMatchObject({ request_id: timeOff.id });
    expect(m.dbCreateTimeOffRequest).not.toHaveBeenCalled();

    const forSam = await manageTimeOffTool(admin, {
      action: "request",
      member: "Sam",
      start_date: "2026-11-03",
      external_ref: "google-calendar:primary:evt1",
    });
    expect(forSam.summary).toMatch(/^Already imported: Sam .*'s vacation/);
  });

  it("treats a blank external_ref as none and rejects an overlong one", async () => {
    m.dbCreateTimeOffRequest.mockResolvedValue(timeOff);
    await manageTimeOffTool(admin, {
      action: "request",
      start_date: "2026-11-03",
      external_ref: "   ",
    });
    expect(m.dbGetTimeOffByExternalRef).not.toHaveBeenCalled();
    expect(m.dbCreateTimeOffRequest.mock.calls[0][8]).toBeNull();

    const res = await manageTimeOffTool(admin, {
      action: "request",
      start_date: "2026-11-03",
      external_ref: "x".repeat(MAX_TIME_OFF_EXTERNAL_REF_LENGTH + 1),
    });
    expect(res.data.status).toBe("invalid_input");
    expect(res.summary).toContain("external_ref is too long");
  });

  it("files a member's own request as pending", async () => {
    asRole("org:member");
    m.dbCreateTimeOffRequest.mockResolvedValue({
      ...timeOff,
      status: "pending",
    });
    const res = await manageTimeOffTool(member, {
      action: "request",
      type: "sick",
      start_date: "2026-11-03",
    });
    expect(res.data.status).toBe("pending");
    expect(m.dbCreateTimeOffRequest.mock.calls[0][7]).toBeNull();
  });

  it("stops members approving or filing for others", async () => {
    asRole("org:member");
    expect(
      (
        await manageTimeOffTool(member, {
          action: "request",
          start_date: "2026-11-03",
          approve: true,
        })
      ).data.status,
    ).toBe("forbidden");
    expect(
      (
        await manageTimeOffTool(member, {
          action: "request",
          member: "Pat",
          start_date: "2026-11-03",
        })
      ).data.status,
    ).toBe("forbidden");
    expect(
      (await manageTimeOffTool(member, { action: "approve", request_id: 4 }))
        .data.status,
    ).toBe("forbidden");
    expect(m.dbCreateTimeOffRequest).not.toHaveBeenCalled();
    expect(m.dbReviewTimeOffRequest).not.toHaveBeenCalled();
  });

  it("approves, denies and revokes as an admin", async () => {
    m.dbReviewTimeOffRequest.mockResolvedValue(timeOff);
    m.dbCancelTimeOffRequest.mockResolvedValue({
      ...timeOff,
      status: "cancelled",
    });
    await manageTimeOffTool(admin, { action: "approve", request_id: 4 });
    await manageTimeOffTool(admin, { action: "deny", request_id: 4 });
    expect(m.dbReviewTimeOffRequest.mock.calls).toEqual([
      [4, "org_1", "approved", "user_admin"],
      [4, "org_1", "denied", "user_admin"],
    ]);
    const res = await manageTimeOffTool(admin, {
      action: "cancel",
      request_id: 4,
    });
    expect(res.data.status).toBe("cancelled");
    expect(m.dbCancelTimeOffRequest).toHaveBeenCalledWith(
      4,
      "org_1",
      "user_admin",
      true,
    );
  });

  it("shows members only their own requests", async () => {
    asRole("org:member");
    m.dbGetTimeOffRequests.mockResolvedValue([
      timeOff,
      { ...timeOff, id: 5, user_id: "user_admin" },
    ]);
    const res = await manageTimeOffTool(member, {});
    expect(
      (res.data.requests as { request_id: number }[]).map((r) => r.request_id),
    ).toEqual([4]);
  });
});

describe("manage_overtime_settings", () => {
  it("updates one threshold and keeps the other", async () => {
    m.dbGetOvertimeSettings.mockResolvedValue({
      org_id: "org_1",
      daily_threshold_hours: 8,
      weekly_threshold_hours: null,
    });
    m.dbUpdateOvertimeSettings.mockResolvedValue({
      org_id: "org_1",
      daily_threshold_hours: 8,
      weekly_threshold_hours: 40,
    });
    const res = await manageOvertimeSettingsTool(admin, {
      action: "update",
      weekly_threshold_hours: 40,
    });
    expect(m.dbUpdateOvertimeSettings).toHaveBeenCalledWith("org_1", 8, 40);
    expect(res.summary).toContain("over 8h/day or 40h/week");
  });

  it("forbids members from changing it", async () => {
    asRole("org:member");
    m.dbGetOvertimeSettings.mockResolvedValue(undefined);
    const res = await manageOvertimeSettingsTool(member, {
      action: "update",
      daily_threshold_hours: 8,
    });
    expect(res.data.status).toBe("forbidden");
  });
});

describe("manage_pay_period_settings", () => {
  // Weekly, paid Fridays, held back a week: Oct 31 – Nov 6 is paid Nov 13.
  const saved = {
    org_id: "org_1",
    enabled: true,
    frequency: "weekly" as const,
    anchor_payday: "2026-11-13",
    holdback_days: 7,
  };

  it("shows members the pay period for a date with its payday and report date", async () => {
    asRole("org:member");
    m.dbGetPayPeriodSettings.mockResolvedValue(saved);
    const res = await managePayPeriodSettingsTool(member, {
      date: "2026-11-03",
    });
    expect(res.isError).toBeUndefined();
    expect(res.summary).toBe(
      "Acme is paid every week from 2026-11-13, with a 1 week hold-back. The pay period for 2026-11-03 is Oct 31 – Nov 6, paid Fri, Nov 13.",
    );
    expect(res.data).toMatchObject({
      date: "2026-11-03",
      pay_period: {
        start_date: "2026-10-31",
        end_date: "2026-11-06",
        payday: "2026-11-13",
        report_date: "2026-11-07",
        label: "Oct 31 – Nov 6, paid Fri, Nov 13",
      },
      previous_pay_period: { start_date: "2026-10-24", payday: "2026-11-06" },
      next_pay_periods: [
        { start_date: "2026-11-07", payday: "2026-11-20" },
        { start_date: "2026-11-14", payday: "2026-11-27" },
      ],
    });
  });

  it("defaults to today in the given timezone and describes no hold-back", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // Still Nov 6 in Regina.
    vi.setSystemTime(new Date("2026-11-07T03:00:00Z"));
    m.dbGetPayPeriodSettings.mockResolvedValue({
      ...saved,
      frequency: "bi-weekly",
      holdback_days: 0,
    });
    const res = await managePayPeriodSettingsTool(admin, { timezone: TZ });
    vi.useRealTimers();
    expect(res.data.date).toBe("2026-11-06");
    expect(res.summary).toContain(
      "paid every 2 weeks from 2026-11-13, with no hold-back",
    );
  });

  it.each([
    ["not set up", undefined, "not set up"],
    ["turned off", { ...saved, enabled: false }, "turned off"],
  ])("says when pay periods are %s", async (_label, value, words) => {
    m.dbGetPayPeriodSettings.mockResolvedValue(value);
    const res = await managePayPeriodSettingsTool(admin, {});
    expect(res.summary).toContain(`Pay periods are ${words} for Acme.`);
    expect(res.summary).toContain("Use action 'update'");
    expect(res.data.enabled).toBe(false);
  });

  it("tells members an admin can set pay periods up", async () => {
    asRole("org:member");
    m.dbGetPayPeriodSettings.mockResolvedValue(undefined);
    const res = await managePayPeriodSettingsTool(member, {});
    expect(res.summary).toContain("An admin can set them up.");
  });

  it("sets pay periods up from a payday with sensible defaults", async () => {
    m.dbGetPayPeriodSettings.mockResolvedValue(undefined);
    m.dbUpdatePayPeriodSettings.mockResolvedValue({
      ...saved,
      frequency: "bi-weekly",
      holdback_days: 0,
    });
    const res = await managePayPeriodSettingsTool(admin, {
      action: "update",
      payday: "2026-11-13",
    });
    expect(m.dbUpdatePayPeriodSettings).toHaveBeenCalledWith(
      "org_1",
      true,
      "bi-weekly",
      "2026-11-13",
      0,
    );
    expect(m.revalidateTag).toHaveBeenCalledWith("pay-period-settings-org_1", {
      expire: 0,
    });
    expect(res.data.status).toBe("updated");
  });

  it("changes only the fields passed", async () => {
    m.dbGetPayPeriodSettings.mockResolvedValue({ ...saved, holdback_days: 0 });
    m.dbUpdatePayPeriodSettings.mockResolvedValue(saved);
    const res = await managePayPeriodSettingsTool(admin, {
      action: "update",
      holdback_days: 7,
    });
    expect(m.dbUpdatePayPeriodSettings).toHaveBeenCalledWith(
      "org_1",
      true,
      "weekly",
      "2026-11-13",
      7,
    );
    expect(res.summary).toBe(
      "Updated pay periods for Acme: paid every week from 2026-11-13, with a 1 week hold-back.",
    );
  });

  it("turns pay periods off", async () => {
    m.dbGetPayPeriodSettings.mockResolvedValue(saved);
    m.dbUpdatePayPeriodSettings.mockResolvedValue({ ...saved, enabled: false });
    const res = await managePayPeriodSettingsTool(admin, {
      action: "update",
      enabled: false,
    });
    expect(res.summary).toBe("Turned pay periods off for Acme.");
    expect(res.data.settings).toMatchObject({ enabled: false });
  });

  it("forbids members from changing it", async () => {
    asRole("org:member");
    m.dbGetPayPeriodSettings.mockResolvedValue(saved);
    const res = await managePayPeriodSettingsTool(member, {
      action: "update",
      holdback_days: 14,
    });
    expect(res.data.status).toBe("forbidden");
    expect(m.dbUpdatePayPeriodSettings).not.toHaveBeenCalled();
  });

  it.each([
    ["nothing to change", {}, "Nothing to update"],
    ["no payday on first setup", { enabled: true }, "Pass a payday"],
    [
      "an impossible payday",
      { payday: "2026-02-30" },
      "Invalid pay period settings.",
    ],
  ])("rejects %s", async (_label, patch, message) => {
    m.dbGetPayPeriodSettings.mockResolvedValue(undefined);
    const res = await managePayPeriodSettingsTool(admin, {
      action: "update",
      ...patch,
    });
    expect(res.isError).toBe(true);
    expect(res.summary).toContain(message);
    expect(m.dbUpdatePayPeriodSettings).not.toHaveBeenCalled();
  });
});

describe("manage_alert_settings", () => {
  it("merges an update with the saved rules", async () => {
    m.dbGetAlertSettings.mockResolvedValue(undefined);
    m.dbUpdateAlertSettings.mockImplementation(async (_org, input) => input);
    const res = await manageAlertSettingsTool(admin, {
      action: "update",
      auto_clock_out_enabled: true,
      auto_clock_out_hours: 12,
    });
    expect(res.data.status).toBe("updated");
    expect(m.dbUpdateAlertSettings).toHaveBeenCalledWith(
      "org_1",
      expect.objectContaining({
        auto_clock_out_enabled: true,
        auto_clock_out_hours: 12,
        schedule_notifications: true,
      }),
    );
  });

  it("forbids members from changing it", async () => {
    asRole("org:member");
    const res = await manageAlertSettingsTool(member, {
      action: "update",
      notify_admins: false,
    });
    expect(res.data.status).toBe("forbidden");
    expect(m.dbUpdateAlertSettings).not.toHaveBeenCalled();
  });
});

describe("manage_location_settings", () => {
  const geofencingPlan = {
    subscriptionItems: [{ plan: { features: [{ slug: "geofencing" }] } }],
  };

  it("needs the geofencing plan feature to change anything", async () => {
    m.getBillingSubscription.mockResolvedValue({ subscriptionItems: [] });
    const res = await manageLocationSettingsTool(admin, {
      action: "update",
      capture_mode: "required",
    });
    expect(res.data.status).toBe("geofencing_not_enabled");
    expect(m.dbUpdateLocationSettings).not.toHaveBeenCalled();
  });

  it("updates the capture mode", async () => {
    m.getBillingSubscription.mockResolvedValue(geofencingPlan);
    m.dbGetLocationSettings.mockResolvedValue({
      org_id: "org_1",
      capture_mode: "optional",
      restrict_clock_in: true,
    });
    const res = await manageLocationSettingsTool(admin, {
      action: "update",
      capture_mode: "required",
    });
    expect(res.data.status).toBe("updated");
    expect(m.dbUpdateLocationSettings).toHaveBeenCalledWith(
      "org_1",
      "required",
      true,
    );
  });

  it("adds a site from an address", async () => {
    m.getBillingSubscription.mockResolvedValue(geofencingPlan);
    m.searchAddress.mockResolvedValue([
      { formatted: "1 Main St", latitude: 50.4, longitude: -104.6 },
    ]);
    m.dbCreateSite.mockResolvedValue({
      id: 2,
      org_id: "org_1",
      name: "Shop",
      latitude: 50.4,
      longitude: -104.6,
      radius_meters: 150,
      address: "1 Main St",
    });
    const res = await manageLocationSettingsTool(admin, {
      action: "add_site",
      name: "Shop",
      address: "1 Main St",
    });
    expect(res.data.status).toBe("created");
    expect(m.dbCreateSite).toHaveBeenCalledWith(
      "org_1",
      "Shop",
      50.4,
      -104.6,
      150,
      "1 Main St",
    );
  });

  it("forbids members from changing it", async () => {
    asRole("org:member");
    const res = await manageLocationSettingsTool(member, {
      action: "delete_site",
      site_id: 2,
    });
    expect(res.data.status).toBe("forbidden");
    expect(m.dbDeleteSite).not.toHaveBeenCalled();
  });
});

describe("manage_member", () => {
  it("promotes a member to admin", async () => {
    const res = await manageMemberTool(admin, {
      action: "set_role",
      member: "Sam",
      role: "admin",
    });
    expect(res.data.status).toBe("updated");
    expect(m.updateMembership).toHaveBeenCalledWith({
      organizationId: "org_1",
      userId: "user_sam",
      role: "org:admin",
    });
  });

  it("leaves a role that is already set", async () => {
    const res = await manageMemberTool(admin, {
      action: "set_role",
      member: "Sam",
      role: "org:member",
    });
    expect(res.data.status).toBe("unchanged");
    expect(m.updateMembership).not.toHaveBeenCalled();
  });

  it("removes a member", async () => {
    const res = await manageMemberTool(admin, {
      action: "remove",
      member: "sam@example.com",
    });
    expect(res.data.status).toBe("removed");
    expect(m.deleteMembership).toHaveBeenCalledWith({
      organizationId: "org_1",
      userId: "user_sam",
    });
  });

  it("won't change or remove the calling admin", async () => {
    const res = await manageMemberTool(admin, {
      action: "remove",
      member: "Pat",
    });
    expect(res.data.status).toBe("invalid_input");
    expect(m.deleteMembership).not.toHaveBeenCalled();
  });

  it("forbids members", async () => {
    asRole("org:member");
    const res = await manageMemberTool(member, {
      action: "set_role",
      member: "Pat",
      role: "member",
    });
    expect(res.data.status).toBe("forbidden");
    expect(m.updateMembership).not.toHaveBeenCalled();
  });
});
