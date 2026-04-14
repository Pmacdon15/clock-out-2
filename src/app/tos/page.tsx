import Link from 'next/link'
import { FileTextIcon, MailIcon } from '@/components/ui/Icons'

export default function TOSPage() {
	return (
		<main className="mx-auto max-w-3xl px-6 py-16 md:py-24">
			<div className="mb-12">
				<div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50">
					<FileTextIcon className="h-6 w-6" />
				</div>
				<h1 className="font-black text-4xl text-zinc-900 tracking-tight md:text-5xl dark:text-zinc-50">
					Terms of Service
				</h1>
				<p className="mt-4 text-lg text-zinc-500 dark:text-zinc-400">
					Last updated: April 13, 2026
				</p>
			</div>

			<div className="prose prose-zinc dark:prose-invert max-w-none">
				<section className="mb-12">
					<h2 className="font-bold text-2xl text-zinc-900 dark:text-zinc-50">
						1. Acceptance of Terms
					</h2>
					<p className="mt-4 text-zinc-600 dark:text-zinc-400">
						By accessing or using Clock Out, you agree to be bound
						by these Terms of Service. If you do not agree to any
						part of these terms, you may not use the service.
					</p>
				</section>

				<section className="mb-12">
					<h2 className="font-bold text-2xl text-zinc-900 dark:text-zinc-50">
						2. Use of the Service
					</h2>
					<p className="mt-4 text-zinc-600 dark:text-zinc-400">
						Clock Out is provided as a time-tracking tool for
						organizations and individuals. You are responsible for
						maintaining the security of your account and for all
						activities that occur under your account.
					</p>
				</section>

				<section className="mb-12">
					<h2 className="font-bold text-2xl text-zinc-900 dark:text-zinc-50">
						3. Data Integrity
					</h2>
					<p className="mt-4 text-zinc-600 dark:text-zinc-400">
						We strive for precision in time tracking. However, users
						are responsible for verifying their own logged hours and
						ensuring organization reports are accurate.
					</p>
				</section>

				<section className="mb-12">
					<h2 className="font-bold text-2xl text-zinc-900 dark:text-zinc-50">
						4. Modifications
					</h2>
					<p className="mt-4 text-zinc-600 dark:text-zinc-400">
						We reserve the right to modify or discontinue the
						service at any time. We will provide notice of
						significant changes to these terms.
					</p>
				</section>

				<section className="mb-12">
					<h2 className="font-bold text-2xl text-zinc-900 dark:text-zinc-50">
						5. Contact
					</h2>
					<p className="mt-4 text-zinc-600 dark:text-zinc-400">
						For any inquiries regarding these terms, please contact:
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
