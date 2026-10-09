// @vitest-environment node
import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { verifyWebhook, handleSubscriptionUpdate } = vi.hoisted(() => ({
  verifyWebhook: vi.fn(),
  handleSubscriptionUpdate: vi.fn(),
}));

vi.mock("@clerk/nextjs/webhooks", () => ({ verifyWebhook }));
vi.mock("@/lib/webhooks/clerk", () => ({ handleSubscriptionUpdate }));

import { POST } from "@/app/api/webhooks/clerk/route";

const request = new Request("https://example.test/api/webhooks/clerk", {
  method: "POST",
}) as unknown as NextRequest;

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("CLERK_WEBHOOK_SIGNING_SECRET", "whsec_test");
});

describe("POST /api/webhooks/clerk", () => {
  it("verifies the request with the signing secret", async () => {
    verifyWebhook.mockResolvedValue({ type: "user.created", data: {} });
    await POST(request);
    expect(verifyWebhook).toHaveBeenCalledWith(request, {
      signingSecret: "whsec_test",
    });
  });

  it.each([
    ["an Error", new Error("bad signature")],
    ["a non-Error value", "bad signature"],
  ])("returns 401 when verification throws %s", async (_label, thrown) => {
    verifyWebhook.mockRejectedValue(thrown);
    const res = await POST(request);
    expect(res.status).toBe(401);
    await expect(res.text()).resolves.toBe("Unauthorized");
    expect(console.error).toHaveBeenCalledWith("Error :", "bad signature");
  });

  it("updates the org's plan when a subscription item becomes active", async () => {
    verifyWebhook.mockResolvedValue({
      type: "subscriptionItem.active",
      data: {
        plan: { slug: "small_business_plan" },
        payer: { organization_id: "org_1" },
      },
    });
    const res = await POST(request);
    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toBe("Webhook received");
    expect(handleSubscriptionUpdate).toHaveBeenCalledWith(
      "org_1",
      "small_business_plan",
    );
  });

  it.each([
    ["no plan", { payer: { organization_id: "org_1" } }],
    ["no payer org", { plan: { slug: "small_business_plan" }, payer: {} }],
    ["an empty payload", {}],
  ])("ignores subscription events with %s", async (_label, data) => {
    verifyWebhook.mockResolvedValue({ type: "subscriptionItem.active", data });
    const res = await POST(request);
    expect(res.status).toBe(200);
    expect(handleSubscriptionUpdate).not.toHaveBeenCalled();
  });

  it("still acknowledges the webhook when handling fails", async () => {
    verifyWebhook.mockResolvedValue({
      type: "subscriptionItem.active",
      data: { plan: { slug: "x" }, payer: { organization_id: "org_1" } },
    });
    handleSubscriptionUpdate.mockRejectedValueOnce(new Error("clerk down"));
    const res = await POST(request);
    expect(res.status).toBe(200);
    expect(console.error).toHaveBeenCalledWith(
      "Error handling webhook event:",
      expect.any(Error),
    );
  });

  it("logs and acknowledges unhandled event types", async () => {
    verifyWebhook.mockResolvedValue({ type: "user.created", data: {} });
    const res = await POST(request);
    expect(res.status).toBe(200);
    expect(console.log).toHaveBeenCalledWith(
      "Unhandled event type: user.created",
    );
  });
});
