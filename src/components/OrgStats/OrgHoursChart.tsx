'use client'

import { format, startOfDay } from 'date-fns'
import { useMemo } from 'react'
import {
	CartesianGrid,
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
	Legend,
} from 'recharts'
import type { TimeEntry } from '@/lib/dal'
import { Card } from '../ui'

interface OrgHoursChartProps {
	filteredEntries: TimeEntry[]
	members: { id: string; name: string }[]
	visibleMemberIds: Set<string>
}

const COLORS = [
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

export function OrgHoursChart({
	filteredEntries,
	members,
	visibleMemberIds,
}: OrgHoursChartProps) {
	const chartData = useMemo(() => {
		const dataMap: Record<string, { date: Date; [userId: string]: any }> = {}

		filteredEntries.forEach((e) => {
			const clockIn = new Date(e.clock_in)
			const dayKey = startOfDay(clockIn).toISOString()

			const durationMs = e.clock_out
				? new Date(e.clock_out).getTime() - clockIn.getTime()
				: 0
			const hours = durationMs / (1000 * 60 * 60)

			if (!dataMap[dayKey]) {
				dataMap[dayKey] = { date: clockIn }
			}
			
			if (!dataMap[dayKey][e.user_id]) {
				dataMap[dayKey][e.user_id] = 0
			}
			dataMap[dayKey][e.user_id] += hours
		})

		return Object.values(dataMap)
			.sort((a, b) => a.date.getTime() - b.date.getTime())
			.map((val) => {
				const entry: any = {
					name: format(val.date, 'MMM dd'),
					fullLabel: format(val.date, 'MMM dd, yyyy'),
				}
				for (const member of members) {
					if (val[member.id] !== undefined) {
						entry[member.id] = parseFloat(val[member.id].toFixed(2))
					} else {
						entry[member.id] = 0
					}
				}
				return entry
			})
	}, [filteredEntries, members])

	return (
		<Card className="p-6">
			<div className="mb-8">
				<h3 className="font-bold text-xl tracking-tight">Organization Hours</h3>
				<p className="text-muted-foreground text-sm">
					Daily breakdown of hours per employee.
				</p>
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
							wrapperStyle={{ paddingBottom: '20px', fontSize: '12px' }}
						/>
						{members.map((member, index) => (
							<Line
								activeDot={{ r: 6, strokeWidth: 0 }}
								connectNulls
								dataKey={member.id}
								dot={{ r: 4, strokeWidth: 0 }}
								hide={!visibleMemberIds.has(member.id)}
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
		</Card>
	)
}
