'use client'

import { Suspense, use, useOptimistic } from 'react'
import type { SerializableResult, TimeEntry } from '@/lib/dal'
import ManageHours from './ManageHours'
import { Card } from './ui'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import ViewHours from './ViewHours'

interface DashboardTabsProps {
	defaultTabPromise: Promise<string | undefined>
	entriesPromise: Promise<SerializableResult<TimeEntry[], { reason: string }>>
	isAdminPromise?: Promise<
		SerializableResult<
			{ userId: string; orgId: string; isAdmin: boolean },
			{ reason: string }
		>
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
type TabType = 'manage' | 'view'
export default function DashboardTabs({
	defaultTabPromise,
	entriesPromise,
	isAdminPromise,
	membersPromise,
	selectedUserIdPromise,
	selectedWeekPromise,
	selectedMonthPromise,
	selectedYearPromise,
	timeframePromise,
}: DashboardTabsProps) {
	const result = use(entriesPromise)
	const defaultTabResult = use(defaultTabPromise)
	const defaultTab: TabType = defaultTabResult === 'view' ? 'view' : 'manage'

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
						value: [...(state.value || []), action.payload],
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

	const isAdminResult = isAdminPromise ? use(isAdminPromise) : undefined
	const isAdmin = isAdminResult?.ok ? isAdminResult.value.isAdmin : false
	const currentUserId = isAdminResult?.ok
		? isAdminResult.value.userId
		: undefined

	return (
		<Tabs className="space-y-8" defaultValue={defaultTab}>
			<TabsList>
				<TabsTrigger value="manage">Manage Hours</TabsTrigger>
				<TabsTrigger value="view">View Hours</TabsTrigger>
			</TabsList>

			<TabsContent className="mt-0" value="manage">
				<ManageHours
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
						currentUserId={currentUserId}
						entries={entries}
						isAdmin={isAdmin}
						membersPromise={membersPromise}
						selectedMonthPromise={selectedMonthPromise}
						selectedUserIdPromise={selectedUserIdPromise}
						selectedWeekPromise={selectedWeekPromise}
						selectedYearPromise={selectedYearPromise}
						setOptimisticEntries={setOptimisticEntries}
						timeframePromise={timeframePromise}
					/>
				</Suspense>
			</TabsContent>
		</Tabs>
	)
}
