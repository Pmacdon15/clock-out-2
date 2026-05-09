'use client'

import { useAuth } from '@clerk/nextjs'
import { Suspense, use, useOptimistic } from 'react'
import TimeClock from '@/components/time-clock'
import type {
	ReportingSettingsData,
	SerializableResult,
	TimeEntry,
} from '@/lib/types'
import OrgSettings from './OrgSettings'
import { Card } from './ui'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import ViewHours from './ViewHours'

interface DashboardTabsProps {
	defaultTabPromise: Promise<string | undefined>
	entriesPromise: Promise<SerializableResult<TimeEntry[], { reason: string }>>
	orgSettingsPromise: Promise<
		SerializableResult<
			ReportingSettingsData | null,
			{
				reason: string
			}
		>
	>
	orgTimeEntriesPromise: Promise<
		SerializableResult<TimeEntry[], { reason: string }>
	>
	recentEntriesPromise: Promise<
		SerializableResult<TimeEntry[], { reason: string }>
	>
	membersPromise?: Promise<
		{
			id: string
			name: string
		}[]
	>
	selectedUserIdPromise?: Promise<string | undefined>
	selectedWeekPromise?: Promise<string | undefined>
	selectedMonthPromise?: Promise<string | undefined>
	selectedYearPromise?: Promise<string | undefined>
	timeframePromise?: Promise<string | undefined>
}
type TabType = 'time-clock' | 'view' | 'settings'

export default function DashboardTabs({
	defaultTabPromise,
	orgSettingsPromise,
	entriesPromise,
	orgTimeEntriesPromise,
	recentEntriesPromise,
	membersPromise,
	selectedUserIdPromise,
	selectedWeekPromise,
	selectedMonthPromise,
	selectedYearPromise,
	timeframePromise,
}: DashboardTabsProps) {
	const { userId, has } = useAuth()
	const result = use(entriesPromise)
	const recentEntriesResult = use(recentEntriesPromise)
	const defaultTabResult = use(defaultTabPromise)
	const defaultTab: TabType =
		defaultTabResult === 'view'
			? 'view'
			: defaultTabResult === 'settings'
				? 'settings'
				: 'time-clock'

	const [optimisticEntries, setOptimisticEntries] = useOptimistic(
		result.ok ? result : { value: [] as TimeEntry[], ok: true as const },
		(
			state: SerializableResult<TimeEntry[], { reason: string }>,
			action: { type: 'ADD' | 'REMOVE' | 'UPDATE'; payload: any },
		) => {
			if (!state.ok) return state

			switch (action.type) {
				case 'ADD':
					return {
						...state,
						value: [action.payload, ...(state.value || [])],
					}
				case 'REMOVE':
					return {
						...state,
						value: (state.value || []).filter(
							(entry) => entry.id !== action.payload,
						),
					}
				case 'UPDATE':
					return {
						...state,
						value: (state.value || []).map((entry) =>
							entry.id === action.payload.id
								? { ...entry, ...action.payload }
								: entry,
						),
					}
				default:
					return state
			}
		},
	)

	const [optimisticRecentEntries, setOptimisticRecentEntries] = useOptimistic(
		recentEntriesResult.ok
			? recentEntriesResult
			: { value: [] as TimeEntry[], ok: true as const },
		(
			state: SerializableResult<TimeEntry[], { reason: string }>,
			action: { type: 'ADD' | 'REMOVE' | 'UPDATE'; payload: any },
		) => {
			if (!state.ok) return state

			switch (action.type) {
				case 'ADD':
					return {
						...state,
						value: [action.payload, ...(state.value || [])],
					}
				case 'REMOVE':
					return {
						...state,
						value: (state.value || []).filter(
							(entry) => entry.id !== action.payload,
						),
					}
				case 'UPDATE':
					return {
						...state,
						value: (state.value || []).map((entry) =>
							entry.id === action.payload.id
								? { ...entry, ...action.payload }
								: entry,
						),
					}
				default:
					return state
			}
		},
	)

	if (!result.ok) {
		return (
			<Card className="p-8 text-center text-red-500">
				{'Error fetching time entries: '}
				{result.error.reason}
			</Card>
		)
	}

	const entries: TimeEntry[] = optimisticEntries.ok
		? optimisticEntries.value
		: []

	const recentEntries: TimeEntry[] = optimisticRecentEntries.ok
		? optimisticRecentEntries.value
		: []

	const hasReporting = has({ feature: 'reporting' })
	const isAdmin = has({ role: 'org:admin' })

	return (
		<Tabs className="space-y-8" defaultValue={defaultTab}>
			<TabsList>
				<TabsTrigger value="time-clock">Time Clock</TabsTrigger>
				<TabsTrigger value="view">Hours</TabsTrigger>
				{isAdmin && hasReporting && (
					<TabsTrigger value="settings">Settings</TabsTrigger>
				)}
			</TabsList>

			<TabsContent className="mt-0" value="time-clock">
				<TimeClock
					initialEntries={recentEntries}
					isAdmin={isAdmin}
					setOptimisticEntries={setOptimisticRecentEntries}
				/>
			</TabsContent>

			<TabsContent className="mt-0" value="view">
				<Suspense
					fallback={
						<div className="p-8 text-center">Loading view...</div>
					}
				>
					<ViewHours
						currentUserId={userId}
						entries={entries}
						isAdmin={isAdmin}
						membersPromise={membersPromise}
						orgTimeEntriesPromise={orgTimeEntriesPromise}
						selectedMonthPromise={selectedMonthPromise}
						selectedUserIdPromise={selectedUserIdPromise}
						selectedWeekPromise={selectedWeekPromise}
						selectedYearPromise={selectedYearPromise}
						setOptimisticEntries={setOptimisticEntries}
						timeframePromise={timeframePromise}
					/>
				</Suspense>
			</TabsContent>

			{isAdmin && hasReporting && (
				<TabsContent className="mt-0" value="settings">
					<Suspense>
						<OrgSettings
							hasReporting={hasReporting}
							orgSettingsPromise={orgSettingsPromise}
						/>
					</Suspense>
				</TabsContent>
			)}
		</Tabs>
	)
}
