// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOrganizationList: vi.fn(),
  getOrganizationBillingSubscription: vi.fn(),
  dbGetReportingSettings: vi.fn(),
  sendWeeklyReports: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: vi.fn(async () => ({
    organizations: { getOrganizationList: mocks.getOrganizationList },
    billing: {
      getOrganizationBillingSubscription:
        mocks.getOrganizationBillingSubscription,
    },
  })),
}));
vi.mock("@/lib/db", () => ({
  dbGetReportingSettings: mocks.dbGetReportingSettings,
}));
vi.mock("@/lib/reports", () => ({
  sendWeeklyReports: mocks.sendWeeklyReports,
}));

import { GET } from "@/app/api/cron/weekly-report/route";

const reporting = {
  subscriptionItems: [
    { plan: null },
    { plan: { features: [{ slug: "reporting" }] } },
  ],
};

const cronRequest = (auth?: string) =>
  new Request("https://example.test/api/cron/weekly-report", {
    headers: auth ? { authorization: auth } : {},
  });

/** Runs the cron on the given UTC date for one org with the given settings. */
async function runOn(isoDate: string, settings?: object) {
  vi.setSystemTime(new Date(isoDate));
  mocks.dbGetReportingSettings.mockResolvedValue(settings);
  const res = await GET(cronRequest("Bearer cron-secret"));
  return res.json();
}

/** The [start, end, orgId, timeframe] the report was sent with, as ISO strings. */
function sentWith() {
  const [start, end, orgId, timeframe] = mocks.sendWeeklyReports.mock.calls[0];
  return [start.toISOString(), end.toISOString(), orgId, timeframe];
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.stubEnv("CRON_SECRET", "cron-secret");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.getOrganizationList.mockResolvedValue({
    data: [{ id: "org_1", name: "Acme" }],
  });
  mocks.getOrganizationBillingSubscription.mockResolvedValue(reporting);
  mocks.sendWeeklyReports.mockResolvedValue(true);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/cron/weekly-report", () => {
  it.each([
    ["a missing", undefined],
    ["a wrong", "Bearer nope"],
  ])("rejects %s authorization header", async (_label, auth) => {
    const res = await GET(cronRequest(auth));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mocks.getOrganizationList).not.toHaveBeenCalled();
  });

  it("skips orgs without billing or without the reporting feature", async () => {
    mocks.getOrganizationList.mockResolvedValue({
      data: [
        { id: "org_a", name: "No billing" },
        { id: "org_b", name: "No feature" },
      ],
    });
    mocks.getOrganizationBillingSubscription
      .mockRejectedValueOnce(new Error("no subscription"))
      .mockResolvedValueOnce({
        subscriptionItems: [{ plan: { features: [{ slug: "other" }] } }],
      });

    const body = await runOn("2026-01-08T06:00:00Z");

    expect(body).toMatchObject({ success: true, processedCount: 0 });
    expect(mocks.getOrganizationList).toHaveBeenCalledWith({ limit: 100 });
    expect(mocks.dbGetReportingSettings).not.toHaveBeenCalled();
  });

  describe("weekly (default) frequency", () => {
    it.each([
      ["2026-03-01T06:00:00Z", "2026-02-24T00:00:00.000Z"],
      ["2026-03-08T06:00:00Z", "2026-03-01T00:00:00.000Z"],
      ["2026-03-16T06:00:00Z", "2026-03-08T00:00:00.000Z"],
      ["2026-03-24T06:00:00Z", "2026-03-16T00:00:00.000Z"],
    ])("on %s sends the period starting %s", async (today, start) => {
      const body = await runOn(today);
      expect(sentWith()).toEqual([
        start,
        `${today.slice(0, 10)}T00:00:00.000Z`,
        "org_1",
        "week",
      ]);
      expect(body).toMatchObject({
        processedCount: 1,
        processed: [{ org: "Acme", status: "sent", frequency: "weekly" }],
        date: new Date(today).toISOString(),
      });
    });

    it("sends nothing on other days", async () => {
      const body = await runOn("2026-03-05T06:00:00Z", {
        report_frequency: "weekly",
      });
      expect(mocks.sendWeeklyReports).not.toHaveBeenCalled();
      expect(body.processedCount).toBe(0);
    });
  });

  describe("twice-monthly frequency", () => {
    const settings = { report_frequency: "twice-monthly" };

    it("on the 16th sends the first half of the month", async () => {
      await runOn("2026-03-16T06:00:00Z", settings);
      expect(sentWith()).toEqual([
        "2026-03-01T00:00:00.000Z",
        "2026-03-16T00:00:00.000Z",
        "org_1",
        "custom",
      ]);
    });

    it("on the 1st sends the second half of last month", async () => {
      await runOn("2026-03-01T06:00:00Z", settings);
      expect(sentWith()[0]).toBe("2026-02-16T00:00:00.000Z");
    });

    it("sends nothing on other days", async () => {
      await runOn("2026-03-08T06:00:00Z", settings);
      expect(mocks.sendWeeklyReports).not.toHaveBeenCalled();
    });
  });

  describe("custom weekday frequency", () => {
    // 2026-01-06 is a Tuesday in an even week; 2026-01-13 is a Tuesday in an odd week.
    const custom = (report_day: string, report_interval?: number) => ({
      report_frequency: "custom",
      report_day,
      report_interval,
    });

    it("weekly on the chosen day sends the last 7 days", async () => {
      await runOn("2026-01-13T06:00:00Z", custom("Tuesday", 1));
      expect(sentWith()).toEqual([
        "2026-01-06T00:00:00.000Z",
        "2026-01-13T00:00:00.000Z",
        "org_1",
        "week",
      ]);
    });

    it("defaults to a weekly interval", async () => {
      await runOn("2026-01-13T06:00:00Z", custom("Tuesday"));
      expect(sentWith()[0]).toBe("2026-01-06T00:00:00.000Z");
    });

    it("bi-weekly sends the last 14 days in even weeks", async () => {
      await runOn("2026-01-06T06:00:00Z", custom("Tuesday", 2));
      expect(sentWith()[0]).toBe("2025-12-23T00:00:00.000Z");
    });

    it("bi-weekly sends nothing in odd weeks", async () => {
      await runOn("2026-01-13T06:00:00Z", custom("Tuesday", 2));
      expect(mocks.sendWeeklyReports).not.toHaveBeenCalled();
    });

    it("sends nothing for unsupported intervals", async () => {
      await runOn("2026-01-06T06:00:00Z", custom("Tuesday", 3));
      expect(mocks.sendWeeklyReports).not.toHaveBeenCalled();
    });

    it("sends nothing on other weekdays", async () => {
      await runOn("2026-01-06T06:00:00Z", custom("Friday", 1));
      expect(mocks.sendWeeklyReports).not.toHaveBeenCalled();
    });
  });

  it("sends nothing when reports are turned off", async () => {
    await runOn("2026-03-01T06:00:00Z", { report_frequency: "off" });
    expect(mocks.sendWeeklyReports).not.toHaveBeenCalled();
  });

  it("records a failure and keeps going when sending throws", async () => {
    mocks.sendWeeklyReports.mockRejectedValue(new Error("ses down"));
    const body = await runOn("2026-03-08T06:00:00Z");
    expect(body.processed).toEqual([
      { org: "Acme", status: "error", error: {} },
    ]);
    expect(console.error).toHaveBeenCalled();
  });
});
