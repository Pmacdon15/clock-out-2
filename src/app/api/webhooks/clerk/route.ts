import type { WebhookEvent } from "@clerk/nextjs/server";
import { verifyWebhook } from "@clerk/nextjs/webhooks";
import type { NextRequest } from "next/server";
import { syncMembershipLimit } from "@/lib/webhooks/clerk";

/** The organization a billing event is for, or null for a user's own billing. */
function billingEventOrgId(data: unknown): string | null {
  const d = data as {
    payer?: { organization_id?: string | null } | null;
  };
  return d.payer?.organization_id ?? null;
}

export async function POST(req: NextRequest) {
  let evt: WebhookEvent;
  try {
    evt = (await verifyWebhook(req, {
      signingSecret: process.env.CLERK_WEBHOOK_SIGNING_SECRET,
    })) as WebhookEvent;
  } catch (err) {
    console.error("Error :", err instanceof Error ? err.message : err);
    return new Response("Unauthorized", { status: 401 });
  }

  // Log the event type only: the payload carries payer emails and billing data.
  console.log("Web Hook :", evt.type);

  // Every subscription and subscription item event (active, canceled, ended,
  // past due, updated, ...) recomputes the member cap from the org's live
  // subscription, so cancellations and downgrades lower it too.
  if (
    evt.type.startsWith("subscription.") ||
    evt.type.startsWith("subscriptionItem.")
  ) {
    const orgId = billingEventOrgId(evt.data);
    if (!orgId) {
      return new Response("Webhook received", { status: 200 });
    }
    try {
      await syncMembershipLimit(orgId);
    } catch (error) {
      console.error("Error handling webhook event:", error);
      // A non-2xx response makes Clerk retry, so a transient billing API
      // error can't leave the org on a cap it no longer pays for.
      return new Response("Couldn't sync the membership limit", {
        status: 500,
      });
    }
    return new Response("Webhook received", { status: 200 });
  }

  console.log(`Unhandled event type: ${evt.type}`);
  return new Response("Webhook received", { status: 200 });
}
