'use client'

import { Calendar } from 'lucide-react'
import { useMemo } from 'react'
import type { TimeEntry } from '@/lib/dal'
import { Card } from '../ui'

interface DaysWorkedBreakdownProps {
	entries: TimeEntry[]
	isViewingAll?: boolean
}

export function DaysWorkedBreakdown({
	entries,
	isViewingAll = false,
}: DaysWorkedBreakdownProps) {
	const daysData = useMemo(() => {
		const uniqueMemberDays = new Set<string>()

		entries.forEach((e) => {
			const d = new Date(e.clock_in)
			const year = d.getFullYear()
			const month = String(d.getMonth() + 1).padStart(2, '0')
			const date = String(d.getDate()).padStart(2, '0')
			const dateStr = `${year}-${month}-${date}`

			const key = isViewingAll ? `${e.user_id}:${dateStr}` : dateStr
			uniqueMemberDays.add(key)
		})

		const counts: Record<number, number> = {
			1: 0, // Monday
			2: 0, // Tuesday
			3: 0, // Wednesday
			4: 0, // Thursday
			5: 0, // Friday
			6: 0, // Saturday
			0: 0, // Sunday
		}

		uniqueMemberDays.forEach((key) => {
			const datePart = isViewingAll ? key.split(':')[1] : key
			const [y, m, d] = datePart.split('-').map(Number)
			const dayOfWeek = new Date(y, m - 1, d).getDay()
			counts[dayOfWeek] = (counts[dayOfWeek] || 0) + 1
		})

		return [
			{ label: 'Monday', shortLabel: 'Mon', count: counts[1] || 0 },
			{ label: 'Tuesday', shortLabel: 'Tue', count: counts[2] || 0 },
			{ label: 'Wednesday', shortLabel: 'Wed', count: counts[3] || 0 },
			{ label: 'Thursday', shortLabel: 'Thu', count: counts[4] || 0 },
			{ label: 'Friday', shortLabel: 'Fri', count: counts[5] || 0 },
			{ label: 'Saturday', shortLabel: 'Sat', count: counts[6] || 0 },
			{ label: 'Sunday', shortLabel: 'Sun', count: counts[0] || 0 },
		]
	}, [entries, isViewingAll])

	const totalDaysWorked = useMemo(() => {
		return daysData.reduce((acc, curr) => acc + curr.count, 0)
	}, [daysData])

	const maxCount = useMemo(() => {
		return Math.max(...daysData.map((d) => d.count), 1)
	}, [daysData])

	return (
		<Card className="p-6">
			<div className="mb-6 flex items-start justify-between">
				<div>
					<h3 className="font-bold text-lg">Workday Distribution</h3>
					<p className="text-xs text-zinc-500 dark:text-zinc-400">
						{isViewingAll
							? 'Cumulative distribution of workdays completed by team members.'
							: 'How your working days are distributed across the week.'}
					</p>
				</div>
				<div className="flex flex-col items-end gap-1">
					<div className="flex items-center gap-2 rounded-lg bg-zinc-50 px-3 py-1.5 dark:bg-zinc-900">
						<Calendar className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
						<span className="font-black text-sm tabular-nums">
							{totalDaysWorked}
						</span>
					</div>
					<span className="font-bold text-[9px] text-zinc-500 uppercase tracking-wider dark:text-zinc-400">
						Total Active Days
					</span>
				</div>
			</div>

			<div className="space-y-4">
				{daysData.map((day) => {
					const pct = (day.count / maxCount) * 100
					return (
						<div
							className="group flex items-center gap-3"
							key={day.label}
						>
							<span className="w-10 font-bold text-xs text-zinc-500 transition-colors group-hover:text-zinc-900 dark:text-zinc-400 dark:group-hover:text-zinc-50">
								{day.shortLabel}
							</span>
							<div className="relative h-4 flex-1 rounded-full bg-zinc-100 dark:bg-zinc-900">
								<div
									className="h-full rounded-full bg-zinc-900 transition-all duration-500 ease-out dark:bg-zinc-50"
									style={{ width: `${pct}%` }}
								/>
							</div>
							<span className="w-14 text-right font-bold text-xs text-zinc-900 tabular-nums dark:text-zinc-100">
								{day.count} {day.count === 1 ? 'day' : 'days'}
							</span>
						</div>
					)
				})}
			</div>
		</Card>
	)
}
