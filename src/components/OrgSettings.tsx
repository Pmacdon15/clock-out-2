'use client'

import { useMutation } from '@tanstack/react-query'
import { Calendar, Check, Loader2, Settings } from 'lucide-react'
import Link from 'next/link'
import { startTransition, use, useOptimistic, useState } from 'react'
import { toast } from 'sonner'
import { updateOrgSettingAction } from '@/lib/actions'
import type { OrgSettingsData, SerializableResult } from '@/lib/types'
import { Button, Card } from './ui'

interface OrgSettingsProps {
	orgSettingsPromise: Promise<
		SerializableResult<OrgSettingsData, { reason: string }>
	>
	isPaidPlan: boolean
}

const DAYS = [
	'Monday',
	'Tuesday',
	'Wednesday',
	'Thursday',
	'Friday',
	'Saturday',
	'Sunday',
]

export default function OrgSettings({
	isPaidPlan,
	orgSettingsPromise,
}: OrgSettingsProps) {
	const settingsResult = use(orgSettingsPromise)
	const [optimisticSettings, setOptimisticSettings] = useOptimistic(
		settingsResult?.ok ? settingsResult.value : null,
		(state: OrgSettingsData | null, next: Partial<OrgSettingsData>) => {
			if (!state) return state
			return { ...state, ...next }
		},
	)
	const initialData = optimisticSettings

	const [frequency, setFrequency] = useState<string>(
		initialData?.report_frequency || 'weekly',
	)
	const [reportDay, setReportDay] = useState<string>(
		initialData?.report_day || 'Monday',
	)
	const [reportInterval, setReportInterval] = useState<number>(
		initialData?.report_interval || 1,
	)

	const { mutate, isPending } = useMutation({
		mutationFn: ({
			freq,
			day,
			interval,
		}: {
			freq: string
			day: string | null
			interval: number
		}) => {
			return updateOrgSettingAction(freq, day, interval)
		},
		onSuccess: (res) => {
			if (res.success) {
				toast.success('Settings updated')
			} else if ('error' in res) {
				toast.error(res.error || 'Update failed')
			}
		},
	})

	if (!isPaidPlan) {
		return (
			<Card className="p-8 text-center">
				<div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
					<Settings className="h-6 w-6 text-zinc-400" />
				</div>
				<h3 className="mb-2 font-bold text-xl">Premium Feature</h3>
				<p className="mx-auto max-w-sm text-muted-foreground">
					Custom report frequencies are only available on paid plans.
					Upgrade your organization to unlock this feature.
				</p>
				<Link className="mt-6 inline-block" href="/plans">
					<Button variant="outline">View Plans</Button>
				</Link>
			</Card>
		)
	}

	const options = [
		{
			id: 'weekly',
			label: 'Weekly (Fixed Dates)',
			description: 'Sent on the 1st, 8th, 16th, and 24th',
		},
		{
			id: 'twice-monthly',
			label: 'Twice Monthly (Pay Period)',
			description: 'Sent on the 1st and 16th',
		},
		{
			id: 'custom',
			label: 'Custom Weekday',
			description: 'Choose any day of the week',
		},
	]

	const hasChanged =
		frequency !== initialData?.report_frequency ||
		(frequency === 'custom' &&
			(reportDay !== initialData?.report_day ||
				reportInterval !== initialData?.report_interval))

	return (
		<Card className="p-8">
			<div className="mb-8">
				<h3 className="font-bold text-2xl tracking-tight">
					Report Frequency
				</h3>
				<p className="text-muted-foreground">
					Choose how often your team's hours reports are sent to
					admins.
				</p>
			</div>

			<div className="space-y-4">
				{options.map((option) => (
					<div className="space-y-4" key={option.id}>
						<button
							className={`flex w-full items-center justify-between rounded-2xl border-2 p-6 text-left transition-all ${
								frequency === option.id
									? 'border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-900'
									: 'border-transparent bg-zinc-100/50 hover:bg-zinc-100 dark:bg-zinc-800/50 dark:hover:bg-zinc-800'
							}`}
							onClick={() => setFrequency(option.id)}
							type="button"
						>
							<div className="flex items-center gap-4">
								<div
									className={`rounded-xl p-2 ${frequency === option.id ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-black' : 'bg-zinc-200 dark:bg-zinc-700'}`}
								>
									<Calendar className="h-5 w-5" />
								</div>
								<div>
									<div className="font-bold text-lg">
										{option.label}
									</div>
									<div className="text-muted-foreground text-sm">
										{option.description}
									</div>
								</div>
							</div>
							<div className="flex items-center gap-2">
								{frequency === option.id && (
									<div className="rounded-full bg-zinc-900 p-1 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900">
										<Check className="h-4 w-4" />
									</div>
								)}
								{initialData?.report_frequency ===
									option.id && (
									<span className="rounded-full bg-zinc-100 px-2 py-0.5 font-medium text-[10px] text-zinc-500 uppercase dark:bg-zinc-800">
										Current
									</span>
								)}
							</div>
						</button>

						{frequency === 'custom' && option.id === 'custom' && (
							<div className="fade-in slide-in-from-top-2 grid animate-in grid-cols-1 gap-4 p-6 pt-0 md:grid-cols-2">
								<div className="space-y-2">
									<label
										className="font-medium text-sm"
										htmlFor="reportDay"
									>
										Reporting Day
									</label>
									<select
										className="h-12 w-full rounded-xl border-2 border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-950"
										id="reportDay"
										onChange={(e) =>
											setReportDay(e.target.value)
										}
										value={reportDay}
									>
										{DAYS.map((day) => (
											<option key={day} value={day}>
												{day}
											</option>
										))}
									</select>
								</div>
								<div className="space-y-2">
									<label
										className="font-medium text-sm"
										htmlFor="reportInterval"
									>
										Interval
									</label>
									<select
										className="h-12 w-full rounded-xl border-2 border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-950"
										id="reportInterval"
										onChange={(e) =>
											setReportInterval(
												Number(e.target.value),
											)
										}
										value={reportInterval}
									>
										<option value={1}>Every week</option>
										<option value={2}>Every 2 weeks</option>
									</select>
								</div>
							</div>
						)}
					</div>
				))}
			</div>

			<div className="mt-8 flex justify-end">
				<Button
					className="h-12 px-8 font-bold"
					disabled={isPending || !hasChanged}
					onClick={() => {
						const freq = frequency
						const day = frequency === 'custom' ? reportDay : null
						const interval =
							frequency === 'custom' ? reportInterval : 1

						startTransition(async () => {
							setOptimisticSettings({
								report_frequency: freq,
								report_day: day,
								report_interval: interval,
							})

							await mutate({
								freq,
								day,
								interval,
							})
						})
					}}
				>
					{isPending && (
						<Loader2 className="mr-2 h-4 w-4 animate-spin" />
					)}
					Save Changes
				</Button>
			</div>
		</Card>
	)
}
