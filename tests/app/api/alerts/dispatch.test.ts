// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isQStashConfigured: vi.fn(),
  verifyQStashSignature: vi.fn(),
  runAlertJob: vi.fn(),
}));

// Only the real parser is used; nothing behind it is reached.
vi.mock("@/lib/db", () => ({}));
vi.mock("@/lib/alerts-db", () => ({}));
vi.mock("@/lib/alerts-runner", () => ({}));
vi.mock("@/lib/schedule-notify", () => ({}));
vi.mock("@/lib/notify", () => ({}));
vi.mock("@/lib/alert-jobs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/alert-jobs")>();
  return {
    // The real parser, so the route is tested against real bodies.
    parseAlertJob: actual.parseAlertJob,
    isQStashConfigured: mocks.isQStashConfigured,
    verifyQStashSignature: mocks.verifyQStashSignature,
    runAlertJob: mocks.runAlertJob,
  };
});

import { POST } from "@/app/api/alerts/dispatch/route";

const job = { type: "shift-alerts", orgId: "org_1", runAt: 1_700_000_000_000 };
const deliver = (body: string, signature: string | null = "sig") =>
  POST(
    new Request("https://clock.test/api/alerts/dispatch", {
      method: "POST",
      body,
      headers: signature ? { "upstash-signature": signature } : {},
    }),
  );

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.isQStashConfigured.mockReturnValue(true);
  mocks.verifyQStashSignature.mockResolvedValue(true);
  mocks.runAlertJob.mockResolvedValue({ type: "shift-alerts", sent: 1 });
});

describe("/api/alerts/dispatch", () => {
  it("is unavailable until QStash is configured", async () => {
    mocks.isQStashConfigured.mockReturnValue(false);
    const res = await deliver(JSON.stringify(job));
    expect(res.status).toBe(503);
    expect(mocks.runAlertJob).not.toHaveBeenCalled();
  });

  it("rejects deliveries without a valid signature", async () => {
    mocks.verifyQStashSignature.mockResolvedValue(false);
    const res = await deliver(JSON.stringify(job), null);
    expect(res.status).toBe(401);
    expect(mocks.verifyQStashSignature).toHaveBeenCalledWith(
      null,
      JSON.stringify(job),
    );
    expect(mocks.runAlertJob).not.toHaveBeenCalled();
  });

  it("refuses a signed body it doesn't understand, without a retry", async () => {
    const res = await deliver(JSON.stringify({ type: "mystery" }));
    expect(res.status).toBe(400);
    expect(mocks.runAlertJob).not.toHaveBeenCalled();
  });

  it("runs a verified job", async () => {
    const body = JSON.stringify(job);
    const res = await deliver(body);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      success: true,
      type: "shift-alerts",
      sent: 1,
    });
    expect(mocks.verifyQStashSignature).toHaveBeenCalledWith("sig", body);
    expect(mocks.runAlertJob).toHaveBeenCalledWith(job);
  });

  it("answers 500 so QStash retries a failed job, without leaking details", async () => {
    mocks.runAlertJob.mockRejectedValue(new Error("secret detail"));
    const res = await deliver(JSON.stringify(job));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("secret detail");
    expect(console.error).toHaveBeenCalledWith(
      "[Dispatch] shift-alerts job failed:",
      expect.any(Error),
    );
  });
});
