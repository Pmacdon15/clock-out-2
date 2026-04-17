'use client'

import {
	endOfDay,
	endOfMonth,
	endOfWeek,
	endOfYear,
	isWithinInterval,
	startOfDay,
	startOfMonth,
	startOfWeek,
	startOfYear,
	subMonths,
	subYears,
} from 'date-fns'
import { use, useMemo, useState } from 'react'
import type { TimeEntry } from '@/lib/dal'
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
	selectedUserIdPromise?: Promise<string | undefined>
	selectedWeekPromise?: Promise<string | undefined>
	selectedMonthPromise?: Promise<string | undefined>
	selectedYearPromise?: Promise<string | undefined>
	timeframePromise?: Promise<string | undefined>
	currentUserId?: string
}

export default function ViewHours({
	entries,
	setOptimisticEntries,
	isAdmin = false,
	membersPromise,
	selectedUserIdPromise,
	selectedWeekPromise,
	selectedMonthPromise,
	selectedYearPromise,
	timeframePromise,
	currentUserId,
}: ViewHoursProps) {
	const members = use(membersPromise || Promise.resolve([]))
	const selectedUserId = use(selectedUserIdPromise || Promise.resolve(''))

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

	// Determine default timeframe based on current data
	const defaultTimeframeValue = useMemo(() => {
		if (
			initialTimeframeParsed === 'week' ||
			initialTimeframeParsed === 'month' ||
			initialTimeframeParsed === 'year' ||
			initialTimeframeParsed === 'all' ||
			initialTimeframeParsed === 'custom'
		) {
			return initialTimeframeParsed as TimeframeValue
		}
		const start = startOfWeek(new Date(), { weekStartsOn: 1 })
		const end = endOfWeek(new Date(), { weekStartsOn: 1 })
		const hasEntriesInWeek = entries.some(
			(e) =>
				e.clock_out &&
				isWithinInterval(new Date(e.clock_in), { start, end }),
		)
		return hasEntriesInWeek ? 'week' : 'all'
	}, [entries, initialTimeframeParsed])

	// View state
	const [timeframe, setTimeframe] = useState<TimeframeValue>(
		defaultTimeframeValue,
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
				// Week 4: 22nd to end of month
				start = startOfDay(new Date(selectedYear, selectedMonth, 24))
				end = endOfMonth(new Date(selectedYear, selectedMonth, 1))
			}

			result = result.filter((e) => {
				try {
					return isWithinInterval(new Date(e.clock_in), {
						start,
						end,
					})
				} catch {
					return false
				}
			})
		} else if (timeframe === 'month') {
			const start = startOfMonth(new Date(selectedYear, selectedMonth, 1))
			const end = endOfMonth(new Date(selectedYear, selectedMonth, 1))
			result = result.filter((e) => {
				try {
					return isWithinInterval(new Date(e.clock_in), {
						start,
						end,
					})
				} catch {
					return false
				}
			})
		} else if (timeframe === 'year') {
			const start = startOfYear(new Date(selectedYear, 0, 1))
			const end = endOfYear(new Date(selectedYear, 0, 1))
			result = result.filter((e) => {
				try {
					return isWithinInterval(new Date(e.clock_in), {
						start,
						end,
					})
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

	// Calculate previous period total hours for comparison
	const previousTotalHours = useMemo(() => {
		let prevStart: Date
		let prevEnd: Date

		if (timeframe === 'week') {
			// For comparison, we use the immediate previous week
			let prevYear = selectedYear
			let prevMonth = selectedMonth
			let prevWeek = selectedWeek - 1

			if (prevWeek === 0) {
				const prevMonthDate = subMonths(new Date(selectedYear, selectedMonth, 1), 1)
				prevYear = prevMonthDate.getFullYear()
				prevMonth = prevMonthDate.getMonth()
				prevWeek = 4 // Compare Week 1 to Week 4 of previous month
			}

			if (prevWeek === 1) {
				prevStart = startOfDay(new Date(prevYear, prevMonth, 1))
				prevEnd = endOfDay(new Date(prevYear, prevMonth, 7))
			} else if (prevWeek === 2) {
				prevStart = startOfDay(new Date(prevYear, prevMonth, 8))
				prevEnd = endOfDay(new Date(prevYear, prevMonth, 15))
			} else if (prevWeek === 3) {
				prevStart = startOfDay(new Date(prevYear, prevMonth, 16))
				prevEnd = endOfDay(new Date(prevYear, prevMonth, 23))
			} else {
				prevStart = startOfDay(new Date(prevYear, prevMonth, 24))
				prevEnd = endOfMonth(new Date(prevYear, prevMonth, 1))
			}
		} else if (timeframe === 'month') {
			const currentMonth = new Date(selectedYear, selectedMonth, 1)
			prevStart = startOfMonth(subMonths(currentMonth, 1))
			prevEnd = endOfMonth(subMonths(currentMonth, 1))
		} else if (timeframe === 'year') {
			const currentYear = new Date(selectedYear, 0, 1)
			prevStart = startOfYear(subYears(currentYear, 1))
			prevEnd = endOfYear(subYears(currentYear, 1))
		} else {
			return 0 // No comparison for custom or all
		}

		return entries
			.filter((e) => {
				try {
					return (
						e.clock_out &&
						isWithinInterval(new Date(e.clock_in), {
							start: prevStart,
							end: prevEnd,
						})
					)
				} catch {
					return false
				}
			})
			.reduce((acc, e) => {
				const clockOutDate = e.clock_out ? new Date(e.clock_out) : null
				if (!clockOutDate) return acc
				const durationMs =
					clockOutDate.getTime() - new Date(e.clock_in).getTime()
				return acc + durationMs / (1000 * 60 * 60)
			}, 0)
	}, [entries, timeframe, selectedYear, selectedMonth, selectedWeek])

	return (
		<div className="space-y-6 pb-20">
			<TimeframeSelector
				availableYears={availableYears}
				currentUserId={currentUserId}
				endDate={endDate}
				isAdmin={isAdmin}
				members={members}
				selectedMonth={selectedMonth}
				selectedUserId={selectedUserId}
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

			<div className="grid grid-cols-1 gap-6 md:grid-cols-3">
				<HoursChart
					filteredEntries={filteredEntries}
					previousTotalHours={previousTotalHours}
					selectedMonth={selectedMonth}
					selectedWeek={selectedWeek}
					selectedYear={selectedYear}
					timeframe={timeframe}
				/>
				<EntryList
					entries={filteredEntries}
					isAdmin={isAdmin}
					setOptimisticEntries={setOptimisticEntries}
				/>
			</div>
		</div>
	)
}
