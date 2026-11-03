// @vitest-environment node
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
  createFeatureCheck,
  NOTIFICATIONS_FEATURE,
  orgHasFeature,
} from "@/lib/billing";

const subscription = (...slugs: string[]) => ({
  subscriptionItems: [
    { plan: null },
    { plan: { features: slugs.map((slug) => ({ slug })) } },
  ],
});

beforeEach(() => {
  mocks.getOrganizationBillingSubscription.mockResolvedValue(
    subscription("reporting", NOTIFICATIONS_FEATURE),
  );
});

describe("orgHasFeature", () => {
  it("finds a feature on any subscription item", async () => {
    await expect(orgHasFeature("org_1", "notifications")).resolves.toBe(true);
    expect(mocks.getOrganizationBillingSubscription).toHaveBeenCalledWith(
      "org_1",
    );
  });

  it("is false when the plan lacks the feature", async () => {
    await expect(orgHasFeature("org_1", "geofencing")).resolves.toBe(false);
  });

  it("is false for an org without billing", async () => {
    mocks.getOrganizationBillingSubscription.mockRejectedValue(
      new Error("not found"),
    );
    await expect(orgHasFeature("org_1", "notifications")).resolves.toBe(false);
  });
});

describe("createFeatureCheck", () => {
  it("asks Clerk about each org once", async () => {
    const check = createFeatureCheck(NOTIFICATIONS_FEATURE);
    await expect(check("org_1")).resolves.toBe(true);
    await expect(check("org_1")).resolves.toBe(true);
    mocks.getOrganizationBillingSubscription.mockResolvedValue(subscription());
    await expect(check("org_2")).resolves.toBe(false);
    expect(mocks.getOrganizationBillingSubscription).toHaveBeenCalledTimes(2);
  });
});
