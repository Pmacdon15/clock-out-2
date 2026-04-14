'use client'

import { useMutation } from '@tanstack/react-query'
import { format } from 'date-fns'
import { Calendar, Check, Edit3, Loader2, X } from 'lucide-react'
import { startTransition, useState } from 'react'
import { toast } from 'sonner'
import { updateTimeEntryAction } from '@/lib/actions'
import type { TimeEntry } from '@/lib/dal'
import { DeleteConfirmDialog } from '../DeleteConfirmDialog'

interface EntryItemProps {
	entry: TimeEntry
	isAdmin: boolean
	setOptimisticEntries: (action: {
		type: 'ADD' | 'REMOVE' | 'UPDATE'
		payload: any
	}) => void
}

export function EntryItem({
	entry,
	isAdmin,
	setOptimisticEntries,
}: EntryItemProps) {
	const [isEditing, setIsEditing] = useState(false)
	const [editClockIn, setEditClockIn] = useState(
		format(new Date(entry.clock_in), "yyyy-MM-dd'T'HH:mm"),
	)
	const [editClockOut, setEditClockOut] = useState(
		entry.clock_out
			? format(new Date(entry.clock_out), "yyyy-MM-dd'T'HH:mm")
			: '',
	)

	const updateMutation = useMutation({
		mutationFn: ({
			id,
			clock_in,
			clock_out,
		}: {
			id: number
			clock_in: string
			clock_out: string
		}) => updateTimeEntryAction(id, clock_in, clock_out),
		onSuccess: (res) => {
			if (res.success) {
				toast.success('Entry updated')
				setIsEditing(false)
			} else if ('error' in res) {
				toast.error(res.error || 'Failed to update')
			}
		},
	})

	const handleUpdate = () => {
		const updatedData = {
			id: entry.id,
			clock_in: new Date(editClockIn),
			clock_out: editClockOut ? new Date(editClockOut) : null,
			updated_at: new Date(),
		}

		startTransition(() => {
			setOptimisticEntries({ type: 'UPDATE', payload: updatedData })

			updateMutation.mutate({
				id: entry.id,
				clock_in: new Date(editClockIn).toISOString(),
				clock_out: editClockOut
					? new Date(editClockOut).toISOString()
					: '',
			})
		})
	}

	if (isEditing) {
		return (
			<div className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/50">
				<div className="grid grid-cols-2 gap-3">
					<div className="space-y-1">
						<label
							className="font-bold text-[10px] text-zinc-400 uppercase"
							htmlFor={`edit-in-${entry.id}`}
						>
							Clock In
						</label>
						<input
							className="w-full rounded-lg border bg-white p-2 text-xs outline-none focus:ring-1 focus:ring-zinc-400 dark:bg-zinc-950"
							id={`edit-in-${entry.id}`}
							onChange={(e) => setEditClockIn(e.target.value)}
							type="datetime-local"
							value={editClockIn}
						/>
					</div>
					<div className="space-y-1">
						<label
							className="font-bold text-[10px] text-zinc-400 uppercase"
							htmlFor={`edit-out-${entry.id}`}
						>
							Clock Out
						</label>
						<input
							className="w-full rounded-lg border bg-white p-2 text-xs outline-none focus:ring-1 focus:ring-zinc-400 dark:bg-zinc-950"
							id={`edit-out-${entry.id}`}
							onChange={(e) => setEditClockOut(e.target.value)}
							type="datetime-local"
							value={editClockOut}
						/>
					</div>
				</div>
				<div className="flex justify-end gap-2">
					<button
						className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-200 dark:hover:bg-zinc-800"
						onClick={() => setIsEditing(false)}
						type="button"
					>
						<X className="h-4 w-4" />
					</button>
					<button
						className="rounded-lg bg-zinc-900 p-1.5 text-white transition-transform hover:scale-105 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950"
						disabled={updateMutation.isPending}
						onClick={handleUpdate}
						type="button"
					>
						{updateMutation.isPending ? (
							<Loader2 className="h-4 w-4 animate-spin" />
						) : (
							<Check className="h-4 w-4" />
						)}
					</button>
				</div>
			</div>
		)
	}

	return (
		<div className="group flex flex-col gap-2 border-zinc-100 border-b pb-5 transition-all last:border-0 dark:border-zinc-800">
			<div className="flex items-center justify-between font-bold text-sm">
				<span>{format(new Date(entry.clock_in), 'eeee, MMM d')}</span>
				<div className="flex items-center gap-3">
					<span className="tabular-nums">
						{entry.clock_out
							? (
									(new Date(entry.clock_out).getTime() -
										new Date(entry.clock_in).getTime()) /
									(1000 * 60 * 60)
								).toFixed(2)
							: '0.00'}
						h
					</span>
					{isAdmin && (
						<div className="flex items-center gap-1 opacity-100 transition-opacity lg:opacity-0 lg:group-hover:opacity-100">
							<button
								className="p-1 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
								onClick={() => setIsEditing(true)}
								type="button"
							>
								<Edit3 className="h-3.5 w-3.5" />
							</button>
							<DeleteConfirmDialog
								entryId={entry.id}
								setOptimisticEntries={setOptimisticEntries}
							/>
						</div>
					)}
				</div>
			</div>
			<div className="flex items-center gap-1.5 font-medium text-muted-foreground text-xs">
				<Calendar className="h-3 w-3" />
				{format(new Date(entry.clock_in), 'hh:mm a')} -{' '}
				{entry.clock_out
					? format(new Date(entry.clock_out), 'hh:mm a')
					: '...'}
			</div>
		</div>
	)
}
