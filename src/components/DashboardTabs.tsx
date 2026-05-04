'use client'

import { useAuth } from '@clerk/nextjs'
import { Suspense, use, useOptimistic } from 'react'
import type {
	OrgSettingsData,
	SerializableResult,
	TimeEntry,
} from '@/lib/types'
import ManageHours from './ManageHours'
import OrgSettings from './OrgSettings'
import { Card } from './ui'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import ViewHours from './ViewHours'

interface DashboardTabsProps {
	defaultTabPromise: Promise<string | undefined>
	entriesPromise: Promise<SerializableResult<TimeEntry[], { reason: string }>>
	orgSettingsPromise: Promise<
		SerializableResult<OrgSettingsData, { reason: string }>
	>
	orgTimeEntriesPromise: Promise<
		SerializableResult<TimeEntry[], { reason: string }>
	>
	activeEntryPromise: Promise<
		SerializableResult<TimeEntry | null, { reason: string }>
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
type TabType = 'manage' | 'view' | 'settings'

export default function DashboardTabs({
	defaultTabPromise,
	orgSettingsPromise,
	entriesPromise,
	orgTimeEntriesPromise,
	activeEntryPromise,
	membersPromise,
	selectedUserIdPromise,
	selectedWeekPromise,
	selectedMonthPromise,
	selectedYearPromise,
	timeframePromise,
}: DashboardTabsProps) {
	const { userId, has } = useAuth()
	const result = use(entriesPromise)
	const activeEntryResult = use(activeEntryPromise)
	const defaultTabResult = use(defaultTabPromise)
	const defaultTab: TabType =
		defaultTabResult === 'view'
			? 'view'
			: defaultTabResult === 'settings'
				? 'settings'
				: 'manage'

	const [optimisticResult, setOptimisticEntries] = useOptimistic(
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

	if (!result.ok) {
		return (
			<Card className="p-8 text-center text-red-500">
				{'Error fetching time entries: '}
				{result.error.reason}
			</Card>
		)
	}

	const entries: TimeEntry[] = optimisticResult.ok
		? optimisticResult.value
		: []

	const activeEntry = activeEntryResult.ok ? activeEntryResult.value : null

	const hasReporting = has({ feature: 'reporting' })
	const isAdmin = has({ role: 'org:admin' })

	return (
		<Tabs className="space-y-8" defaultValue={defaultTab}>
			<TabsList>
				<TabsTrigger value="manage">Time Clock</TabsTrigger>
				<TabsTrigger value="view">Hours</TabsTrigger>
				{isAdmin && hasReporting && (
					<TabsTrigger value="settings">Settings</TabsTrigger>
				)}
			</TabsList>

			<TabsContent className="mt-0" value="manage">
				<ManageHours
					activeEntry={activeEntry}
					initialEntries={entries}
					isAdmin={isAdmin}
					setOptimisticEntries={setOptimisticEntries}
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
