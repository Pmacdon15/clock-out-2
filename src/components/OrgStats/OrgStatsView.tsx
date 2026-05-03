'use client'

import {
	endOfDay,
	endOfMonth,
	endOfYear,
	isWithinInterval,
	startOfDay,
	startOfMonth,
	startOfYear,
} from 'date-fns'
import { use, useMemo, useState } from 'react'
import type { TimeEntry } from '@/lib/dal'
import {
	TimeframeSelector,
	type TimeframeValue,
} from '../ViewHours/TimeframeSelector'
import { OrgHoursChart } from './OrgHoursChart'
import { MemberToggles } from './MemberToggles'

interface OrgStatsViewProps {
	entries: TimeEntry[]
	membersPromise: Promise<
		{
			id: string
			name: string
		}[]
	>
	selectedWeekPromise?: Promise<string | undefined>
	selectedMonthPromise?: Promise<string | undefined>
	selectedYearPromise?: Promise<string | undefined>
	timeframePromise?: Promise<string | undefined>
}

export default function OrgStatsView({
	entries,
	membersPromise,
	selectedWeekPromise,
	selectedMonthPromise,
	selectedYearPromise,
	timeframePromise,
}: OrgStatsViewProps) {
	const members = use(membersPromise)
	
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

	// View state
	const [timeframe, setTimeframe] = useState<TimeframeValue>(
		(initialTimeframeParsed as TimeframeValue) || 'month',
	)
	const [startDate, setStartDate] = useState('')
	const [endDate, setEndDate] = useState('')
	const [selectedYear, setSelectedYear] = useState(
		initialYearParsed
			? parseInt(initialYearParsed, 10)
			: new Date().getFullYear(),
	)
	const [selectedMonth, setSelectedMonth] = useState(
		initialMonthParsed
			? parseInt(initialMonthParsed, 10)
			: new Date().getMonth(),
	)
	const [selectedWeek, setSelectedWeek] = useState(
		initialWeekParsed ? parseInt(initialWeekParsed, 10) : 1,
	)

	// Member visibility state
	const [visibleMemberIds, setVisibleMemberIds] = useState<Set<string>>(
		new Set(members.map((m) => m.id))
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

	// Derive available years from entries
	const availableYears = useMemo(() => {
		const years = new Set<number>()
		years.add(new Date().getFullYear())
		for (const e of entries) {
			years.add(new Date(e.clock_in).getFullYear())
		}
		return Array.from(years).sort((a, b) => b - a)
	}, [entries])

	// Filter entries based on timeframe
	const filteredEntries = useMemo(() => {
		let result = entries.filter((e) => e.clock_out) // Only completed shifts

		if (timeframe === 'week') {
			let start: Date
			let end: Date

			if (selectedWeek === 1) {
				start = startOfDay(new Date(selectedYear, selectedMonth, 1))
				end = endOfDay(new Date(selectedYear, selectedMonth, 7))
			} else if (selectedWeek === 2) {
				start = startOfDay(new Date(selectedYear, selectedMonth, 8))
				end = endOfDay(new Date(selectedYear, selectedMonth, 15))
			} else if (selectedWeek === 3) {
				start = startOfDay(new Date(selectedYear, selectedMonth, 16))
				end = endOfDay(new Date(selectedYear, selectedMonth, 23))
			} else {
				start = startOfDay(new Date(selectedYear, selectedMonth, 24))
				end = endOfMonth(new Date(selectedYear, selectedMonth, 1))
			}

			result = result.filter((e) => {
				try {
					return isWithinInterval(new Date(e.clock_in), { start, end })
				} catch {
					return false
				}
			})
		} else if (timeframe === 'month') {
			const start = startOfMonth(new Date(selectedYear, selectedMonth, 1))
			const end = endOfMonth(new Date(selectedYear, selectedMonth, 1))
			result = result.filter((e) => {
				try {
					return isWithinInterval(new Date(e.clock_in), { start, end })
				} catch {
					return false
				}
			})
		} else if (timeframe === 'year') {
			const start = startOfYear(new Date(selectedYear, 0, 1))
			const end = endOfYear(new Date(selectedYear, 0, 1))
			result = result.filter((e) => {
				try {
					return isWithinInterval(new Date(e.clock_in), { start, end })
				} catch {
					return false
				}
			})
		} else if (timeframe === 'custom' && startDate && endDate) {
			const start = startOfDay(new Date(`${startDate}T00:00:00`))
			const end = endOfDay(new Date(`${endDate}T00:00:00`))
			result = result.filter((e) => {
				try {
					const d = new Date(e.clock_in)
					return isWithinInterval(d, { start, end })
				} catch {
					return false
				}
			})
		}

		return result
	}, [
		entries,
		timeframe,
		startDate,
		endDate,
		selectedYear,
		selectedMonth,
		selectedWeek,
	])

	return (
		<div className="space-y-6 pb-20">
			<TimeframeSelector
				availableYears={availableYears}
				endDate={endDate}
				selectedMonth={selectedMonth}
				selectedWeek={selectedWeek}
				selectedYear={selectedYear}
				setEndDate={setEndDate}
				setSelectedMonth={setSelectedMonth}
				setSelectedWeek={setSelectedWeek}
				setSelectedYear={setSelectedYear}
				setStartDate={setStartDate}
				setTimeframe={setTimeframe}
				startDate={startDate}
				timeframe={timeframe}
			/>

			<div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
				<div className="lg:col-span-3">
					<OrgHoursChart
						filteredEntries={filteredEntries}
						members={members}
						visibleMemberIds={visibleMemberIds}
					/>
				</div>
				<div className="lg:col-span-1">
					<MemberToggles
						members={members}
						toggleAll={toggleAll}
						toggleMember={toggleMember}
						visibleMemberIds={visibleMemberIds}
					/>
				</div>
			</div>
		</div>
	)
}
