import { err, ok } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  protect: vi.fn(),
  updateTag: vi.fn(),
  clockIn: vi.fn(),
  clockOut: vi.fn(),
  deleteTimeEntry: vi.fn(),
  updateTimeEntry: vi.fn(),
  updateReportingSettingsDal: vi.fn(),
  sendWeeklyReports: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: { protect: mocks.protect } }));
vi.mock("next/cache", () => ({ updateTag: mocks.updateTag }));
vi.mock("@/lib/dal", () => ({
  clockIn: mocks.clockIn,
  clockOut: mocks.clockOut,
  deleteTimeEntry: mocks.deleteTimeEntry,
  updateTimeEntry: mocks.updateTimeEntry,
  updateReportingSettingsDal: mocks.updateReportingSettingsDal,
}));
vi.mock("@/lib/reports", () => ({
  sendWeeklyReports: mocks.sendWeeklyReports,
}));

import {
  clockInAction,
  clockOutAction,
  deleteTimeEntryAction,
  sendCurrentWeekReportAction,
  updateOrgSettingAction,
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
