import { err, ok } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  protect: vi.fn(),
  updateTag: vi.fn(),
  clockIn: vi.fn(),
  clockOut: vi.fn(),
  deleteTimeEntry: vi.fn(),
  updateTimeEntry: vi.fn(),
  startBreak: vi.fn(),
  endBreak: vi.fn(),
  updateBreakDal: vi.fn(),
  deleteBreakDal: vi.fn(),
  updateBreakSettingsDal: vi.fn(),
  updateLocationSettingsDal: vi.fn(),
  updateReportingSettingsDal: vi.fn(),
  createSiteDal: vi.fn(),
  updateSiteDal: vi.fn(),
  deleteSiteDal: vi.fn(),
  sendWeeklyReports: vi.fn(),
  reverseGeocode: vi.fn(),
  searchAddress: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: { protect: mocks.protect } }));
vi.mock("next/cache", () => ({ updateTag: mocks.updateTag }));
vi.mock("@/lib/geoapify", () => ({
  reverseGeocode: mocks.reverseGeocode,
  searchAddress: mocks.searchAddress,
}));
vi.mock("@/lib/dal", () => ({
  clockIn: mocks.clockIn,
  clockOut: mocks.clockOut,
  deleteTimeEntry: mocks.deleteTimeEntry,
  updateTimeEntry: mocks.updateTimeEntry,
  startBreak: mocks.startBreak,
  endBreak: mocks.endBreak,
  updateBreakDal: mocks.updateBreakDal,
  deleteBreakDal: mocks.deleteBreakDal,
  updateBreakSettingsDal: mocks.updateBreakSettingsDal,
  updateLocationSettingsDal: mocks.updateLocationSettingsDal,
  updateReportingSettingsDal: mocks.updateReportingSettingsDal,
  createSiteDal: mocks.createSiteDal,
  updateSiteDal: mocks.updateSiteDal,
  deleteSiteDal: mocks.deleteSiteDal,
}));
vi.mock("@/lib/reports", () => ({
  sendWeeklyReports: mocks.sendWeeklyReports,
}));

import {
  clockInAction,
  clockOutAction,
  createSiteAction,
  deleteBreakAction,
  deleteSiteAction,
  deleteTimeEntryAction,
  endBreakAction,
  reverseGeocodeAction,
  searchAddressAction,
  sendCurrentWeekReportAction,
  startBreakAction,
  updateBreakAction,
  updateBreakSettingAction,
  updateLocationSettingsAction,
  updateOrgSettingAction,
  updateSiteAction,
  updateTimeEntryAction,
} from "@/lib/actions";

const entry = { id: 1, user_id: "user_1", org_id: "org_1" };
const failure = err({ reason: "nope" });

describe("clockInAction", () => {
  it("revalidates the user's entries on success", async () => {
    mocks.clockIn.mockResolvedValue(ok(entry));
    await expect(clockInAction()).resolves.toEqual({
      success: true,
      data: entry,
    });
    expect(mocks.updateTag).toHaveBeenCalledWith("time-entries-user_1-org_1");
  });

  it("skips revalidation when no entry comes back", async () => {
    mocks.clockIn.mockResolvedValue(ok(undefined));
    await expect(clockInAction()).resolves.toEqual({
      success: true,
      data: undefined,
    });
    expect(mocks.updateTag).not.toHaveBeenCalled();
  });

  it("returns the failure reason", async () => {
    mocks.clockIn.mockResolvedValue(failure);
    await expect(clockInAction()).resolves.toEqual({
      success: false,
      error: "nope",
    });
  });
});

describe.each([
  ["clockOutAction", clockOutAction, mocks.clockOut, { data: entry }],
  [
    "updateTimeEntryAction",
    () =>
      updateTimeEntryAction(
        1,
        "2026-01-05T09:00:00.000Z",
        "2026-01-05T17:00:00.000Z",
      ),
    mocks.updateTimeEntry,
    { data: entry },
  ],
  [
    "deleteTimeEntryAction",
    () => deleteTimeEntryAction(1),
    mocks.deleteTimeEntry,
    {},
  ],
] as const)("%s", (_name, action, dalFn, extra) => {
  it("revalidates user and org entries on success", async () => {
    dalFn.mockResolvedValue(ok(entry));
    await expect(action()).resolves.toEqual({ success: true, ...extra });
    expect(mocks.updateTag).toHaveBeenCalledWith("time-entries-user_1-org_1");
    expect(mocks.updateTag).toHaveBeenCalledWith("org-time-entries-org_1");
  });

  it("skips revalidation when no entry comes back", async () => {
    dalFn.mockResolvedValue(ok(undefined));
    const result = await action();
    expect(result.success).toBe(true);
    expect(mocks.updateTag).not.toHaveBeenCalled();
  });

  it("returns the failure reason", async () => {
    dalFn.mockResolvedValue(failure);
    await expect(action()).resolves.toEqual({ success: false, error: "nope" });
  });
});

describe("updateTimeEntryAction arguments", () => {
  it("converts ISO strings to dates", async () => {
    mocks.updateTimeEntry.mockResolvedValue(ok(entry));
    await updateTimeEntryAction(
      7,
      "2026-01-05T09:00:00.000Z",
      "2026-01-05T17:00:00.000Z",
    );
    expect(mocks.updateTimeEntry).toHaveBeenCalledWith(
      7,
      new Date("2026-01-05T09:00:00.000Z"),
      new Date("2026-01-05T17:00:00.000Z"),
    );
  });

  it("passes null when the entry has no clock-out", async () => {
    mocks.updateTimeEntry.mockResolvedValue(ok(entry));
    await updateTimeEntryAction(7, "2026-01-05T09:00:00.000Z", null);
    expect(mocks.updateTimeEntry).toHaveBeenCalledWith(
      7,
      new Date("2026-01-05T09:00:00.000Z"),
      null,
    );
  });

  it("forwards skip_lunch when provided", async () => {
    mocks.updateTimeEntry.mockResolvedValue(ok(entry));
    await updateTimeEntryAction(
      7,
      "2026-01-05T09:00:00.000Z",
      "2026-01-05T17:00:00.000Z",
      true,
    );
    expect(mocks.updateTimeEntry).toHaveBeenCalledWith(
      7,
      new Date("2026-01-05T09:00:00.000Z"),
      new Date("2026-01-05T17:00:00.000Z"),
      true,
    );
  });
});

describe("sendCurrentWeekReportAction", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T15:30:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ["no user", { userId: null, orgId: "org_1", orgRole: "org:admin" }],
    ["no org", { userId: "user_1", orgId: null, orgRole: "org:admin" }],
  ])("rejects requests with %s", async (_label, session) => {
    mocks.protect.mockResolvedValue(session);
    await expect(sendCurrentWeekReportAction()).resolves.toEqual({
      success: false,
      error: "Unauthorized",
    });
  });

  it("rejects non-admins", async () => {
    mocks.protect.mockResolvedValue({
      userId: "user_1",
      orgId: "org_1",
      orgRole: "org:member",
    });
    await expect(sendCurrentWeekReportAction()).resolves.toEqual({
      success: false,
      error: "Only admins can test reports",
    });
    expect(mocks.sendWeeklyReports).not.toHaveBeenCalled();
  });

  it("sends the last seven days of reports for the admin's org", async () => {
    mocks.protect.mockResolvedValue({
      userId: "user_1",
      orgId: "org_1",
      orgRole: "org:admin",
    });
    await expect(sendCurrentWeekReportAction()).resolves.toEqual({
      success: true,
    });
    expect(mocks.sendWeeklyReports).toHaveBeenCalledWith(
      new Date("2026-01-08T00:00:00Z"),
      new Date("2026-01-15T15:30:00Z"),
      "org_1",
    );
  });
});

describe("updateOrgSettingAction", () => {
  it("uses default day and interval and revalidates settings", async () => {
    mocks.updateReportingSettingsDal.mockResolvedValue(ok({ org_id: "org_1" }));
    await expect(updateOrgSettingAction("weekly")).resolves.toEqual({
      success: true,
      data: { org_id: "org_1" },
    });
    expect(mocks.updateReportingSettingsDal).toHaveBeenCalledWith(
      "weekly",
      null,
      1,
    );
    expect(mocks.updateTag).toHaveBeenCalledWith("reporting-settings-org_1");
  });

  it("forwards a custom day and interval", async () => {
    mocks.updateReportingSettingsDal.mockResolvedValue(ok({ org_id: "org_1" }));
    await updateOrgSettingAction("custom", "Friday", 2);
    expect(mocks.updateReportingSettingsDal).toHaveBeenCalledWith(
      "custom",
      "Friday",
      2,
    );
  });

  it("returns the failure reason", async () => {
    mocks.updateReportingSettingsDal.mockResolvedValue(failure);
    await expect(updateOrgSettingAction("weekly")).resolves.toEqual({
      success: false,
      error: "nope",
    });
  });
});

describe("updateBreakSettingAction", () => {
  it("uses default duration and min shift hours and revalidates break settings", async () => {
    mocks.updateBreakSettingsDal.mockResolvedValue(ok({ org_id: "org_1" }));
    await expect(updateBreakSettingAction(true)).resolves.toEqual({
      success: true,
      data: { org_id: "org_1" },
    });
    expect(mocks.updateBreakSettingsDal).toHaveBeenCalledWith(
      true,
      30,
      5,
      undefined,
    );
    expect(mocks.updateTag).toHaveBeenCalledWith("break-settings-org_1");
  });

  it("forwards custom duration and min shift hours", async () => {
    mocks.updateBreakSettingsDal.mockResolvedValue(ok({ org_id: "org_1" }));
    await updateBreakSettingAction(true, 45, 6);
    expect(mocks.updateBreakSettingsDal).toHaveBeenCalledWith(
      true,
      45,
      6,
      undefined,
    );
  });

  it("returns the failure reason", async () => {
    mocks.updateBreakSettingsDal.mockResolvedValue(failure);
    await expect(updateBreakSettingAction(false)).resolves.toEqual({
      success: false,
      error: "nope",
    });
  });
});

const brk = {
  id: 7,
  time_entry_id: 1,
  break_type: "unpaid_meal",
  user_id: "user_1",
  org_id: "org_1",
};

describe("startBreakAction", () => {
  it("revalidates the member's and the org's entries on success", async () => {
    mocks.startBreak.mockResolvedValue(ok(brk));
    await expect(startBreakAction("unpaid_meal")).resolves.toEqual({
      success: true,
      data: brk,
    });
    expect(mocks.startBreak).toHaveBeenCalledWith("unpaid_meal");
    expect(mocks.updateTag).toHaveBeenCalledWith("time-entries-user_1-org_1");
    expect(mocks.updateTag).toHaveBeenCalledWith("org-time-entries-org_1");
  });

  it("defaults to the meal period", async () => {
    mocks.startBreak.mockResolvedValue(ok(brk));
    await startBreakAction();
    expect(mocks.startBreak).toHaveBeenCalledWith("unpaid_meal");
  });

  it("returns the failure reason", async () => {
    mocks.startBreak.mockResolvedValue(failure);
    await expect(startBreakAction()).resolves.toEqual({
      success: false,
      error: "nope",
    });
    expect(mocks.updateTag).not.toHaveBeenCalled();
  });
});

describe("endBreakAction", () => {
  it("revalidates both entry lists on success", async () => {
    mocks.endBreak.mockResolvedValue(ok(brk));
    await expect(endBreakAction()).resolves.toEqual({
      success: true,
      data: brk,
    });
    expect(mocks.updateTag).toHaveBeenCalledWith("time-entries-user_1-org_1");
    expect(mocks.updateTag).toHaveBeenCalledWith("org-time-entries-org_1");
  });

  it("returns the failure reason", async () => {
    mocks.endBreak.mockResolvedValue(failure);
    await expect(endBreakAction()).resolves.toEqual({
      success: false,
      error: "nope",
    });
  });
});

describe("updateBreakAction", () => {
  it("parses the dates and revalidates on success", async () => {
    mocks.updateBreakDal.mockResolvedValue(ok(brk));
    await expect(
      updateBreakAction(
        7,
        "2026-01-05T12:00:00.000Z",
        "2026-01-05T12:30:00.000Z",
        "unpaid_rest",
      ),
    ).resolves.toEqual({ success: true, data: brk });
    expect(mocks.updateBreakDal).toHaveBeenCalledWith(
      7,
      new Date("2026-01-05T12:00:00.000Z"),
      new Date("2026-01-05T12:30:00.000Z"),
      "unpaid_rest",
    );
    expect(mocks.updateTag).toHaveBeenCalledWith("org-time-entries-org_1");
  });

  it("passes a null end through for a running break", async () => {
    mocks.updateBreakDal.mockResolvedValue(ok(brk));
    await updateBreakAction(7, "2026-01-05T12:00:00.000Z", null, "paid_rest");
    expect(mocks.updateBreakDal).toHaveBeenCalledWith(
      7,
      new Date("2026-01-05T12:00:00.000Z"),
      null,
      "paid_rest",
    );
  });

  it("returns the failure reason", async () => {
    mocks.updateBreakDal.mockResolvedValue(failure);
    await expect(
      updateBreakAction(7, "2026-01-05T12:00:00.000Z", null, "unpaid_meal"),
    ).resolves.toEqual({ success: false, error: "nope" });
  });
});

describe("deleteBreakAction", () => {
  it("revalidates both entry lists on success", async () => {
    mocks.deleteBreakDal.mockResolvedValue(ok(brk));
    await expect(deleteBreakAction(7)).resolves.toEqual({ success: true });
    expect(mocks.deleteBreakDal).toHaveBeenCalledWith(7);
    expect(mocks.updateTag).toHaveBeenCalledWith("time-entries-user_1-org_1");
    expect(mocks.updateTag).toHaveBeenCalledWith("org-time-entries-org_1");
  });

  it("only revalidates the org list when the owner is unknown", async () => {
    mocks.deleteBreakDal.mockResolvedValue(ok({ ...brk, user_id: "" }));
    await expect(deleteBreakAction(7)).resolves.toEqual({ success: true });
    expect(mocks.updateTag).toHaveBeenCalledTimes(1);
    expect(mocks.updateTag).toHaveBeenCalledWith("org-time-entries-org_1");
  });

  it("returns the failure reason", async () => {
    mocks.deleteBreakDal.mockResolvedValue(failure);
    await expect(deleteBreakAction(7)).resolves.toEqual({
      success: false,
      error: "nope",
    });
  });
});
describe("clock actions forward coordinates to the DAL", () => {
  const coordinates = { latitude: 45.4215, longitude: -75.6972, accuracy: 5 };

  it("passes the browser's coordinates on clock-in", async () => {
    mocks.clockIn.mockResolvedValue(ok(entry));
    await clockInAction(coordinates);
    expect(mocks.clockIn).toHaveBeenCalledWith(coordinates);
  });

  it("passes nothing when the client has no coordinates", async () => {
    mocks.clockIn.mockResolvedValue(ok(entry));
    await clockInAction();
    expect(mocks.clockIn).toHaveBeenCalledWith(undefined);
  });

  it("passes the browser's coordinates on clock-out", async () => {
    mocks.clockOut.mockResolvedValue(ok(entry));
    await clockOutAction(coordinates);
    expect(mocks.clockOut).toHaveBeenCalledWith(coordinates);
  });
});

describe("updateLocationSettingsAction", () => {
  it("revalidates the org's location settings", async () => {
    mocks.updateLocationSettingsDal.mockResolvedValue(ok({ org_id: "org_1" }));
    await expect(
      updateLocationSettingsAction("required", true),
    ).resolves.toEqual({ success: true, data: { org_id: "org_1" } });
    expect(mocks.updateLocationSettingsDal).toHaveBeenCalledWith(
      "required",
      true,
    );
    expect(mocks.updateTag).toHaveBeenCalledWith("location-settings-org_1");
  });

  it("returns the failure reason", async () => {
    mocks.updateLocationSettingsDal.mockResolvedValue(failure);
    await expect(
      updateLocationSettingsAction("required", true),
    ).resolves.toEqual({ success: false, error: "nope" });
    expect(mocks.updateTag).not.toHaveBeenCalled();
  });
});

describe("site actions", () => {
  const site = { id: 3, org_id: "org_1", name: "Depot" };

  it("creates a site and revalidates the site list", async () => {
    mocks.createSiteDal.mockResolvedValue(ok(site));
    await expect(createSiteAction("Depot", 45, -75, 150)).resolves.toEqual({
      success: true,
      data: site,
    });
    expect(mocks.createSiteDal).toHaveBeenCalledWith("Depot", 45, -75, 150);
    expect(mocks.updateTag).toHaveBeenCalledWith("sites-org_1");
  });

  it("updates a site and revalidates the site list", async () => {
    mocks.updateSiteDal.mockResolvedValue(ok(site));
    await expect(updateSiteAction(3, "Depot", 45, -75, 150)).resolves.toEqual({
      success: true,
      data: site,
    });
    expect(mocks.updateSiteDal).toHaveBeenCalledWith(3, "Depot", 45, -75, 150);
    expect(mocks.updateTag).toHaveBeenCalledWith("sites-org_1");
  });

  it("deletes a site and revalidates the site list", async () => {
    mocks.deleteSiteDal.mockResolvedValue(ok(site));
    await expect(deleteSiteAction(3)).resolves.toEqual({
      success: true,
      data: site,
    });
    expect(mocks.deleteSiteDal).toHaveBeenCalledWith(3);
    expect(mocks.updateTag).toHaveBeenCalledWith("sites-org_1");
  });

  it("creates a site with address and forwards to DAL", async () => {
    mocks.createSiteDal.mockResolvedValue(
      ok({ ...site, address: "111 Albert St" }),
    );
    await expect(
      createSiteAction("Depot", 45, -75, 150, "111 Albert St"),
    ).resolves.toEqual({
      success: true,
      data: { ...site, address: "111 Albert St" },
    });
    expect(mocks.createSiteDal).toHaveBeenCalledWith(
      "Depot",
      45,
      -75,
      150,
      "111 Albert St",
    );
  });

  it("updates a site with address and forwards to DAL", async () => {
    mocks.updateSiteDal.mockResolvedValue(
      ok({ ...site, address: "111 Albert St" }),
    );
    await expect(
      updateSiteAction(3, "Depot", 45, -75, 150, "111 Albert St"),
    ).resolves.toEqual({
      success: true,
      data: { ...site, address: "111 Albert St" },
    });
    expect(mocks.updateSiteDal).toHaveBeenCalledWith(
      3,
      "Depot",
      45,
      -75,
      150,
      "111 Albert St",
    );
  });

  it.each([
    [
      "createSiteAction",
      () => createSiteAction("Depot", 45, -75, 150),
      mocks.createSiteDal,
    ],
    [
      "updateSiteAction",
      () => updateSiteAction(3, "Depot", 45, -75, 150),
      mocks.updateSiteDal,
    ],
    ["deleteSiteAction", () => deleteSiteAction(3), mocks.deleteSiteDal],
  ] as const)("%s returns the failure reason", async (_name, action, dalFn) => {
    dalFn.mockResolvedValue(failure);
    await expect(action()).resolves.toEqual({ success: false, error: "nope" });
    expect(mocks.updateTag).not.toHaveBeenCalled();
  });
});

describe("searchAddressAction", () => {
  it("rejects unauthorized users or non-admins or without feature", async () => {
    mocks.protect.mockResolvedValue({
      userId: "u1",
      orgId: "o1",
      orgRole: "org:member",
      has: () => true,
    });
    await expect(searchAddressAction("111 Albert")).resolves.toEqual({
      success: false,
      error: "Unauthorized",
    });

    mocks.protect.mockResolvedValue({
      userId: "u1",
      orgId: "o1",
      orgRole: "org:admin",
      has: () => false,
    });
    await expect(searchAddressAction("111 Albert")).resolves.toEqual({
      success: false,
      error: "Unauthorized",
    });
  });

  it("returns address suggestions for authorized admins", async () => {
    mocks.protect.mockResolvedValue({
      userId: "u1",
      orgId: "o1",
      orgRole: "org:admin",
      has: (opts: { feature?: string; permission?: string }) =>
        opts?.feature === "geofencing",
    });
    const suggestions = [
      {
        formatted: "111 Albert St, Ottawa, ON",
        latitude: 45.4215,
        longitude: -75.6972,
      },
    ];
    mocks.searchAddress.mockResolvedValue(suggestions);

    await expect(searchAddressAction("111 Albert")).resolves.toEqual({
      success: true,
      data: suggestions,
    });
    expect(mocks.searchAddress).toHaveBeenCalledWith("111 Albert");
  });
});

describe("reverseGeocodeAction", () => {
  it("rejects unauthenticated users", async () => {
    mocks.protect.mockResolvedValue({ userId: null, orgId: null });
    await expect(reverseGeocodeAction(45.4215, -75.6972)).resolves.toEqual({
      success: false,
      error: "Unauthorized",
    });
  });

  it("returns resolved address for authenticated members", async () => {
    mocks.protect.mockResolvedValue({ userId: "u1", orgId: "o1" });
    mocks.reverseGeocode.mockResolvedValue("111 Albert St, Ottawa, ON");

    await expect(reverseGeocodeAction(45.4215, -75.6972)).resolves.toEqual({
      success: true,
      data: "111 Albert St, Ottawa, ON",
    });
    expect(mocks.reverseGeocode).toHaveBeenCalledWith({
      latitude: 45.4215,
      longitude: -75.6972,
    });
  });
});
