'use client'

import { useAuth } from '@clerk/nextjs'
import { format, startOfDay } from 'date-fns'
import { Download, Loader2, TrendingUp } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import {
	Bar,
	BarChart,
	CartesianGrid,
	Cell,
	LabelList,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from 'recharts'
import type { TimeEntry } from '@/lib/dal'
import { downloadElementAsImage } from '@/lib/download'
import { Button, Card } from '../ui'

interface HoursChartProps {
	filteredEntries: TimeEntry[]
	timeframe: string
	selectedYear: number
	selectedMonth: number
	selectedWeek: number
	previousTotalHours: number
	employeeName?: string
}

export function HoursChart(props: HoursChartProps) {
	const {
		timeframe,
		selectedYear,
		selectedMonth,
		selectedWeek,
		employeeName,
	} = props
	const { has } = useAuth()
	const downloadRef = useRef<HTMLDivElement>(null)
	const [isDownloading, setIsDownloading] = useState(false)
	const canDownload = has({ feature: 'download_graph' })

	const summaryText = useMemo(() => {
		if (timeframe === 'week') {
			const monthName = format(
				new Date(selectedYear, selectedMonth, 1),
				'MMMM',
			)
			return `Week ${selectedWeek} - ${monthName} ${selectedYear}`
		}
		if (timeframe === 'month') {
			return `${format(new Date(selectedYear, selectedMonth, 1), 'MMMM')} ${selectedYear}`
		}
		if (timeframe === 'year') {
			return `${selectedYear}`
		}
		return timeframe
	}, [timeframe, selectedYear, selectedMonth, selectedWeek])

	const handleDownload = async () => {
		setIsDownloading(true)
		// Small delay to allow the hidden div to be rendered/layouted by React
		setTimeout(async () => {
			if (downloadRef.current) {
				const name =
					employeeName?.toLowerCase().replace(/\s+/g, '-') ||
					'employee'
				const period = summaryText.toLowerCase().replace(/\s+/g, '-')
				const fileName = `hours-report-${name}-${period}`
				await downloadElementAsImage(downloadRef.current, fileName)
			}
			setIsDownloading(false)
		}, 150)
	}

	return (
		<>
			<Card className="p-6 md:col-span-2">
				<HoursChartContent
					{...props}
					isDownloading={isDownloading}
					onDownload={canDownload ? handleDownload : undefined}
					summaryText={summaryText}
				/>
			</Card>

			{/* Hidden desktop-sized version for download */}
			{isDownloading && (
				<div
					style={{
						position: 'fixed',
						left: '-9999px',
						top: 0,
						width: '1200px',
						zIndex: -1,
					}}
				>
					<div
						className="rounded-xl border border-zinc-200 bg-white p-12 text-zinc-950"
						ref={downloadRef}
					>
						<HoursChartContent
							{...props}
							isDownloadMode
							summaryText={summaryText}
						/>
					</div>
				</div>
			)}
		</>
	)
}

function HoursChartContent({
	filteredEntries,
	employeeName,
	onDownload,
	isDownloading,
	isDownloadMode = false,
	summaryText,
	previousTotalHours,
	timeframe,
}: HoursChartProps & {
	onDownload?: () => void
	isDownloading?: boolean
	isDownloadMode?: boolean
	summaryText: string
}) {
	const chartData = useMemo(() => {
		const dataMap: Record<string, { hours: number; date: Date }> = {}

		filteredEntries.forEach((e) => {
			const clockIn = new Date(e.clock_in)
			const dayKey = startOfDay(clockIn).toISOString()
			const durationMs = e.clock_out
				? new Date(e.clock_out).getTime() - clockIn.getTime()
				: Date.now() - clockIn.getTime()
			const hours = Math.max(0, durationMs / (1000 * 60 * 60))

			if (!dataMap[dayKey]) {
				dataMap[dayKey] = { hours: 0, date: clockIn }
			}
			dataMap[dayKey].hours += hours
		})

		return Object.values(dataMap)
			.sort((a, b) => a.date.getTime() - b.date.getTime())
			.map((val) => ({
				name: format(val.date, 'MMM dd'),
				hours: parseFloat(val.hours.toFixed(2)),
				fullLabel: format(val.date, 'MMM dd, yyyy'),
			}))
	}, [filteredEntries])

	const totalHours = useMemo(
		() => chartData.reduce((acc, curr) => acc + curr.hours, 0),
		[chartData],
	)

	const percentage = useMemo(() => {
		if (previousTotalHours === 0) return null
		return ((totalHours - previousTotalHours) / previousTotalHours) * 100
	}, [totalHours, previousTotalHours])

	const vsText = useMemo(() => {
		if (timeframe === 'week') return 'than last week'
		if (timeframe === 'month') return 'than last month'
		if (timeframe === 'year') return 'than last year'
		return ''
	}, [timeframe])

	return (
		<>
			<div className="mb-8 flex items-start justify-between">
				<div className="flex flex-col gap-1">
					<h3 className="font-medium text-sm text-zinc-500">
						{employeeName && (
							<span className={`mb-1 block font-bold ${isDownloadMode ? 'text-zinc-900' : 'text-zinc-900 dark:text-zinc-100'}`}>
								{employeeName}
							</span>
						)}
						{isDownloadMode ? (
							<span className="font-bold text-zinc-900">
								Hours Summary Report for {summaryText}
							</span>
						) : (
							<span className="dark:text-zinc-100">
								Summary hours for {summaryText}
							</span>
						)}
					</h3>
					<div className="flex items-end gap-2">
						<span className={`font-black text-3xl ${isDownloadMode ? 'text-zinc-900' : 'text-zinc-900 dark:text-zinc-100'}`}>
							{totalHours.toFixed(2)}h
						</span>
						{percentage !== null && !isDownloadMode && (
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
								{Math.abs(percentage).toFixed(0)}%{' '}
								{percentage >= 0 ? 'more' : 'less'} {vsText}
							</span>
						)}
					</div>
				</div>

				{onDownload && (
					<Button
						className="h-8 w-8 p-0"
						disabled={isDownloading}
						onClick={onDownload}
						variant="outline"
					>
						{isDownloading ? (
							<Loader2 className="h-4 w-4 animate-spin" />
						) : (
							<Download className="h-4 w-4" />
						)}
						<span className="sr-only">Download graph</span>
					</Button>
				)}
			</div>

			<div
				className={
					isDownloadMode ? 'mt-4 h-[400px] w-full' : 'mt-4 h-[300px] w-full'
				}
			>
				<ResponsiveContainer height="100%" width="100%">
					<BarChart
						data={chartData}
						margin={
							isDownloadMode
								? { top: 20, right: 30, left: 0, bottom: 20 }
								: { top: 0, right: 0, left: -20, bottom: 0 }
						}
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
						{!isDownloadMode && (
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
								labelFormatter={(value, payload) =>
									payload[0]?.payload.fullLabel || value
								}
								labelStyle={{
									fontWeight: 'bold',
									marginBottom: '4px',
								}}
							/>
						)}
						<Bar
							barSize={32}
							dataKey="hours"
							fill={isDownloadMode ? '#2563eb' : '#18181b'}
							isAnimationActive={!isDownloadMode}
							radius={[4, 4, 0, 0]}
						>
							{isDownloadMode && (
								<LabelList
									dataKey="hours"
									formatter={(val: number) => `${val}h`}
									position="top"
									style={{
										fill: '#71717a',
										fontSize: 10,
										fontWeight: 'bold',
									}}
								/>
							)}
							{chartData.map((d, _index) => (
								<Cell
									className={
										isDownloadMode
											? 'fill-blue-600'
											: 'fill-zinc-900 dark:fill-zinc-50'
									}
									key={`cell-${JSON.stringify(d)}`}
								/>
							))}
						</Bar>
					</BarChart>
				</ResponsiveContainer>
			</div>

			{isDownloadMode && (
				<div className="mt-12 border-zinc-200 border-t pt-8">
					<h4 className="mb-6 flex items-center gap-2 font-bold text-lg text-zinc-900">
						Detailed Entry Log
						<span className="rounded bg-zinc-100 px-2 py-0.5 font-medium text-xs text-zinc-500">
							{filteredEntries.length} entries
						</span>
					</h4>
					<table className="w-full border-collapse text-sm">
						<thead>
							<tr className="border-zinc-200 border-b text-left">
								<th className="pb-3 font-bold text-[10px] text-zinc-400 uppercase tracking-wider">
									Date
								</th>
								<th className="pb-3 font-bold text-[10px] text-zinc-400 uppercase tracking-wider">
									Clock In
								</th>
								<th className="pb-3 font-bold text-[10px] text-zinc-400 uppercase tracking-wider">
									Clock Out
								</th>
								<th className="pb-3 text-right font-bold text-[10px] text-zinc-400 uppercase tracking-wider">
									Hours
								</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-zinc-100">
							{filteredEntries
								.sort(
									(a, b) =>
										new Date(b.clock_in).getTime() -
										new Date(a.clock_in).getTime(),
								)
								.map((e) => {
									const clockIn = new Date(e.clock_in)
									const clockOut = e.clock_out
										? new Date(e.clock_out)
										: null
									const durationMs = clockOut
										? clockOut.getTime() - clockIn.getTime()
										: Date.now() - clockIn.getTime()
									const hours = Math.max(
										0,
										durationMs / (1000 * 60 * 60),
									)

									return (
										<tr key={e.id}>
											<td className="py-3 font-medium text-zinc-900">
												{format(
													clockIn,
													'eee, MMM d, yyyy',
												)}
											</td>
											<td className="py-3 text-zinc-500">
												{format(clockIn, 'hh:mm a')}
											</td>
											<td className="py-3 text-zinc-500">
												{clockOut ? (
													format(clockOut, 'hh:mm a')
												) : (
													<span className="font-medium text-blue-500 italic">
														Active
													</span>
												)}
											</td>
											<td className="py-3 text-right font-bold tabular-nums text-zinc-900">
												{hours.toFixed(2)}h
											</td>
										</tr>
									)
								})}
						</tbody>
					</table>
					<div className="mt-8 flex justify-end border-zinc-100 border-t pt-6">
						<div className="text-right">
							<span className="mb-1 block font-bold text-[10px] text-zinc-400 uppercase tracking-widest">
								Total Hours for Period
							</span>
							<span className="font-black text-2xl text-zinc-900">
								{totalHours.toFixed(2)}h
							</span>
						</div>
					</div>
				</div>
			)}
		</>
	)
}
