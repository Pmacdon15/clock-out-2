import {
	OrganizationSwitcher,
	Show,
	SignInButton,
	UserButton,
} from '@clerk/nextjs'
import { dark } from '@clerk/ui/themes'
import Link from 'next/link'

import { Suspense } from 'react'

export default function MainPageHeader() {
	return (
		<header className="mb-12 flex flex-col items-center justify-between gap-4 border-zinc-200 border-b pb-6 md:flex-row dark:border-zinc-800">
			<div>
				<h1 className="font-bold text-3xl tracking-tight">Clock Out</h1>
				<p className="mt-1 text-muted-foreground">
					Efficient time tracking for professional teams.
				</p>
			</div>
			<div className="flex items-center gap-6">
				<Link
					className="font-medium text-sm text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
					href="/plans"
				>
					Plans
				</Link>
				<Suspense>
					<Show when="signed-in">
						<OrganizationSwitcher
							appearance={{
								theme: dark,
								elements: {
									organizationSwitcherTrigger:
										'py-1.5 px-3 border border-zinc-200 dark:border-zinc-800 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors',
								},
							}}
						/>
						<UserButton
							appearance={{
								theme: dark,
							}}
						/>
					</Show>
					<Show when="signed-out">
						<SignInButton>
							<button
								className="rounded-md bg-zinc-900 px-4 py-2 text-zinc-50 transition-colors hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
								type="button"
							>
								Sign In
							</button>
						</SignInButton>
					</Show>
				</Suspense>
			</div>
		</header>
	)
}
