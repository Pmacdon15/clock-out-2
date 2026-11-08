import { clerkClient } from "@clerk/nextjs/server";

/** Member cap for each paid plan; anything else is the free plan's single seat. */
const PLAN_MEMBER_LIMITS: Record<string, number> = {
  small_business_plan: 3,
  med_business_plan: 7,
  large_business_plan: 15,
};
const FREE_MEMBER_LIMIT = 1;

export function memberLimitForPlan(plan: string | null | undefined) {
  return (plan && PLAN_MEMBER_LIMITS[plan]) || FREE_MEMBER_LIMIT;
}

export async function handleSubscriptionUpdate(orgId: string, plan: string) {
  console.log(
    `Subscription update for organization ${orgId} with plan ${plan}`,
  );

  const clerk = await clerkClient();
  await clerk.organizations.updateOrganization(orgId, {
    maxAllowedMemberships: memberLimitForPlan(plan),
  });
}

type SubscriptionItemLike = {
  status?: string | null;
  plan?: { slug?: string | null } | null;
  periodEnd?: number | null;
};

/**
 * Whether a subscription item still pays for its plan's seats. A canceled
 * item keeps its plan until the paid period ends (Clerk then sends
 * `subscriptionItem.ended`); past-due, ended, abandoned, incomplete and
 * upcoming items don't count.
 */
function isEntitled(item: SubscriptionItemLike, now: number) {
  if (item.status === "active" || item.status === "free_trial") return true;
  if (item.status === "canceled") {
    return typeof item.periodEnd === "number" && item.periodEnd > now;
  }
  return false;
}

/** The member cap the org's current subscription items pay for. */
export function memberLimitForItems(
  items: SubscriptionItemLike[],
  now = Date.now(),
) {
  return items
    .filter((item) => isEntitled(item, now))
    .reduce(
      (max, item) => Math.max(max, memberLimitForPlan(item.plan?.slug)),
      FREE_MEMBER_LIMIT,
    );
}

/**
 * Sets the org's member cap from its live Clerk subscription, so every
 * billing event (activation, cancellation, downgrade, past due, ...)
 * converges on what the org currently pays for, even if events arrive out
 * of order or one was missed. Throws when Clerk can't be reached, so the
 * webhook can ask Clerk to retry.
 */
export async function syncMembershipLimit(orgId: string) {
  const clerk = await clerkClient();
  const subscription =
    await clerk.billing.getOrganizationBillingSubscription(orgId);
  const limit = memberLimitForItems(
    subscription.subscriptionItems as SubscriptionItemLike[],
  );
  console.log(`[Webhook] membership limit for ${orgId} set to ${limit}`);
  await clerk.organizations.updateOrganization(orgId, {
    maxAllowedMemberships: limit,
  });
  return limit;
}
