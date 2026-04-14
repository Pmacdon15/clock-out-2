import Link from 'next/link'
import { MailIcon, ShieldIcon } from '@/components/ui/Icons'

export default function PrivacyPage() {
	return (
		<main className="mx-auto max-w-3xl px-6 py-16 md:py-24">
			<div className="mb-12">
				<div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400">
					<ShieldIcon className="h-6 w-6" />
				</div>
				<h1 className="font-black text-4xl text-zinc-900 tracking-tight md:text-5xl dark:text-zinc-50">
					Privacy Policy
				</h1>
				<p className="mt-4 text-lg text-zinc-500 dark:text-zinc-400">
					Last updated: April 13, 2026
				</p>
			</div>

			<div className="prose prose-zinc dark:prose-invert max-w-none">
				<section className="mb-12">
					<h2 className="font-bold text-2xl text-zinc-900 dark:text-zinc-50">
						Our Data Commitment
					</h2>
					<div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50/50 p-6 dark:border-blue-900/30 dark:bg-blue-900/10">
						<p className="m-0 font-medium text-blue-900 dark:text-blue-100">
							We value your trust. Our policy is simple:
							<strong className="mt-2 block">
								We do not sell your data. We do not use your
								data for AI training. We only share data with
								essential service providers necessary for the
								application to function.
							</strong>
						</p>
					</div>
				</section>

				<section className="mb-12">
					<h2 className="font-bold text-2xl text-zinc-900 dark:text-zinc-50">
						1. Data Collection
					</h2>
					<p className="mt-4 text-zinc-600 dark:text-zinc-400">
						We collect information you provide directly to us, such
						as when you create an account, log time entries, or
						communicate with us. This includes your name, email
						address, organization details, and time tracking data.
					</p>
				</section>

				<section className="mb-12">
					<h2 className="font-bold text-2xl text-zinc-900 dark:text-zinc-50">
						2. Data Usage
					</h2>
					<p className="mt-4 text-zinc-600 dark:text-zinc-400">
						Your data is used solely to provide the Clock Out
						service, including tracking hours, generating reports,
						and managing organization memberships.
					</p>
				</section>

				<section className="mb-12">
					<h2 className="font-bold text-2xl text-zinc-900 dark:text-zinc-50">
						3. Data Sharing
					</h2>
					<p className="mt-4 text-zinc-600 dark:text-zinc-400">
						We only share your data with third-party vendors
						necessary for business functions:
					</p>
					<ul className="mt-4 list-disc pl-6 text-zinc-600 dark:text-zinc-400">
						<li>
							<strong>Clerk:</strong> For authentication and user
							management.
						</li>
						<li>
							<strong>Neon:</strong> For hosted database storage.
						</li>
						<li>
							<strong>Resend:</strong> For sending automated email
							reports.
						</li>
						<li>
							<strong>Vercel:</strong> For hosting the
							application.
						</li>
					</ul>
				</section>

				<section className="mb-12">
					<h2 className="font-bold text-2xl text-zinc-900 dark:text-zinc-50">
						4. Contact Us
					</h2>
					<p className="mt-4 text-zinc-600 dark:text-zinc-400">
						If you have any questions about this Privacy Policy,
						please contact Patrick MacDonald at:
					</p>
					<div className="mt-4 flex items-center gap-2 text-zinc-900 dark:text-zinc-50">
						<MailIcon className="h-5 w-5 text-zinc-400" />
						<a
							className="font-medium underline underline-offset-4"
							href="mailto:patrick@patmac.ca"
						>
							patrick@patmac.ca
						</a>
					</div>
				</section>
			</div>

			<div className="mt-20 border-zinc-200 border-t pt-8 dark:border-zinc-800">
				<Link
					className="font-medium text-sm text-zinc-900 transition-colors hover:text-blue-600 dark:text-zinc-50 dark:hover:text-blue-400"
					href="/"
				>
					&larr; Back to Dashboard
				</Link>
			</div>
		</main>
	)
}
