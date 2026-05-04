'use client'

import { useAuth } from '@clerk/nextjs'
import { format, startOfDay } from 'date-fns'
import { Download, Loader2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import {
	CartesianGrid,
	Legend,
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from 'recharts'
import type { TimeEntry } from '@/lib/dal'
import { downloadElementAsImage } from '@/lib/download'
import { Button, Card } from '../ui'

interface OrgHoursChartProps {
	filteredEntries: TimeEntry[]
	members: { id: string; name: string }[]
	visibleMemberIds: Set<string>
	timeframe?: string
	selectedYear?: number
	selectedMonth?: number
	selectedWeek?: number
}

export const COLORS = [
	'#2563eb', // blue-600
	'#16a34a', // green-600
	'#dc2626', // red-600
	'#ca8a04', // yellow-600
	'#9333ea', // purple-600
	'#0891b2', // cyan-600
	'#ea580c', // orange-600
	'#be185d', // pink-600
	'#4f46e5', // indigo-600
	'#059669', // emerald-600
]

export function OrgHoursChart(props: OrgHoursChartProps) {
	const { timeframe, selectedYear, selectedMonth, selectedWeek } = props
	const { has } = useAuth()
	const downloadRef = useRef<HTMLDivElement>(null)
	const [isDownloading, setIsDownloading] = useState(false)
	const canDownload = has?.({ feature: 'download_graph' })

	const summaryText = useMemo(() => {
		if (timeframe === 'week') {
			const monthName = format(
				new Date(selectedYear || 0, selectedMonth || 0, 1),
				'MMMM',
			)
			return `Week ${selectedWeek} - ${monthName} ${selectedYear}`
		}
		if (timeframe === 'month') {
			return `${format(new Date(selectedYear || 0, selectedMonth || 0, 1), 'MMMM')} ${selectedYear}`
		}
		if (timeframe === 'year') {
			return `${selectedYear}`
		}
		return timeframe || 'custom'
	}, [timeframe, selectedYear, selectedMonth, selectedWeek])

	const handleDownload = async () => {
		setIsDownloading(true)
		setTimeout(async () => {
			if (downloadRef.current) {
				const period = summaryText.toLowerCase().replace(/\s+/g, '-')
				await downloadElementAsImage(
					downloadRef.current,
					`org-hours-report-${period}`,
				)
			}
			setIsDownloading(false)
		}, 100)
	}

	return (
		<>
			<Card className="p-6">
				<OrgHoursChartContent
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
						className="rounded-xl border border-zinc-200 bg-white p-12 dark:border-zinc-800 dark:bg-zinc-950"
						ref={downloadRef}
					>
						<OrgHoursChartContent
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

type ChartDataMapValue = {
	date: Date
	[userId: string]: number | Date
}

type ChartDataEntry = {
	name: string
	fullLabel: string
	[userId: string]: number | string
}

function OrgHoursChartContent({
	filteredEntries,
	members,
	visibleMemberIds,
	onDownload,
	isDownloading,
	isDownloadMode = false,
	summaryText,
}: OrgHoursChartProps & {
	onDownload?: () => void
	isDownloading?: boolean
	isDownloadMode?: boolean
	summaryText: string
}) {
	const chartData = useMemo(() => {
		const dataMap: Record<string, ChartDataMapValue> = {}

		filteredEntries.forEach((e) => {
			const clockIn = new Date(e.clock_in)
			const dayKey = startOfDay(clockIn).toISOString()
			const durationMs = e.clock_out
				? new Date(e.clock_out).getTime() - clockIn.getTime()
				: Date.now() - clockIn.getTime()
			const hours = Math.max(0, durationMs / (1000 * 60 * 60))

			if (!dataMap[dayKey]) {
				dataMap[dayKey] = { date: clockIn }
			}

			if (!dataMap[dayKey][e.user_id]) {
				dataMap[dayKey][e.user_id] = 0
			}
			;(dataMap[dayKey][e.user_id] as number) += hours
		})

		return Object.values(dataMap)
			.sort((a, b) => a.date.getTime() - b.date.getTime())
			.map((val) => {
				const entry: ChartDataEntry = {
					name: format(val.date, 'MMM dd'),
					fullLabel: format(val.date, 'MMM dd, yyyy'),
				}
				for (const member of members) {
					if (val[member.id] !== undefined) {
						entry[member.id] = parseFloat(
							(val[member.id] as number).toFixed(2),
						)
					} else {
						entry[member.id] = 0
					}
				}
				return entry
			})
	}, [filteredEntries, members])

	const totalOrgHours = useMemo(() => {
		return filteredEntries.reduce((acc, e) => {
			const clockIn = new Date(e.clock_in)
			const durationMs = e.clock_out
				? new Date(e.clock_out).getTime() - clockIn.getTime()
				: Date.now() - clockIn.getTime()
			return acc + Math.max(0, durationMs / (1000 * 60 * 60))
		}, 0)
	}, [filteredEntries])

	const memberBreakdown = useMemo(() => {
		const breakdown: Record<string, number> = {}
		filteredEntries.forEach((e) => {
			const clockIn = new Date(e.clock_in)
			const durationMs = e.clock_out
				? new Date(e.clock_out).getTime() - clockIn.getTime()
				: Date.now() - clockIn.getTime()
			const hours = Math.max(0, durationMs / (1000 * 60 * 60))
			breakdown[e.user_id] = (breakdown[e.user_id] || 0) + hours
		})
		return breakdown
	}, [filteredEntries])

	return (
		<>
			<div className="mb-8 flex items-start justify-between">
				<div>
					<h3 className="font-bold text-xl tracking-tight">
						Organization Hours
					</h3>
					<div className="flex items-end gap-2">
						<span className="font-black text-3xl">
							{totalOrgHours.toFixed(1)}h
						</span>
						<span className="mb-1 font-medium text-muted-foreground text-sm">
							total for {summaryText}
						</span>
					</div>
					<p className="mt-1 text-muted-foreground text-sm">
						Daily breakdown of hours per employee.
					</p>
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

			<div className="h-[400px] w-full">
				<ResponsiveContainer height="100%" width="100%">
					<LineChart
						data={chartData}
						margin={{ top: 5, right: 30, left: -20, bottom: 5 }}
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
							itemStyle={{ color: '#fff', fontSize: '12px' }}
							labelFormatter={(value, payload) =>
								payload[0]?.payload.fullLabel || value
							}
							labelStyle={{
								fontWeight: 'bold',
								marginBottom: '4px',
							}}
						/>
						<Legend
							align="right"
							iconType="circle"
							layout="horizontal"
							verticalAlign="top"
							wrapperStyle={{
								paddingBottom: '20px',
								fontSize: '12px',
							}}
						/>
						{members.map((member, index) => (
							<Line
								activeDot={{ r: 6, strokeWidth: 0 }}
								connectNulls
								dataKey={member.id}
								dot={{ r: 4, strokeWidth: 0 }}
								hide={!visibleMemberIds.has(member.id)}
								isAnimationActive={!isDownloadMode}
								key={member.id}
								name={member.name}
								stroke={COLORS[index % COLORS.length]}
								strokeWidth={3}
								type="monotone"
							/>
						))}
					</LineChart>
				</ResponsiveContainer>
			</div>

			{isDownloadMode && (
				<div className="mt-12 space-y-12">
					<div className="border-zinc-200 border-t pt-8 dark:border-zinc-800">
						<h4 className="mb-6 font-bold text-lg">
							Employee Breakdown
						</h4>
						<table className="w-full text-sm">
							<thead>
								<tr className="border-zinc-200 border-b text-left dark:border-zinc-800">
									<th className="pb-3 font-bold text-[10px] text-zinc-400 uppercase">
										Employee
									</th>
									<th className="pb-3 text-right font-bold text-[10px] text-zinc-400 uppercase">
										Total Hours
									</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
								{members
									.filter((m) => memberBreakdown[m.id])
									.map((member, index) => (
										<tr key={member.id}>
											<td className="py-3 font-medium">
												<div className="flex items-center gap-2">
													<div
														className="h-2 w-2 rounded-full"
														style={{
															backgroundColor:
																COLORS[
																	index %
																		COLORS.length
																],
														}}
													/>
													{member.name}
												</div>
											</td>
											<td className="py-3 text-right font-bold tabular-nums">
												{(
													memberBreakdown[
														member.id
													] || 0
												).toFixed(2)}
												h
											</td>
										</tr>
									))}
							</tbody>
						</table>
					</div>

					<div className="border-zinc-200 border-t pt-8 dark:border-zinc-800">
						<h4 className="mb-6 flex items-center gap-2 font-bold text-lg">
							Detailed Organization Log
							<span className="rounded bg-zinc-100 px-2 py-0.5 font-medium text-xs text-zinc-500 dark:bg-zinc-800">
								{filteredEntries.length} entries
							</span>
						</h4>
						<table className="w-full border-collapse text-sm">
							<thead>
								<tr className="border-zinc-200 border-b text-left dark:border-zinc-800">
									<th className="pb-3 font-bold text-[10px] text-zinc-400 uppercase">
										Date
									</th>
									<th className="pb-3 font-bold text-[10px] text-zinc-400 uppercase">
										Employee
									</th>
									<th className="pb-3 font-bold text-[10px] text-zinc-400 uppercase">
										Shift
									</th>
									<th className="pb-3 text-right font-bold text-[10px] text-zinc-400 uppercase">
										Hours
									</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
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
											? clockOut.getTime() -
												clockIn.getTime()
											: Date.now() - clockIn.getTime()
										const hours = Math.max(
											0,
											durationMs / (1000 * 60 * 60),
										)
										const member = members.find(
											(m) => m.id === e.user_id,
										)

										return (
											<tr key={e.id}>
												<td className="py-3 font-medium">
													{format(
														clockIn,
														'MMM d, yyyy',
													)}
												</td>
												<td className="py-3 text-zinc-500">
													{member?.name || 'Unknown'}
												</td>
												<td className="py-3 text-zinc-500">
													{format(clockIn, 'hh:mm a')}{' '}
													-{' '}
													{clockOut
														? format(
																clockOut,
																'hh:mm a',
															)
														: 'Active'}
												</td>
												<td className="py-3 text-right font-bold tabular-nums">
													{hours.toFixed(2)}h
												</td>
											</tr>
										)
									})}
							</tbody>
						</table>
					</div>
				</div>
			)}
		</>
	)
}
