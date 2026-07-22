import { clerkClient } from "@clerk/nextjs/server";

export async function handleSubscriptionUpdate(orgId: string, plan: string) {
  // Placeholder for subscription update logic
  console.log(
    `Subscription update for organization ${orgId} with plan ${plan}`,
  );

  const clerk = await clerkClient();

  if (plan === "small_business_plan") {
    await clerk.organizations.updateOrganization(orgId, {
      maxAllowedMemberships: 3,
    });
  } else if (plan === "med_business_plan") {
    await clerk.organizations.updateOrganization(orgId, {
      maxAllowedMemberships: 7,
    });
  } else if (plan === "large_business_plan") {
    await clerk.organizations.updateOrganization(orgId, {
      maxAllowedMemberships: 15,
    });
  } else {
    await clerk.organizations.updateOrganization(orgId, {
      maxAllowedMemberships: 1,
    });
  }
}
