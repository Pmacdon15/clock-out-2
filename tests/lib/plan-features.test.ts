import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOrganizationBillingSubscription: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: vi.fn(async () => ({
    billing: {
      getOrganizationBillingSubscription:
        mocks.getOrganizationBillingSubscription,
    },
  })),
}));

import {
  orgHasPlanFeature,
  orgHasPlanFeatureStrict,
  SCHEDULING_FEATURE,
  TIME_OFF_FEATURE,
} from "@/lib/plan-features";

describe("orgHasPlanFeature", () => {
  beforeEach(() => {
    mocks.getOrganizationBillingSubscription.mockResolvedValue({
      subscriptionItems: [
        { plan: null },
        { plan: { features: [{ slug: SCHEDULING_FEATURE }] } },
        { plan: {} },
      ],
    });
  });

  it("finds a feature on any of the org's plans", async () => {
    await expect(orgHasPlanFeature("org_1", SCHEDULING_FEATURE)).resolves.toBe(
      true,
    );
    expect(mocks.getOrganizationBillingSubscription).toHaveBeenCalledWith(
      "org_1",
    );
  });

  it("reports a feature no plan includes", async () => {
    await expect(orgHasPlanFeature("org_1", TIME_OFF_FEATURE)).resolves.toBe(
      false,
    );
  });

  it("throws a billing error from the strict check", async () => {
    mocks.getOrganizationBillingSubscription.mockRejectedValue(
      new Error("clerk down"),
    );
    await expect(
      orgHasPlanFeatureStrict("org_1", SCHEDULING_FEATURE),
    ).rejects.toThrow("clerk down");
  });

  it("treats a billing error as not having the feature", async () => {
    mocks.getOrganizationBillingSubscription.mockRejectedValue(
      new Error("no subscription"),
    );
    await expect(orgHasPlanFeature("org_1", SCHEDULING_FEATURE)).resolves.toBe(
      false,
    );
  });
});
