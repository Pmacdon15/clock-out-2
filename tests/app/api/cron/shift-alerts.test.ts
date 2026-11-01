// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runShiftAlerts: vi.fn(),
  runWeeklyScheduleDigests: vi.fn(),
}));
vi.mock("@/lib/alerts-runner", () => ({
  runShiftAlerts: mocks.runShiftAlerts,
}));
vi.mock("@/lib/schedule-notify", () => ({
  runWeeklyScheduleDigests: mocks.runWeeklyScheduleDigests,
}));

import { GET, POST } from "@/app/api/cron/shift-alerts/route";

const request = (auth?: string) =>
  new Request("https://example.test/api/cron/shift-alerts", {
    headers: auth ? { authorization: auth } : {},
  });

const digests = { digests: 1, emails: 1, pushes: 0 };

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "cron-secret");
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.runShiftAlerts.mockResolvedValue([{ orgId: "org_1", status: "ok" }]);
  mocks.runWeeklyScheduleDigests.mockResolvedValue(digests);
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
      });
    }
    expect(mocks.runShiftAlerts.mock.calls[0][0]).toBe(
      mocks.runWeeklyScheduleDigests.mock.calls[0][0],
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
});
