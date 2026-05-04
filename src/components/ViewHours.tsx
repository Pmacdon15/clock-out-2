'use client'

import { useUser } from '@clerk/nextjs'
import { use, useMemo, useState } from 'react'
import type { SerializableResult, TimeEntry } from '@/lib/dal'
import { MemberToggles } from './OrgStats/MemberToggles'
import { OrgHoursChart } from './OrgStats/OrgHoursChart'
import { EntryList } from './ViewHours/EntryList'
import { HoursChart } from './ViewHours/HoursChart'
import {
	TimeframeSelector,
	type TimeframeValue,
} from './ViewHours/TimeframeSelector'

interface ViewHoursProps {
	entries: TimeEntry[]
	setOptimisticEntries: (action: {
		type: 'ADD' | 'REMOVE' | 'UPDATE'
		payload: any
	}) => void
	isAdmin?: boolean
	membersPromise?: Promise<
		{
			id: string
			name: string
		}[]
	>
	orgTimeEntriesPromise: Promise<
		SerializableResult<TimeEntry[], { reason: string }>
	>
	selectedUserIdPromise?: Promise<string | undefined>
	selectedWeekPromise?: Promise<string | undefined>
	selectedMonthPromise?: Promise<string | undefined>
	selectedYearPromise?: Promise<string | undefined>
	timeframePromise?: Promise<string | undefined>
	currentUserId?: string | null | undefined
}

export default function ViewHours({
	entries,
	setOptimisticEntries,
	isAdmin = false,
	membersPromise,
	orgTimeEntriesPromise,
	selectedUserIdPromise,
	selectedWeekPromise,
	selectedMonthPromise,
	selectedYearPromise,
	timeframePromise,
	currentUserId,
}: ViewHoursProps) {
	const { user } = useUser()
	const members = use(membersPromise || Promise.resolve([]))
	const selectedUserId = use(selectedUserIdPromise || Promise.resolve(''))
	const orgTimeEntriesResult = use(orgTimeEntriesPromise)

	const orgEntries = useMemo(() => {
		return orgTimeEntriesResult.ok ? orgTimeEntriesResult.value : []
	}, [orgTimeEntriesResult])

	const isViewingAll = selectedUserId === 'all' && isAdmin

	const initialWeekParsed = use(
		selectedWeekPromise || Promise.resolve(undefined),
	)
	const initialMonthParsed = use(
		selectedMonthPromise || Promise.resolve(undefined),
	)
	const initialYearParsed = use(
		selectedYearPromise || Promise.resolve(undefined),
	)
	const initialTimeframeParsed = use(
		timeframePromise || Promise.resolve(undefined),
	)

	const timeframe = (initialTimeframeParsed as TimeframeValue) || 'week'
	const selectedYear = initialYearParsed
		? parseInt(initialYearParsed, 10)
		: new Date().getFullYear()
	const selectedMonth = initialMonthParsed
		? parseInt(initialMonthParsed, 10)
		: new Date().getMonth()
	const selectedWeek = initialWeekParsed ? parseInt(initialWeekParsed, 10) : 1

	const [chartType, setChartType] = useState<'bar' | 'line'>('bar')

	const selectedMember = useMemo(
		() => members.find((m) => m.id === selectedUserId),
		[members, selectedUserId],
	)

	const employeeName = useMemo(() => {
		if (isViewingAll) return 'Entire Organization'
		if (selectedUserId) return selectedMember?.name || 'Employee'
		return user?.fullName || 'You'
	}, [isViewingAll, selectedUserId, selectedMember, user])

	// Member visibility state for Org view
	const [visibleMemberIds, setVisibleMemberIds] = useState<Set<string>>(
		new Set(members.map((m) => m.id)),
	)

	const toggleMember = (id: string) => {
		const newSet = new Set(visibleMemberIds)
		if (newSet.has(id)) {
			newSet.delete(id)
		} else {
			newSet.add(id)
		}
		setVisibleMemberIds(newSet)
	}

	const toggleAll = () => {
		if (visibleMemberIds.size === members.length) {
			setVisibleMemberIds(new Set())
		} else {
			setVisibleMemberIds(new Set(members.map((m) => m.id)))
		}
	}

	// Derive available years
	const availableYears = useMemo(() => {
		const years = new Set<number>()
		years.add(new Date().getFullYear())
		return Array.from(years).sort((a, b) => b - a)
	}, [])

	// Since the entries are already filtered by the server, we use them directly.
	const displayEntries = isViewingAll ? orgEntries : entries

	// Previous total hours calculation placeholder
	const previousTotalHours = 0

	const lineChartMembers = useMemo(() => {
		if (isViewingAll) return members
		return [
			{ id: selectedUserId || currentUserId || '', name: employeeName },
		]
	}, [isViewingAll, members, selectedUserId, currentUserId, employeeName])

	const lineChartVisibleIds = useMemo(() => {
		if (isViewingAll) return visibleMemberIds
		return new Set([selectedUserId || currentUserId || ''])
	}, [isViewingAll, visibleMemberIds, selectedUserId, currentUserId])

	return (
		<div className="space-y-6 pb-20">
			<div className="flex flex-col gap-6">
				<TimeframeSelector
					availableYears={availableYears}
					currentUserId={currentUserId}
					endDate={''} // Handled by searchParams
					isAdmin={isAdmin}
					members={members}
					selectedMonth={selectedMonth}
					selectedUserId={selectedUserId}
					selectedWeek={selectedWeek}
					selectedYear={selectedYear}
					startDate={''} // Handled by searchParams
					timeframe={timeframe}
				/>

				<div className="flex w-full justify-center">
					<div className="flex rounded-lg bg-zinc-100 p-1 dark:bg-zinc-900">
						<button
							className={`px-4 py-1.5 font-bold text-xs transition-all ${
								chartType === 'bar'
									? 'rounded-md bg-white text-zinc-950 shadow-sm dark:bg-zinc-800 dark:text-zinc-50'
									: 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50'
							}`}
							onClick={() => setChartType('bar')}
							type="button"
						>
							BAR CHART
						</button>
						<button
							className={`px-4 py-1.5 font-bold text-xs transition-all ${
								chartType === 'line'
									? 'rounded-md bg-white text-zinc-950 shadow-sm dark:bg-zinc-800 dark:text-zinc-50'
									: 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50'
							}`}
							onClick={() => setChartType('line')}
							type="button"
						>
							LINE CHART
						</button>
					</div>
				</div>
			</div>

			<div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
				<div className="lg:col-span-3">
					{chartType === 'bar' ? (
						<HoursChart
							employeeName={employeeName}
							filteredEntries={displayEntries}
							isViewingAll={isViewingAll}
							members={members}
							previousTotalHours={previousTotalHours}
							selectedMonth={selectedMonth}
							selectedWeek={selectedWeek}
							selectedYear={selectedYear}
							timeframe={timeframe}
							visibleMemberIds={visibleMemberIds}
						/>
					) : (
						<OrgHoursChart
							filteredEntries={displayEntries}
							members={lineChartMembers}
							selectedMonth={selectedMonth}
							selectedWeek={selectedWeek}
							selectedYear={selectedYear}
							timeframe={timeframe}
							visibleMemberIds={lineChartVisibleIds}
						/>
					)}
				</div>

				<div className="space-y-6 lg:col-span-1">
					{isViewingAll && (
						<MemberToggles
							members={members}
							toggleAll={toggleAll}
							toggleMember={toggleMember}
							visibleMemberIds={visibleMemberIds}
						/>
					)}
					<EntryList
						entries={displayEntries}
						isAdmin={isAdmin}
						setOptimisticEntries={setOptimisticEntries}
					/>
				</div>
			</div>
		</div>
	)
}
