// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOrganizationMembershipList: vi.fn(),
  revalidateTag: vi.fn(),
  dbAutoClockOut: vi.fn(),
  dbClaimAlert: vi.fn(),
  dbGetActiveAlertSettings: vi.fn(),
  dbGetOpenShiftBreaks: vi.fn(),
  dbGetOpenShifts: vi.fn(),
  dbGetBreakSettings: vi.fn(),
  dbGetOrgScheduledShiftsOverlapping: vi.fn(),
  dbScheduledClockIn: vi.fn(),
  dbScheduledClockOut: vi.fn(),
  deliver: vi.fn(),
  orgHasPlanFeatureStrict: vi.fn(),
  dbDisableScheduledClockRules: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: vi.fn(async () => ({
    organizations: {
      getOrganizationMembershipList: mocks.getOrganizationMembershipList,
    },
  })),
}));
vi.mock("next/cache", () => ({ revalidateTag: mocks.revalidateTag }));
vi.mock("@/lib/alerts-db", () => ({
  dbAutoClockOut: mocks.dbAutoClockOut,
  dbClaimAlert: mocks.dbClaimAlert,
  dbDisableScheduledClockRules: mocks.dbDisableScheduledClockRules,
  dbGetActiveAlertSettings: mocks.dbGetActiveAlertSettings,
  dbGetOpenShiftBreaks: mocks.dbGetOpenShiftBreaks,
  dbGetOpenShifts: mocks.dbGetOpenShifts,
  dbGetOrgScheduledShiftsOverlapping: mocks.dbGetOrgScheduledShiftsOverlapping,
  dbScheduledClockIn: mocks.dbScheduledClockIn,
  dbScheduledClockOut: mocks.dbScheduledClockOut,
}));
vi.mock("@/lib/db", () => ({ dbGetBreakSettings: mocks.dbGetBreakSettings }));
vi.mock("@/lib/notify", () => ({ deliver: mocks.deliver }));
vi.mock("@/lib/plan-features", () => ({
  SCHEDULING_FEATURE: "scheduling",
  orgHasPlanFeatureStrict: mocks.orgHasPlanFeatureStrict,
}));

import { normalizeAlertSettings, type PlannedAlert } from "@/lib/alerts";
import {
  alertNotifiesAdmins,
  buildDeliveries,
  loadOrgMembers,
  processOrgAlerts,
  runShiftAlerts,
  turnOffScheduledClockRules,
  withScheduledRulesAllowed,
} from "@/lib/alerts-runner";
import type { AlertSettingsData } from "@/lib/types";

const HOUR = 3_600_000;
const MIN = 60_000;
const now = new Date("2026-03-10T20:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

const settings: AlertSettingsData = {
  org_id: "org_1",
  forgot_clock_out_enabled: true,
  forgot_clock_out_hours: 10,
  auto_clock_out_enabled: true,
  auto_clock_out_hours: 16,
  break_reminder_enabled: true,
  break_reminder_minutes: 45,
  notify_admins: true,
};

const membership = (
  userId: string | null,
  role: string,
  extra: Record<string, unknown> = {},
) => ({
  role,
  publicUserData: userId
    ? { userId, identifier: `${userId}@x.test`, ...extra }
    : null,
});

const members = [
  { userId: "u1", name: "Ada Lovelace", email: "u1@x.test", isAdmin: false },
  { userId: "admin", name: "Boss", email: "admin@x.test", isAdmin: true },
  { userId: "u2", name: "Self Admin", email: null, isAdmin: true },
];

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  mocks.getOrganizationMembershipList.mockResolvedValue({
    data: [
      membership("u1", "org:member", {
        firstName: "Ada",
        lastName: "Lovelace",
      }),
      membership("admin", "org:admin", { firstName: "Boss" }),
      membership(null, "org:member"),
    ],
    totalCount: 3,
  });
  mocks.dbGetBreakSettings.mockResolvedValue(undefined);
  mocks.dbGetOpenShifts.mockResolvedValue([]);
  mocks.dbGetOpenShiftBreaks.mockResolvedValue([]);
  mocks.dbClaimAlert.mockResolvedValue(true);
  mocks.dbGetOrgScheduledShiftsOverlapping.mockResolvedValue([]);
  mocks.orgHasPlanFeatureStrict.mockResolvedValue(true);
  mocks.dbDisableScheduledClockRules.mockResolvedValue(undefined);
  mocks.deliver.mockResolvedValue({ email: 1, push: 2 });
});

describe("loadOrgMembers", () => {
  it("maps memberships, preferring full names and real emails", async () => {
    mocks.getOrganizationMembershipList.mockResolvedValue({
      data: [
        membership("u1", "org:member", { firstName: "Ada" }),
        {
          role: "org:admin",
          publicUserData: { userId: "u2", identifier: "+15550001" },
        },
        { role: "org:member", publicUserData: { userId: "u3" } },
      ],
      totalCount: 3,
    });
    await expect(loadOrgMembers("org_1")).resolves.toEqual([
      { userId: "u1", name: "Ada", email: "u1@x.test", isAdmin: false },
      { userId: "u2", name: "+15550001", email: null, isAdmin: true },
      { userId: "u3", name: "A team member", email: null, isAdmin: false },
    ]);
    expect(mocks.getOrganizationMembershipList).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_1" }),
    );
  });
});

describe("buildDeliveries", () => {
  const forgot = (userId: string): PlannedAlert => ({
    kind: "forgot_clock_out",
    key: "forgot:1",
    shift: {
      id: 1,
      user_id: userId,
      org_id: "org_1",
      clock_in: ago(11 * HOUR),
    },
    openMs: 11 * HOUR,
  });

  it("tells the member and every other admin", () => {
    const deliveries = buildDeliveries(forgot("u1"), members, "org_1", true);
    expect(deliveries.map((d) => [d.recipient.userId, d.category])).toEqual([
      ["u1", "shift_alerts"],
      ["admin", "admin_alerts"],
      ["u2", "admin_alerts"],
    ]);
    expect(deliveries[1].message.title).toBe(
      "Ada Lovelace may have forgotten to clock out",
    );
  });

  it("doesn't send an admin their own shift twice, or admins at all when off", () => {
    expect(
      buildDeliveries(forgot("u2"), members, "org_1", true).map(
        (d) => d.recipient.userId,
      ),
    ).toEqual(["u2", "admin"]);
    expect(
      buildDeliveries(forgot("u1"), members, "org_1", false).map(
        (d) => d.recipient.userId,
      ),
    ).toEqual(["u1"]);
  });

  it("still tells admins about someone who left the org", () => {
    const deliveries = buildDeliveries(forgot("gone"), members, "org_1", true);
    expect(deliveries.map((d) => d.recipient.userId)).toEqual(["admin", "u2"]);
    expect(deliveries[0].message.title).toContain("A team member");
  });
});

describe("processOrgAlerts: scheduled shifts", () => {
  const scheduledRow: AlertSettingsData = {
    org_id: "org_1",
    ...normalizeAlertSettings(null),
    auto_clock_in_scheduled: true,
    auto_clock_out_scheduled: true,
  };
  const scheduledShift = (id: number, start: Date, end: Date) => ({
    id,
    org_id: "org_1",
    user_id: "u1",
    shift_start: start,
    shift_end: end,
    note: null,
    created_by: "admin",
  });
  const running = scheduledShift(1, ago(HOUR), new Date(now.getTime() + HOUR));
  const ended = scheduledShift(2, ago(9 * HOUR), ago(HOUR));
  const ended2 = scheduledShift(3, ago(10 * HOUR), ago(2 * HOUR));

  it("clocks members in and out once, telling only the member", async () => {
    mocks.dbGetOrgScheduledShiftsOverlapping.mockResolvedValue([
      running,
      ended,
      ended2,
    ]);
    mocks.dbScheduledClockIn.mockResolvedValue({ id: 10, user_id: "u1" });
    // Shift 3 has nothing open any more.
    mocks.dbScheduledClockOut
      .mockResolvedValueOnce({ id: 11, user_id: "u1" })
      .mockResolvedValueOnce(undefined);
    await expect(processOrgAlerts(scheduledRow, now)).resolves.toMatchObject({
      alerts: 2,
      autoClockIns: 1,
      autoClockOuts: 1,
    });
    expect(mocks.dbGetOrgScheduledShiftsOverlapping).toHaveBeenCalledWith(
      "org_1",
      ago(24 * HOUR),
      new Date(now.getTime() + 1),
    );
    expect(mocks.dbClaimAlert.mock.calls.map((c) => c[0])).toEqual([
      "sched-in:1",
      "sched-out:2",
      "sched-out:3",
    ]);
    expect(mocks.dbScheduledClockOut).toHaveBeenCalledWith(
      ended,
      2 * HOUR,
      expect.objectContaining({ unpaid_meal: null }),
    );
    expect(mocks.revalidateTag).toHaveBeenCalledWith("time-entries-u1-org_1", {
      expire: 0,
    });
    // notify_admins is on, but admins aren't copied on scheduled punches.
    for (const [deliveries] of mocks.deliver.mock.calls) {
      expect(
        deliveries.map(
          (d: { recipient: { userId: string } }) => d.recipient.userId,
        ),
      ).toEqual(["u1"]);
    }
  });

  it("acts on each start or end only once", async () => {
    mocks.dbGetOrgScheduledShiftsOverlapping.mockResolvedValue([running]);
    mocks.dbClaimAlert.mockResolvedValue(false);
    const result = await processOrgAlerts(scheduledRow, now);
    expect(result.autoClockIns).toBe(0);
    expect(mocks.dbScheduledClockIn).not.toHaveBeenCalled();
  });

  it("still clocks in without the notifications feature, silently", async () => {
    mocks.dbGetOrgScheduledShiftsOverlapping.mockResolvedValue([running]);
    mocks.dbScheduledClockIn.mockResolvedValue({ id: 10, user_id: "u1" });
    const result = await processOrgAlerts(scheduledRow, now, false);
    expect(result).toMatchObject({ alerts: 0, autoClockIns: 1 });
    expect(mocks.deliver).not.toHaveBeenCalled();
  });

  it("reads no schedule when the scheduled rules are off", async () => {
    await processOrgAlerts(settings, now);
    expect(mocks.dbGetOrgScheduledShiftsOverlapping).not.toHaveBeenCalled();
    // Nothing to check the plan for, either.
    expect(mocks.orgHasPlanFeatureStrict).not.toHaveBeenCalled();
  });

  it("does nothing once the plan drops Scheduling", async () => {
    mocks.orgHasPlanFeatureStrict.mockResolvedValue(false);
    mocks.dbGetOrgScheduledShiftsOverlapping.mockResolvedValue([running]);
    const result = await processOrgAlerts(scheduledRow, now);
    expect(mocks.orgHasPlanFeatureStrict).toHaveBeenCalledWith(
      "org_1",
      "scheduling",
    );
    expect(result).toMatchObject({ autoClockIns: 0, autoClockOuts: 0 });
    expect(mocks.dbGetOrgScheduledShiftsOverlapping).not.toHaveBeenCalled();
    expect(mocks.dbScheduledClockIn).not.toHaveBeenCalled();
  });
});

describe("processOrgAlerts", () => {
  it("does no Clerk lookups when nothing is due", async () => {
    mocks.dbGetOpenShifts.mockResolvedValue([
      { id: 1, user_id: "u1", org_id: "org_1", clock_in: ago(HOUR) },
    ]);
    await expect(processOrgAlerts(settings, now)).resolves.toEqual({
      orgId: "org_1",
      status: "ok",
      alerts: 0,
      autoClockIns: 0,
      autoClockOuts: 0,
      emails: 0,
      pushes: 0,
    });
    expect(mocks.getOrganizationMembershipList).not.toHaveBeenCalled();
  });

  it("closes long shifts, sends due alerts once, and skips claimed ones", async () => {
    mocks.dbGetOpenShifts.mockResolvedValue([
      { id: 1, user_id: "u1", org_id: "org_1", clock_in: ago(17 * HOUR) },
      { id: 2, user_id: "u1", org_id: "org_1", clock_in: ago(18 * HOUR) },
      { id: 3, user_id: "u1", org_id: "org_1", clock_in: ago(11 * HOUR) },
    ]);
    mocks.dbGetOpenShiftBreaks.mockResolvedValue([
      {
        id: 9,
        time_entry_id: 3,
        break_type: "paid_rest",
        break_start: ago(50 * MIN),
        user_id: "u1",
        org_id: "org_1",
      },
    ]);
    mocks.dbGetBreakSettings.mockResolvedValue({
      org_id: "org_1",
      dock_lunch: false,
      lunch_duration_minutes: 30,
      lunch_min_shift_hours: 5,
      max_paid_break_minutes: 15,
    });
    // Shift 2 was clocked out in the meantime.
    mocks.dbAutoClockOut
      .mockResolvedValueOnce({ id: 1, user_id: "u1" })
      .mockResolvedValueOnce(undefined);
    // The break alert already went out on an earlier run.
    mocks.dbClaimAlert.mockImplementation(
      async (key: string) => key !== "break-over:9",
    );

    await expect(processOrgAlerts(settings, now)).resolves.toEqual({
      orgId: "org_1",
      status: "ok",
      alerts: 2,
      autoClockIns: 0,
      autoClockOuts: 1,
      emails: 2,
      pushes: 4,
    });
    expect(mocks.dbAutoClockOut).toHaveBeenCalledWith(1, 16, {
      unpaid_meal: null,
      paid_meal: null,
      unpaid_rest: null,
      paid_rest: 15,
    });
    expect(mocks.revalidateTag).toHaveBeenCalledWith("time-entries-u1-org_1", {
      expire: 0,
    });
    expect(mocks.revalidateTag).toHaveBeenCalledWith("org-time-entries-org_1", {
      expire: 0,
    });
    expect(mocks.dbClaimAlert.mock.calls.map((c) => c[0])).toEqual([
      "auto:1",
      "forgot:3",
      "break-over:9",
    ]);
    expect(mocks.deliver).toHaveBeenCalledTimes(2);
  });

  it("still closes long shifts but sends nothing without the notifications feature", async () => {
    mocks.dbGetBreakSettings.mockResolvedValue(undefined);
    mocks.dbGetOpenShiftBreaks.mockResolvedValue([]);
    mocks.dbGetOpenShifts.mockResolvedValue([
      { id: 1, user_id: "u1", org_id: "org_1", clock_in: ago(17 * HOUR) },
      { id: 3, user_id: "u1", org_id: "org_1", clock_in: ago(11 * HOUR) },
    ]);
    mocks.dbAutoClockOut.mockResolvedValue({ id: 1, user_id: "u1" });
    await expect(processOrgAlerts(settings, now, false)).resolves.toEqual({
      orgId: "org_1",
      status: "ok",
      alerts: 0,
      autoClockIns: 0,
      autoClockOuts: 1,
      emails: 0,
      pushes: 0,
    });
    expect(mocks.dbAutoClockOut).toHaveBeenCalledTimes(1);
    expect(mocks.dbClaimAlert).not.toHaveBeenCalled();
    expect(mocks.deliver).not.toHaveBeenCalled();
  });

  it("survives missing break settings", async () => {
    mocks.dbGetBreakSettings.mockRejectedValue(new Error("db"));
    mocks.dbGetOpenShifts.mockResolvedValue([
      { id: 3, user_id: "u1", org_id: "org_1", clock_in: ago(11 * HOUR) },
    ]);
    const result = await processOrgAlerts(
      { ...settings, break_reminder_enabled: false },
      now,
    );
    expect(result.alerts).toBe(1);
  });

  it("says a break is over at its limit with no alert rules saved", async () => {
    mocks.dbGetOpenShifts.mockResolvedValue([
      { id: 3, user_id: "u1", org_id: "org_1", clock_in: ago(HOUR) },
    ]);
    mocks.dbGetOpenShiftBreaks.mockResolvedValue([
      {
        id: 9,
        time_entry_id: 3,
        break_type: "paid_rest",
        break_start: ago(15 * MIN),
        user_id: "u1",
        org_id: "org_1",
      },
    ]);
    mocks.dbGetBreakSettings.mockResolvedValue({
      org_id: "org_1",
      dock_lunch: false,
      lunch_duration_minutes: 30,
      lunch_min_shift_hours: 5,
      max_paid_break_minutes: 15,
    });
    const result = await processOrgAlerts({ org_id: "org_1" }, now);
    expect(result.alerts).toBe(1);
    expect(mocks.dbClaimAlert).toHaveBeenCalledWith("break-over:9", "org_1");
    const [deliveries] = mocks.deliver.mock.calls[0];
    // Only the member: admins didn't turn on break reminders.
    expect(deliveries).toEqual([
      expect.objectContaining({
        recipient: { userId: "u1", email: "u1@x.test" },
        category: "break_alerts",
        message: expect.objectContaining({ title: "Your break is over" }),
      }),
    ]);
  });
});

describe("alertNotifiesAdmins", () => {
  const over: PlannedAlert = {
    kind: "break_over",
    key: "break-over:1",
    brk: {
      id: 1,
      time_entry_id: 1,
      break_type: "paid_rest",
      break_start: ago(15 * MIN),
      user_id: "u1",
      org_id: "org_1",
    },
    limitMinutes: 15,
  };
  const forgotAlert: PlannedAlert = {
    kind: "forgot_clock_out",
    key: "forgot:1",
    shift: { id: 1, user_id: "u1", org_id: "org_1", clock_in: ago(11 * HOUR) },
    openMs: 11 * HOUR,
  };
  const rules = normalizeAlertSettings(settings);

  it("tells admins about a break being over only with break reminders on", () => {
    expect(alertNotifiesAdmins(over, rules)).toBe(true);
    expect(
      alertNotifiesAdmins(over, { ...rules, break_reminder_enabled: false }),
    ).toBe(false);
    expect(
      alertNotifiesAdmins(forgotAlert, {
        ...rules,
        break_reminder_enabled: false,
      }),
    ).toBe(true);
    expect(alertNotifiesAdmins(over, { ...rules, notify_admins: false })).toBe(
      false,
    );
  });
});

describe("runShiftAlerts", () => {
  it("processes every active org and isolates failures", async () => {
    mocks.dbGetActiveAlertSettings.mockResolvedValue([
      settings,
      { ...settings, org_id: "org_2" },
    ]);
    mocks.dbGetOpenShifts
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("boom"));
    const hasNotifications = vi.fn(async () => true);
    const results = await runShiftAlerts(now, hasNotifications);
    expect(hasNotifications).toHaveBeenCalledWith("org_1");
    expect(results).toEqual([
      expect.objectContaining({ orgId: "org_1", status: "ok" }),
      { orgId: "org_2", status: "error" },
    ]);
  });

  it("defaults to the current time", async () => {
    mocks.dbGetActiveAlertSettings.mockResolvedValue([]);
    await expect(runShiftAlerts()).resolves.toEqual([]);
  });
});

describe("withScheduledRulesAllowed", () => {
  const base = normalizeAlertSettings(null);

  it("leaves rules alone, without asking Clerk, when neither is on", async () => {
    await expect(withScheduledRulesAllowed("org_1", base)).resolves.toBe(base);
    expect(mocks.orgHasPlanFeatureStrict).not.toHaveBeenCalled();
  });

  const off = {
    ...base,
    auto_clock_in_scheduled: false,
    auto_clock_out_scheduled: false,
  };
  const outOn = { ...base, auto_clock_out_scheduled: true };

  it("keeps them with Scheduling", async () => {
    const on = { ...base, auto_clock_in_scheduled: true };
    await expect(withScheduledRulesAllowed("org_1", on)).resolves.toBe(on);
    expect(mocks.dbDisableScheduledClockRules).not.toHaveBeenCalled();
  });

  it("switches them off for good once Scheduling is gone", async () => {
    mocks.orgHasPlanFeatureStrict.mockResolvedValue(false);
    mocks.dbDisableScheduledClockRules.mockResolvedValue({ org_id: "org_1" });
    await expect(withScheduledRulesAllowed("org_1", outOn)).resolves.toEqual(
      off,
    );
    expect(mocks.dbDisableScheduledClockRules).toHaveBeenCalledWith("org_1");
    expect(mocks.revalidateTag).toHaveBeenCalledWith("alert-settings-org_1", {
      expire: 0,
    });
  });

  it("still skips them when saving them off fails", async () => {
    mocks.orgHasPlanFeatureStrict.mockResolvedValue(false);
    mocks.dbDisableScheduledClockRules.mockRejectedValue(new Error("db"));
    await expect(withScheduledRulesAllowed("org_1", outOn)).resolves.toEqual(
      off,
    );
    expect(console.error).toHaveBeenCalled();
  });

  it("skips them this time, but leaves them saved, when Clerk is down", async () => {
    mocks.orgHasPlanFeatureStrict.mockRejectedValue(new Error("clerk down"));
    await expect(withScheduledRulesAllowed("org_1", outOn)).resolves.toEqual(
      off,
    );
    expect(mocks.dbDisableScheduledClockRules).not.toHaveBeenCalled();
  });

  it("reports whether turning them off changed anything", async () => {
    await expect(turnOffScheduledClockRules("org_1")).resolves.toBe(false);
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });
});
