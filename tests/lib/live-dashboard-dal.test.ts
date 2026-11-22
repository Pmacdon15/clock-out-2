import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  protect: vi.fn(),
  orgMemberships: vi.fn(),
  connection: vi.fn(async () => {}),
  dbGetLiveOrgEntries: vi.fn(),
  dbGetBreakSettings: vi.fn(),
  dbGetPayRates: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: { protect: mocks.protect },
  clerkClient: vi.fn(async () => ({
    organizations: { getOrganizationMembershipList: mocks.orgMemberships },
  })),
}));
vi.mock("next/server", () => ({ connection: mocks.connection }));
vi.mock("@/lib/db", () => ({
  dbGetLiveOrgEntries: mocks.dbGetLiveOrgEntries,
  dbGetBreakSettings: mocks.dbGetBreakSettings,
  dbGetPayRates: mocks.dbGetPayRates,
}));

import { getLiveDashboard } from "@/lib/live-dashboard-dal";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.protect.mockResolvedValue({
    userId: "me",
    orgId: "org_a",
    orgRole: "org:admin",
  });
  mocks.orgMemberships.mockResolvedValue({
    data: [
      { publicUserData: { userId: "me", firstName: "Me" } },
      { publicUserData: { userId: "u2", firstName: "Sam", lastName: "Lee" } },
      { publicUserData: null },
    ],
    totalCount: 3,
  });
  mocks.dbGetBreakSettings.mockResolvedValue(undefined);
  mocks.dbGetPayRates.mockResolvedValue([
    { user_id: "u2", hourly_rate: "25", overtime_multiplier: 1.5 },
    { user_id: "bad", hourly_rate: "nope" },
  ]);
  mocks.dbGetLiveOrgEntries.mockResolvedValue([
    {
      id: 1,
      user_id: "u2",
      org_id: "org_a",
      clock_in: "2026-03-10T09:00:00Z",
      clock_out: null,
      skip_lunch: true,
      clock_in_latitude: 50,
      clock_in_address: "1 Secret St",
      clock_in_site_name: "Depot",
      breaks: [
        {
          id: 9,
          time_entry_id: 1,
          break_type: "unpaid_rest",
          break_start: "2026-03-10T10:00:00Z",
          break_end: null,
        },
      ],
    },
    {
      id: 2,
      user_id: "me",
      org_id: "org_a",
      clock_in: "2026-03-10T08:00:00Z",
      clock_out: "2026-03-10T09:00:00Z",
    },
    { id: 3, user_id: "x", org_id: "org_other", clock_in: "", clock_out: null },
  ]);
});

describe("getLiveDashboard", () => {
  it("refuses anyone but an admin of the active org", async () => {
    for (const session of [
      { userId: "me", orgId: "org_a", orgRole: "org:member" },
      { userId: "me", orgId: null, orgRole: "org:admin" },
      { userId: null, orgId: "org_a", orgRole: "org:admin" },
    ]) {
      mocks.protect.mockResolvedValueOnce(session);
      await expect(getLiveDashboard()).resolves.toEqual({
        ok: false,
        error: {
          reason: "Only organization admins can see the live dashboard.",
        },
      });
    }
    expect(mocks.dbGetLiveOrgEntries).not.toHaveBeenCalled();
  });

  it("returns members, rates and trimmed shifts for the org", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T12:00:00Z"));
    const result = await getLiveDashboard();

    expect(mocks.connection).toHaveBeenCalled();
    expect(mocks.dbGetLiveOrgEntries).toHaveBeenCalledWith(
      "org_a",
      new Date("2026-03-08T12:00:00Z"),
    );
    expect(result).toEqual({
      ok: true,
      value: {
        members: [
          { id: "me", name: "Me" },
          { id: "u2", name: "Sam Lee" },
        ],
        breakSettings: null,
        hourlyRates: { u2: 25 },
        shifts: [
          {
            id: 1,
            userId: "u2",
            clockIn: "2026-03-10T09:00:00Z",
            clockOut: null,
            skipLunch: true,
            breaks: [
              {
                break_type: "unpaid_rest",
                break_start: "2026-03-10T10:00:00Z",
                break_end: null,
              },
            ],
            siteName: "Depot",
          },
          {
            id: 2,
            userId: "me",
            clockIn: "2026-03-10T08:00:00Z",
            clockOut: "2026-03-10T09:00:00Z",
            skipLunch: false,
            breaks: [],
            siteName: null,
          },
        ],
      },
    });
  });

  it("passes the org's break settings through", async () => {
    mocks.dbGetBreakSettings.mockResolvedValue({ dock_lunch: true });
    const result = await getLiveDashboard();
    expect(result.ok && result.value.breakSettings).toEqual({
      dock_lunch: true,
    });
  });

  it("reports a failed read", async () => {
    mocks.dbGetLiveOrgEntries.mockRejectedValue(new Error("down"));
    await expect(getLiveDashboard()).resolves.toEqual({
      ok: false,
      error: { reason: "Could not load the live dashboard." },
    });
    expect(console.error).toHaveBeenCalled();
  });
});
