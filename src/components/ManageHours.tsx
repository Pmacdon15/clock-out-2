'use client'

import { useMutation } from '@tanstack/react-query'
import { Clock, Loader2, Play, Square, Trash2 } from 'lucide-react'
import { startTransition, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { clockInAction, clockOutAction } from '@/lib/actions'
import type { TimeEntry } from '@/lib/dal'
import { DeleteConfirmDialog } from './DeleteConfirmDialog'
import { Button, Card } from './ui'

const formatDuration = (start: Date, end: Date = new Date()) => {
	const diffMs = Math.abs(end.getTime() - start.getTime())
	const totalMinutes = Math.floor(diffMs / (1000 * 60))
	const hours = Math.floor(totalMinutes / 60)
	const minutes = totalMinutes % 60

	if (hours > 0) {
		return `${hours}h ${minutes}m`
	}
	return `${minutes}m`
}

interface ManageHoursProps {
	initialEntries: TimeEntry[]
	isAdmin: boolean
	setOptimisticEntries: (action: {
		type: 'ADD' | 'REMOVE' | 'UPDATE'
		payload: any
	}) => void
}

export default function ManageHours({
	initialEntries = [],
	isAdmin,
	setOptimisticEntries,
}: ManageHoursProps) {
	const activeEntry = initialEntries?.find?.((e) => !e.clock_out)
	const [elapsedTime, setElapsedTime] = useState<string>('')

	useEffect(() => {
		if (!activeEntry) return

		const interval = setInterval(() => {
			setElapsedTime(formatDuration(new Date(activeEntry.clock_in)))
		}, 1000)

		setElapsedTime(formatDuration(new Date(activeEntry.clock_in)))

		return () => clearInterval(interval)
	}, [activeEntry])

	const clockInMutation = useMutation({
		mutationFn: clockInAction,
		onSuccess: (res) => {
			if (res.success) toast.success('Clocked in')
			else if ('error' in res)
				toast.error(res.error || 'Failed to clock in')
		},
	})

	const clockOutMutation = useMutation({
		mutationFn: clockOutAction,
		onSuccess: (res) => {
			if (res.success) toast.success('Clocked out')
			else if ('error' in res)
				toast.error(res.error || 'Failed to clock out')
		},
	})

	const handleClockIn = () => {
		const now = new Date()

		const tempEntry: TimeEntry = {
			id: Math.random(),
			user_id: 'current',
			org_id: 'current',
			clock_in: now,
			clock_out: null,
			created_at: now,
			updated_at: now,
		}

		startTransition(() => {
			setOptimisticEntries({ type: 'ADD', payload: tempEntry })
			clockInMutation.mutate()
		})
	}

	const handleClockOut = () => {
		if (!activeEntry) return

		const now = new Date()

		startTransition(() => {
			// This updates the specific entry in the list to have a clock_out time
			setOptimisticEntries({
				type: 'UPDATE',
				payload: {
					id: activeEntry.id,
					clock_out: now,
					updated_at: now,
				},
			})

			clockOutMutation.mutate()
		})
	}

	return (
		<Card className="mb-8 flex flex-col items-center justify-center p-8 text-center sm:p-12">
			{activeEntry ? (
				<>
					<div className="mb-6 flex items-center gap-2 rounded-full bg-green-100 px-3 py-1 font-medium text-green-700 text-sm dark:bg-green-900/30 dark:text-green-500">
						<span className="relative flex h-2 w-2">
							<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75"></span>
							<span className="relative inline-flex h-2 w-2 rounded-full bg-green-500"></span>
						</span>
						Active Session
					</div>
					<div className="mb-2 font-black font-mono text-6xl tracking-tighter">
						{elapsedTime || '0m'}
					</div>
					<p className="mb-8 flex items-center gap-2 text-muted-foreground">
						<Clock className="h-4 w-4" />
						Started at{' '}
						{new Date(activeEntry.clock_in).toLocaleTimeString()}
					</p>
					<Button
						className="h-16 w-full max-w-sm gap-3 rounded-2xl font-bold text-lg"
						disabled={clockOutMutation.isPending}
						onClick={handleClockOut}
						variant="destructive"
					>
						{clockOutMutation.isPending ? (
							<Loader2 className="animate-spin" />
						) : (
							<Square className="fill-current" />
						)}
						Clock Out
					</Button>
				</>
			) : (
				<>
					<div className="mb-6 flex items-center gap-2 rounded-full border bg-zinc-100 px-3 py-1 font-medium text-sm text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
						Offline
					</div>
					<div className="mb-8 font-black text-4xl tracking-tight">
						Ready to start your shift?
					</div>
					<Button
						className="h-16 w-full max-w-sm gap-3 rounded-2xl font-bold text-lg"
						disabled={clockInMutation.isPending}
						onClick={handleClockIn}
					>
						{clockInMutation.isPending ? (
							<Loader2 className="animate-spin" />
						) : (
							<Play className="fill-current" />
						)}
						Clock In
					</Button>
				</>
			)}

			<div className="mt-12 w-full text-left">
				<div className="mb-4 flex items-center justify-between">
					<h3 className="font-bold text-lg">Recent Activity</h3>
				</div>
				<div className="space-y-3">
					{initialEntries.slice(0, 5).map((entry) => (
						<div
							className="flex items-center justify-between rounded-xl border p-4 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900"
							key={entry.id}
						>
							<div className="flex flex-col">
								<span className="font-semibold">
									{new Date(
										entry.clock_in,
									).toLocaleDateString()}
								</span>
								<span className="text-muted-foreground text-xs">
									{new Date(
										entry.clock_in,
									).toLocaleTimeString()}{' '}
									-{' '}
									{entry.clock_out
										? new Date(
												entry.clock_out,
											).toLocaleTimeString()
										: 'Current'}
								</span>
							</div>
							<div className="flex items-center gap-3">
								<div className="rounded-md bg-zinc-100 px-3 py-1 font-bold font-mono text-sm dark:bg-zinc-800">
									{entry.clock_out
										? formatDuration(
												new Date(entry.clock_in),
												new Date(entry.clock_out),
											)
										: 'Active'}
								</div>
								{isAdmin && (
									<DeleteConfirmDialog
										entryId={entry.id}
										setOptimisticEntries={
											setOptimisticEntries
										}
										trigger={
											<button
												className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
												type="button"
											>
												<Trash2 className="h-4 w-4" />
											</button>
										}
									/>
								)}
							</div>
						</div>
					))}
				</div>
			</div>
		</Card>
	)
}
