import { clerkClient } from "@clerk/nextjs/server";

/*
 * Clerk Billing feature slugs for the paid parts of Clock Out. Each slug must
 * exist in the Clerk dashboard and be attached to the plans that include it.
 */

/** Unlocks location capture and geofencing on punches. */
export const GEOFENCING_FEATURE = "geofencing" as const;
/** Unlocks weekly email reports. */
export const REPORTING_FEATURE = "reporting" as const;
/** Unlocks the Schedule page: publishing shifts, reminders and digests. */
export const SCHEDULING_FEATURE = "scheduling" as const;

/** Unlocks the Time Off page: requests, approvals and PTO allowances. */
export const TIME_OFF_FEATURE = "time_off" as const;

export const SCHEDULING_UPGRADE_REASON =
  "Scheduling is only available on paid plans. Upgrade your organization to unlock it.";

export const TIME_OFF_UPGRADE_REASON =
  "Time off is only available on paid plans. Upgrade your organization to unlock it.";

/**
 * Whether an org's plan includes a feature, for code with no signed-in
 * session to ask (cron jobs, MCP). Any billing error counts as "no", the same
 * way a session without the feature does.
 */
export async function orgHasPlanFeature(
  orgId: string,
  slug: string,
): Promise<boolean> {
  try {
    const client = await clerkClient();
    const subscription =
      await client.billing.getOrganizationBillingSubscription(orgId);
    return subscription.subscriptionItems.some(
      (item: { plan?: { features?: { slug: string }[] } | null }) =>
        item.plan?.features?.some((f) => f.slug === slug),
    );
  } catch {
    return false;
  }
}
