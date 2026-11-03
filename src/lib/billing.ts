import { clerkClient } from "@clerk/nextjs/server";

/** Clerk billing feature slug that unlocks email and push notifications. */
export const NOTIFICATIONS_FEATURE = "notifications";

/**
 * Whether an org's Clerk billing subscription includes a feature. For code
 * with no signed-in request (crons, background sends), where `auth().has()`
 * isn't available. No subscription, or a billing error, means no feature.
 */
export async function orgHasFeature(
  orgId: string,
  feature: string,
): Promise<boolean> {
  try {
    const client = await clerkClient();
    const subscription =
      await client.billing.getOrganizationBillingSubscription(orgId);
    return subscription.subscriptionItems.some(
      (item: { plan?: { features?: { slug: string }[] } | null }) =>
        item.plan?.features?.some((f) => f.slug === feature) ?? false,
    );
  } catch (_error) {
    return false;
  }
}

/**
 * {@link orgHasFeature} remembered per org, so one cron pass asks Clerk about
 * each org at most once.
 */
export function createFeatureCheck(
  feature: string,
): (orgId: string) => Promise<boolean> {
  const cache = new Map<string, Promise<boolean>>();
  return (orgId) => {
    let result = cache.get(orgId);
    if (!result) {
      result = orgHasFeature(orgId, feature);
      cache.set(orgId, result);
    }
    return result;
  };
}
