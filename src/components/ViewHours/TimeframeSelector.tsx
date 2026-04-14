'use client'

import { endOfMonth, format } from 'date-fns'
import { Calendar, Users } from 'lucide-react'
import type { Route } from 'next'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

export type TimeframeValue = 'week' | 'month' | 'year' | 'custom' | 'all'

interface TimeframeSelectorProps {
	timeframe: TimeframeValue
	setTimeframe: (t: TimeframeValue) => void
	startDate: string
	setStartDate: (s: string) => void
	endDate: string
	setEndDate: (s: string) => void
	selectedYear: number
	setSelectedYear: (y: number) => void
	selectedMonth: number
	setSelectedMonth: (m: number) => void
	selectedWeek: number
	setSelectedWeek: (w: number) => void
	availableYears: number[]
	isAdmin?: boolean
	members?: { id: string; name: string }[]
	selectedUserId?: string
	currentUserId?: string
}

export function TimeframeSelector({
	timeframe,
	setTimeframe,
	startDate,
	setStartDate,
	endDate,
	setEndDate,
	selectedYear,
	setSelectedYear,
	selectedMonth,
	setSelectedMonth,
	selectedWeek,
	setSelectedWeek,
	availableYears,
	isAdmin,
	members,
	selectedUserId,
	currentUserId,
}: TimeframeSelectorProps) {
	const router = useRouter()
	const pathname = usePathname()
	const searchParams = useSearchParams()

	const handleMemberChange = (userId: string) => {
		const params = new URLSearchParams(searchParams.toString())
		if (userId) {
			params.set('userId', userId)
		} else {
			params.delete('userId')
		}
		router.push(`${pathname}?${params.toString()}` as Route)
	}

	return (
		<div className="flex flex-col gap-6">
			{isAdmin && members && members.length > 0 && (
				<div className="relative mb-2 flex items-center gap-4 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 p-5 text-white shadow-xl dark:bg-zinc-900">
					<div className="absolute top-0 right-0 p-3 opacity-10">
						<Users className="h-20 w-20 text-white" />
					</div>
					<div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-zinc-700 bg-zinc-800">
						<Users className="h-5 w-5 text-white" />
					</div>
					<div className="relative z-10 flex-1">
						<p className="mb-1.5 font-black text-[10px] text-zinc-500 uppercase tracking-[0.2em]">
							Administrative Control: Member Logs
						</p>
						<select
							className="w-full cursor-pointer appearance-none bg-transparent pr-8 font-bold text-lg text-white outline-none sm:w-auto"
							onChange={(e) => handleMemberChange(e.target.value)}
							value={selectedUserId || ''}
						>
							<option className="bg-zinc-900 text-white" value="">
								My Own Hours (Self)
							</option>
							{members
								.filter((m) => m.id !== currentUserId)
								.map((m) => (
									<option
										className="bg-zinc-900 text-white"
										key={m.id}
										value={m.id}
									>
										{m.name}
									</option>
								))}
						</select>
					</div>
				</div>
			)}

			<div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
				<div className="flex max-w-full overflow-x-auto rounded-lg bg-zinc-100 p-1 dark:bg-zinc-900">
					{(['week', 'month', 'year', 'custom', 'all'] as const).map(
						(t) => (
							<button
								className={`whitespace-nowrap rounded-md px-4 py-1.5 font-semibold text-xs transition-all ${
									timeframe === t
										? 'bg-white text-zinc-950 shadow-sm dark:bg-zinc-800 dark:text-zinc-50'
										: 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50'
								}`}
								key={t}
								onClick={() => setTimeframe(t)}
								type="button"
							>
								{t.toUpperCase()}
							</button>
						),
					)}
				</div>

				{timeframe === 'custom' && (
					<div className="flex w-full items-center gap-2 sm:w-auto">
						<input
							className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-zinc-400 dark:border-zinc-800 dark:bg-zinc-950"
							onChange={(e) => setStartDate(e.target.value)}
							type="date"
							value={startDate}
						/>
						<span className="text-zinc-400">to</span>
						<input
							className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-zinc-400 dark:border-zinc-800 dark:bg-zinc-950"
							onChange={(e) => setEndDate(e.target.value)}
							type="date"
							value={endDate}
						/>
					</div>
				)}

				{timeframe === 'week' && (
					<div className="flex w-full items-center gap-2 sm:w-auto">
						<Calendar className="h-4 w-4 text-zinc-400" />
						<select
							className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-zinc-400 dark:border-zinc-800 dark:bg-zinc-950"
							onChange={(e) =>
								setSelectedWeek(Number(e.target.value))
							}
							value={selectedWeek}
						>
							<option value={1}>Week 1 (1-7)</option>
							<option value={2}>Week 2 (8-14)</option>
							<option value={3}>Week 3 (15-21)</option>
							<option value={4}>
								Week 4 (22-
								{format(
									endOfMonth(
										new Date(
											selectedYear,
											selectedMonth,
											1,
										),
									),
									'd',
								)}
								)
							</option>
						</select>
						<select
							className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-zinc-400 dark:border-zinc-800 dark:bg-zinc-950"
							onChange={(e) =>
								setSelectedMonth(Number(e.target.value))
							}
							value={selectedMonth}
						>
							{Array.from({ length: 12 }).map((_, i) => {
								const monthName = format(
									new Date(2025, i, 1),
									'MMMM',
								)
								return (
									<option key={monthName} value={i}>
										{monthName}
									</option>
								)
							})}
						</select>
						<select
							className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-zinc-400 dark:border-zinc-800 dark:bg-zinc-950"
							onChange={(e) =>
								setSelectedYear(Number(e.target.value))
							}
							value={selectedYear}
						>
							{availableYears.map((y) => (
								<option key={y} value={y}>
									{y}
								</option>
							))}
						</select>
					</div>
				)}

				{timeframe === 'month' && (
					<div className="flex w-full items-center gap-2 sm:w-auto">
						<Calendar className="h-4 w-4 text-zinc-400" />
						<select
							className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-zinc-400 dark:border-zinc-800 dark:bg-zinc-950"
							onChange={(e) =>
								setSelectedMonth(Number(e.target.value))
							}
							value={selectedMonth}
						>
							{Array.from({ length: 12 }).map((_, i) => {
								const monthName = format(
									new Date(2025, i, 1),
									'MMMM',
								)
								return (
									<option key={monthName} value={i}>
										{monthName}
									</option>
								)
							})}
						</select>
						<select
							className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-zinc-400 dark:border-zinc-800 dark:bg-zinc-950"
							onChange={(e) =>
								setSelectedYear(Number(e.target.value))
							}
							value={selectedYear}
						>
							{availableYears.map((y) => (
								<option key={y} value={y}>
									{y}
								</option>
							))}
						</select>
					</div>
				)}

				{timeframe === 'year' && (
					<div className="flex w-full items-center gap-2 sm:w-auto">
						<Calendar className="h-4 w-4 text-zinc-400" />
						<select
							className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-zinc-400 dark:border-zinc-800 dark:bg-zinc-950"
							onChange={(e) =>
								setSelectedYear(Number(e.target.value))
							}
							value={selectedYear}
						>
							{availableYears.map((y) => (
								<option key={y} value={y}>
									{y}
								</option>
							))}
						</select>
					</div>
				)}
			</div>
		</div>
	)
}
