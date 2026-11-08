import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateOrganization, getOrganizationBillingSubscription } = vi.hoisted(
  () => ({
    updateOrganization: vi.fn(),
    getOrganizationBillingSubscription: vi.fn(),
  }),
);
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: vi.fn(async () => ({
    organizations: { updateOrganization },
    billing: { getOrganizationBillingSubscription },
  })),
}));

import {
  handleSubscriptionUpdate,
  memberLimitForItems,
  syncMembershipLimit,
} from "@/lib/webhooks/clerk";

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

describe("memberLimitForItems", () => {
  const now = 1_800_000_000_000;
  const item = (status: string, slug: string, periodEnd?: number | null) => ({
    status,
    plan: { slug },
    periodEnd: periodEnd ?? null,
  });

  it("uses the largest plan among active items", () => {
    expect(
      memberLimitForItems(
        [
          item("active", "small_business_plan"),
          item("active", "large_business_plan"),
        ],
        now,
      ),
    ).toBe(15);
  });

  it.each(["ended", "past_due", "abandoned", "incomplete", "upcoming"])(
    "drops to the free limit when the paid item is %s",
    (status) => {
      expect(
        memberLimitForItems([item(status, "large_business_plan")], now),
      ).toBe(1);
    },
  );

  it("keeps a canceled plan until its paid period ends", () => {
    expect(
      memberLimitForItems(
        [item("canceled", "med_business_plan", now + 1000)],
        now,
      ),
    ).toBe(7);
    expect(
      memberLimitForItems(
        [item("canceled", "med_business_plan", now - 1000)],
        now,
      ),
    ).toBe(1);
  });

  it("is the free limit with no items", () => {
    expect(memberLimitForItems([], now)).toBe(1);
  });
});

describe("syncMembershipLimit", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    updateOrganization.mockClear();
  });

  it("sets the cap from the live subscription", async () => {
    getOrganizationBillingSubscription.mockResolvedValueOnce({
      subscriptionItems: [
        { status: "ended", plan: { slug: "large_business_plan" } },
        { status: "active", plan: { slug: "free_user" } },
      ],
    });
    await expect(syncMembershipLimit("org_1")).resolves.toBe(1);
    expect(updateOrganization).toHaveBeenCalledWith("org_1", {
      maxAllowedMemberships: 1,
    });
  });

  it("throws, without changing the cap, when billing can't be read", async () => {
    getOrganizationBillingSubscription.mockRejectedValueOnce(new Error("down"));
    await expect(syncMembershipLimit("org_1")).rejects.toThrow("down");
    expect(updateOrganization).not.toHaveBeenCalled();
  });
});
