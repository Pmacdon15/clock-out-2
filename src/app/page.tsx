import { Show, SignInButton } from '@clerk/nextjs'
import { Suspense } from 'react'
import DashboardTabs from '@/components/DashboardTabs'
import MainPageHeader from '@/components/headers/main-page-header'
import { getAuthSession, getOrgMembers, getTimeEntries } from '@/lib/dal'

export default function Home(props: PageProps<'/'>) {
	const userIdPromise = props.searchParams.then((params) =>
		Array.isArray(params.userId) ? params.userId[0] : params.userId,
	)

	const defaultTabPromise = props.searchParams.then((params) =>
		Array.isArray(params.defaultTab)
			? params.defaultTab[0]
			: params.defaultTab,
	)

	const selectedWeekPromise = props.searchParams.then((params) =>
		Array.isArray(params.week) ? params.week[0] : params.week,
	)

	const selectedMonthPromise = props.searchParams.then((params) =>
		Array.isArray(params.month) ? params.month[0] : params.month,
	)

	const selectedYearPromise = props.searchParams.then((params) =>
		Array.isArray(params.year) ? params.year[0] : params.year,
	)

	const timeframePromise = props.searchParams.then((params) =>
		Array.isArray(params.timeframe)
			? params.timeframe[0]
			: params.timeframe,
	)

	const timeEntriesPromise = props.searchParams.then((params) =>
		getTimeEntries(
			Array.isArray(params.userId) ? params.userId[0] : params.userId,
		),
	)

	// Add the parentheses here:
	const isAdminPromise = getAuthSession()
	const membersPromise = getOrgMembers()

	return (
		<main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-8">
			<MainPageHeader />
			<Suspense>
				<Show when="signed-in">
					<Suspense fallback={<DashboardSkeleton />}>
						<DashboardTabs
							defaultTabPromise={defaultTabPromise}
							entriesPromise={timeEntriesPromise}
							isAdminPromise={isAdminPromise}
							membersPromise={membersPromise}
							selectedMonthPromise={selectedMonthPromise}
							selectedUserIdPromise={userIdPromise}
							selectedWeekPromise={selectedWeekPromise}
							selectedYearPromise={selectedYearPromise}
							timeframePromise={timeframePromise}
						/>
					</Suspense>
				</Show>
			</Suspense>
			<Suspense>
				<Show when="signed-out">
					<div className="flex flex-1 flex-col items-center justify-center py-20 text-center">
						<h2 className="mb-4 font-extrabold text-4xl tracking-tight">
							Time tracking, simplified.
						</h2>
						<p className="mb-8 max-w-lg text-muted-foreground text-xl">
							Clock in, clock out, and manage your hours with
							ease. Built for teams that value simplicity and
							precision.
						</p>
						<SignInButton>
							<button
								className="rounded-xl bg-zinc-900 px-8 py-4 font-semibold text-lg text-zinc-50 transition-all hover:bg-zinc-800 active:scale-95 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
								type="button"
							>
								Get Started Now
							</button>
						</SignInButton>
					</div>
				</Show>
			</Suspense>
		</main>
	)
}

function DashboardSkeleton() {
	return (
		<div className="animate-pulse space-y-8">
			<div className="h-10 w-1/3 rounded-md bg-zinc-200 dark:bg-zinc-800"></div>
			<div className="h-[400px] rounded-xl bg-zinc-200 dark:bg-zinc-800"></div>
		</div>
	)
}
