'use client'

import { PricingTable } from '@clerk/nextjs'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'

export default function PlansPage() {
	return (
		<main className="min-h-screen bg-zinc-50 px-4 py-12 md:py-24 dark:bg-zinc-950">
			<div className="mx-auto max-w-6xl">
				<div className="mb-12">
					<Link
						className="inline-flex items-center gap-2 font-medium text-sm text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
						href="/"
					>
						<ArrowLeft className="h-4 w-4" />
						Back to Dashboard
					</Link>
				</div>

				<div className="mb-16 text-center">
					<h1 className="mb-4 font-black text-4xl tracking-tight md:text-6xl">
						Simple, Transparent Pricing.
					</h1>
					<p className="mx-auto max-w-2xl text-xl text-zinc-500 dark:text-zinc-400">
						Choose the plan that's right for your team's workflow.
						All plans include our core time tracking features.
					</p>
				</div>

				<div className="gap-8">
					<PricingTable for="organization" />
					<div className="mt-20 text-center text-sm text-zinc-500 dark:text-zinc-400">
						<p>
							Questions? Contact us at{' '}
							<span className="cursor-pointer underline">
								patrick@patmac.ca
							</span>
						</p>
					</div>
				</div>
			</div>
		</main>
	)
}
