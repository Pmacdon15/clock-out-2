'use client'

import { format, startOfDay } from 'date-fns'
import { TrendingUp } from 'lucide-react'
import { useMemo } from 'react'
import {
	Bar,
	BarChart,
	CartesianGrid,
	Cell,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from 'recharts'
import type { TimeEntry } from '@/lib/dal'
import { Card } from '../ui'

interface HoursChartProps {
	filteredEntries: TimeEntry[]
	timeframe: string
	selectedYear: number
	selectedMonth: number
	previousTotalHours: number
}

export function HoursChart({
	filteredEntries,
	timeframe,
	selectedYear,
	selectedMonth,
	previousTotalHours,
}: HoursChartProps) {
	const chartData = useMemo(() => {
		// We use a Map keyed by the start of the day to ensure
		// chronological grouping regardless of the year.
		const dataMap: Record<string, { hours: number; date: Date }> = {}

		filteredEntries.forEach((e) => {
			const clockIn = new Date(e.clock_in)
			const dayKey = startOfDay(clockIn).toISOString()

			const durationMs = e.clock_out
				? new Date(e.clock_out).getTime() - clockIn.getTime()
				: 0
			const hours = durationMs / (1000 * 60 * 60)

			if (!dataMap[dayKey]) {
				dataMap[dayKey] = { hours: 0, date: clockIn }
			}
			dataMap[dayKey].hours += hours
		})

		// Sort by the actual timestamp so Nov 2025 comes before Jan 2026
		return Object.values(dataMap)
			.sort((a, b) => a.date.getTime() - b.date.getTime())
			.map((val) => ({
				// Label for the X-Axis
				name: format(val.date, 'MMM dd'),
				hours: parseFloat(val.hours.toFixed(2)),
				// Tooltip can show year if needed
				fullLabel: format(val.date, 'MMM dd, yyyy'),
			}))
	}, [filteredEntries])

	const totalHours = useMemo(
		() => chartData.reduce((acc, curr) => acc + curr.hours, 0),
		[chartData],
	)

	const summaryText = useMemo(() => {
		if (timeframe === 'month') {
			return `${format(new Date(selectedYear, selectedMonth, 1), 'MMMM')} ${selectedYear}`
		}
		if (timeframe === 'year') {
			return `${selectedYear}`
		}
		return timeframe
	}, [timeframe, selectedYear, selectedMonth])

	const percentage = useMemo(() => {
		if (previousTotalHours === 0) return null
		return ((totalHours - previousTotalHours) / previousTotalHours) * 100
	}, [totalHours, previousTotalHours])

	const vsText = useMemo(() => {
		if (timeframe === 'week') return 'vs last week'
		if (timeframe === 'month') return 'vs last month'
		if (timeframe === 'year') return 'vs last year'
		return ''
	}, [timeframe])

	return (
		<Card className="p-6 md:col-span-2">
			<div className="mb-8 flex flex-col gap-1">
				<h3 className="font-medium text-sm text-zinc-500">
					Summary hours for {summaryText}
				</h3>
				<div className="flex items-end gap-2">
					<span className="font-black text-3xl">
						{totalHours.toFixed(1)}h
					</span>
					{percentage !== null && (
						<span
							className={`mb-1 flex items-center gap-0.5 font-bold text-xs ${
								percentage >= 0
									? 'text-green-500'
									: 'text-red-500'
							}`}
						>
							<TrendingUp
								className={`h-3 w-3 ${percentage < 0 ? 'rotate-180' : ''}`}
							/>
							{Math.abs(percentage).toFixed(0)}% {vsText}
						</span>
					)}
				</div>
			</div>

			<div className="mt-4 h-[300px] w-full">
				<ResponsiveContainer height="100%" width="100%">
					<BarChart
						data={chartData}
						margin={{ top: 0, right: 0, left: -20, bottom: 0 }}
					>
						<CartesianGrid
							stroke="#e5e7eb"
							strokeDasharray="3 3"
							vertical={false}
						/>
						<XAxis
							axisLine={false}
							dataKey="name"
							dy={10}
							tick={{ fill: '#71717a', fontSize: 12 }}
							tickLine={false}
						/>
						<YAxis
							axisLine={false}
							tick={{ fill: '#71717a', fontSize: 12 }}
							tickLine={false}
						/>
						<Tooltip
							contentStyle={{
								borderRadius: '12px',
								border: 'none',
								boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
								backgroundColor: '#18181b',
								color: '#fff',
							}}
							cursor={{ fill: 'rgba(0,0,0,0.05)' }}
							itemStyle={{ color: '#fff' }}
							// Optional: use the fullDate with year in the tooltip
							labelFormatter={(value, payload) =>
								payload[0]?.payload.fullLabel || value
							}
							labelStyle={{
								fontWeight: 'bold',
								marginBottom: '4px',
							}}
						/>
						<Bar
							barSize={32}
							dataKey="hours"
							fill="#18181b"
							radius={[4, 4, 0, 0]}
						>
							{chartData.map((d, _index) => (
								<Cell
									className="fill-zinc-900 dark:fill-zinc-50"
									key={`cell-${JSON.stringify(d)}`}
								/>
							))}
						</Bar>
					</BarChart>
				</ResponsiveContainer>
			</div>
		</Card>
	)
}
