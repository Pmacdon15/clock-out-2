import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateOrganization } = vi.hoisted(() => ({
  updateOrganization: vi.fn(),
}));
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: vi.fn(async () => ({ organizations: { updateOrganization } })),
}));

import { handleSubscriptionUpdate } from "@/lib/webhooks/clerk";

describe("handleSubscriptionUpdate", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it.each([
    ["small_business_plan", 3],
    ["med_business_plan", 7],
    ["large_business_plan", 15],
    ["free_user", 1],
  ])("sets the membership limit for %s to %i", async (plan, limit) => {
    await handleSubscriptionUpdate("org_1", plan);
    expect(updateOrganization).toHaveBeenCalledWith("org_1", {
      maxAllowedMemberships: limit,
    });
  });
});
