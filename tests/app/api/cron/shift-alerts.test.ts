// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runShiftAlerts: vi.fn(),
  runWeeklyScheduleDigests: vi.fn(),
  runUpcomingShiftReminders: vi.fn(),
  scheduleAllAlertJobs: vi.fn(),
  dbPruneStaleFcmTokens: vi.fn(),
}));
vi.mock("@/lib/alert-jobs", () => ({
  scheduleAllAlertJobs: mocks.scheduleAllAlertJobs,
}));
vi.mock("@/lib/alerts-db", () => ({
  dbPruneStaleFcmTokens: mocks.dbPruneStaleFcmTokens,
}));
vi.mock("@/lib/alerts-runner", () => ({
  runShiftAlerts: mocks.runShiftAlerts,
}));
vi.mock("@/lib/schedule-notify", () => ({
  runWeeklyScheduleDigests: mocks.runWeeklyScheduleDigests,
  runUpcomingShiftReminders: mocks.runUpcomingShiftReminders,
}));

import { GET, POST } from "@/app/api/cron/shift-alerts/route";

const request = (auth?: string) =>
  new Request("https://example.test/api/cron/shift-alerts", {
    headers: auth ? { authorization: auth } : {},
  });

const digests = { digests: 1, emails: 1, pushes: 0 };
const reminders = { reminders: 2, emails: 2, pushes: 1 };
const jobs = { orgs: 1, reminders: 3, digests: 2 };

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "cron-secret");
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.runShiftAlerts.mockResolvedValue([{ orgId: "org_1", status: "ok" }]);
  mocks.runWeeklyScheduleDigests.mockResolvedValue(digests);
  mocks.runUpcomingShiftReminders.mockResolvedValue(reminders);
  mocks.scheduleAllAlertJobs.mockResolvedValue(jobs);
  mocks.dbPruneStaleFcmTokens.mockResolvedValue(4);
});

describe("/api/cron/shift-alerts", () => {
  it("rejects requests without the cron secret", async () => {
    const res = await GET(request("Bearer wrong"));
    expect(res.status).toBe(401);
    expect(mocks.runShiftAlerts).not.toHaveBeenCalled();
    expect(mocks.runWeeklyScheduleDigests).not.toHaveBeenCalled();
  });

  it("runs alerts and weekly schedules with the same clock (GET and POST)", async () => {
    for (const handler of [GET, POST]) {
      const res = await handler(request("Bearer cron-secret"));
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({
        success: true,
        orgs: [{ orgId: "org_1", status: "ok" }],
        schedules: digests,
        reminders,
        jobs,
        prunedTokens: 4,
      });
    }
    // The sweep schedules the exactly-timed jobs from the same clock.
    expect(mocks.scheduleAllAlertJobs.mock.calls[0][0]).toBe(
      mocks.runShiftAlerts.mock.calls[0][0],
    );
    expect(mocks.dbPruneStaleFcmTokens).toHaveBeenCalledWith(240);
    expect(mocks.runShiftAlerts.mock.calls[0][0]).toBe(
      mocks.runWeeklyScheduleDigests.mock.calls[0][0],
    );
    expect(mocks.runUpcomingShiftReminders.mock.calls[0][0]).toBe(
      mocks.runShiftAlerts.mock.calls[0][0],
    );
  });

  it("still sends schedules when alerts fail, and reports a 500", async () => {
    mocks.runShiftAlerts.mockRejectedValue(new Error("secret detail"));
    const res = await GET(request("Bearer cron-secret"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toMatchObject({
      success: false,
      orgs: null,
      schedules: digests,
      error: "Some jobs failed; see logs",
    });
    expect(JSON.stringify(body)).not.toContain("secret detail");
  });

  it("still runs alerts when schedules fail", async () => {
    mocks.runWeeklyScheduleDigests.mockRejectedValue(new Error("db"));
    const res = await GET(request("Bearer cron-secret"));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({
      orgs: [{ orgId: "org_1", status: "ok" }],
      schedules: null,
    });
  });

  it("still runs the other jobs when reminders fail", async () => {
    mocks.runUpcomingShiftReminders.mockRejectedValue(new Error("db"));
    const res = await GET(request("Bearer cron-secret"));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({
      orgs: [{ orgId: "org_1", status: "ok" }],
      schedules: digests,
      reminders: null,
    });
  });

  it("still runs everything else when scheduling or token cleanup fail", async () => {
    mocks.scheduleAllAlertJobs.mockRejectedValue(new Error("qstash"));
    mocks.dbPruneStaleFcmTokens.mockRejectedValue(new Error("db"));
    const res = await GET(request("Bearer cron-secret"));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({
      orgs: [{ orgId: "org_1", status: "ok" }],
      reminders,
      jobs: null,
      prunedTokens: null,
    });
    expect(console.error).toHaveBeenCalledWith(
      "[Cron] Alert scheduling failed:",
      expect.any(Error),
    );
  });
});
