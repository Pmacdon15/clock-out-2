import { Show, SignInButton } from '@clerk/nextjs'
import { Suspense } from 'react'
import DashboardTabs from '@/components/DashboardTabs'
import DashboardSkeleton from '@/components/fallbacks/home-page-fallback'
import MainPageHeader from '@/components/headers/main-page-header'
import {
	getOrgMembers,
	getOrgReportingSettings,
	getOrgTimeEntries,
	getTimeEntries,
} from '@/lib/dal'
import { parseParams } from '@/lib/utils'

export default function Home(props: PageProps<'/'>) {
	return (
		<main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-8">
			<MainPageHeader />
			<Suspense>
				<Show when="signed-in">
					<Suspense fallback={<DashboardSkeleton />}>
						<DashboardTabs
							defaultTabPromise={props.searchParams.then(
								(params) => parseParams(params.defaultTab),
							)}
							endDatePromise={props.searchParams.then((params) =>
								parseParams(params.end),
							)}
							entriesPromise={props.searchParams.then((params) =>
								getTimeEntries(parseParams(params.userId), {
									timeframe: parseParams(params.timeframe),
									week: parseParams(params.week),
									month: parseParams(params.month),
									year: parseParams(params.year),
									start: parseParams(params.start),
									end: parseParams(params.end),
								}),
							)}
							membersPromise={getOrgMembers()}
							orgSettingsPromise={getOrgReportingSettings()}
							orgTimeEntriesPromise={props.searchParams.then(
								(params) =>
									getOrgTimeEntries({
										timeframe: parseParams(
											params.timeframe,
										),
										week: parseParams(params.week),
										month: parseParams(params.month),
										year: parseParams(params.year),
										start: parseParams(params.star),
										end: parseParams(params.end),
									}),
							)}
							recentEntriesPromise={getTimeEntries()}
							selectedMonthPromise={props.searchParams.then(
								(params) => parseParams(params.month),
							)}
							selectedUserIdPromise={props.searchParams.then(
								(params) => parseParams(params.userId),
							)}
							selectedWeekPromise={props.searchParams.then(
								(params) => parseParams(params.week),
							)}
							selectedYearPromise={props.searchParams.then(
								(params) => parseParams(params.year),
							)}
							startDatePromise={props.searchParams.then(
								(params) => parseParams(params.start),
							)}
							timeframePromise={props.searchParams.then(
								(params) => parseParams(params.timeframe),
							)}
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
