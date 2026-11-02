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
  deliver: vi.fn(),
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
  dbGetActiveAlertSettings: mocks.dbGetActiveAlertSettings,
  dbGetOpenShiftBreaks: mocks.dbGetOpenShiftBreaks,
  dbGetOpenShifts: mocks.dbGetOpenShifts,
}));
vi.mock("@/lib/db", () => ({ dbGetBreakSettings: mocks.dbGetBreakSettings }));
vi.mock("@/lib/notify", () => ({ deliver: mocks.deliver }));

import type { PlannedAlert } from "@/lib/alerts";
import {
  buildDeliveries,
  loadOrgMembers,
  processOrgAlerts,
  runShiftAlerts,
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

describe("processOrgAlerts", () => {
  it("does no Clerk lookups when nothing is due", async () => {
    mocks.dbGetOpenShifts.mockResolvedValue([
      { id: 1, user_id: "u1", org_id: "org_1", clock_in: ago(HOUR) },
    ]);
    await expect(processOrgAlerts(settings, now)).resolves.toEqual({
      orgId: "org_1",
      status: "ok",
      alerts: 0,
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
      async (key: string) => key !== "break:9",
    );

    await expect(processOrgAlerts(settings, now)).resolves.toEqual({
      orgId: "org_1",
      status: "ok",
      alerts: 2,
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
      "break:9",
    ]);
    expect(mocks.deliver).toHaveBeenCalledTimes(2);
  });

  it("skips break lookups when break reminders are off and survives missing break settings", async () => {
    mocks.dbGetBreakSettings.mockRejectedValue(new Error("db"));
    mocks.dbGetOpenShifts.mockResolvedValue([
      { id: 3, user_id: "u1", org_id: "org_1", clock_in: ago(11 * HOUR) },
    ]);
    const result = await processOrgAlerts(
      { ...settings, break_reminder_enabled: false },
      now,
    );
    expect(result.alerts).toBe(1);
    expect(mocks.dbGetOpenShiftBreaks).not.toHaveBeenCalled();
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
    const results = await runShiftAlerts(now);
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
