import { verifyWebhook } from '@clerk/nextjs/webhooks'
import type { NextRequest } from 'next/server'
import { handleSubscriptionUpdate } from '@/lib/webhooks/clerk'

export async function POST(req: NextRequest) {
	try {
		const evt = (await verifyWebhook(req, {
			signingSecret: process.env.CLERK_WEBHOOK_SIGNING_SECRET, // Added ! to ensure TS it exists
		})) as any // Using any or specific Clerk billing type if available

		console.log('Web Hook :', evt.type, ' ', evt.data)

		try {
			switch (evt.type) {
				case 'subscriptionItem.active': {
					const plan = evt.data.plan.slug
					const orgId = evt.data.payer?.organization_id

					if (orgId) {
						await handleSubscriptionUpdate(orgId, plan)
					}
					break // Break belongs inside the case, but outside the if/logic braces
				}

				default:
					console.log(`Unhandled event type: ${evt.type}`)
					break
			}
		} catch (error) {
			console.error('Error handling webhook event:', error)
		}

		return new Response('Webhook received', { status: 200 })
	} catch (err) {
		console.error('Error :', err instanceof Error ? err.message : err)
		return new Response('Unauthorized', { status: 401 })
	}
}
