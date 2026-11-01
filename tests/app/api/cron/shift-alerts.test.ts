// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ runShiftAlerts: vi.fn() }));
vi.mock("@/lib/alerts-runner", () => ({
  runShiftAlerts: mocks.runShiftAlerts,
}));

import { GET, POST } from "@/app/api/cron/shift-alerts/route";

const request = (auth?: string) =>
  new Request("https://example.test/api/cron/shift-alerts", {
    headers: auth ? { authorization: auth } : {},
  });

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "cron-secret");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("/api/cron/shift-alerts", () => {
  it("rejects requests without the cron secret", async () => {
    const res = await GET(request("Bearer wrong"));
    expect(res.status).toBe(401);
    expect(mocks.runShiftAlerts).not.toHaveBeenCalled();
  });

  it("runs the alerts and reports per-org results (GET and POST)", async () => {
    mocks.runShiftAlerts.mockResolvedValue([{ orgId: "org_1", status: "ok" }]);
    for (const handler of [GET, POST]) {
      const res = await handler(request("Bearer cron-secret"));
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({
        success: true,
        orgs: [{ orgId: "org_1", status: "ok" }],
      });
    }
  });

  it("returns 500 without leaking details when the run fails", async () => {
    mocks.runShiftAlerts.mockRejectedValue(new Error("secret detail"));
    const res = await GET(request("Bearer cron-secret"));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: "Failed to run shift alerts",
    });
  });
});
