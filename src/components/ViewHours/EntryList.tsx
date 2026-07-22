'use client'

import type { TimeEntry } from '@/lib/dal'
import { Card } from '../ui'
import { EntryItem } from './EntryItem'

interface EntryListProps {
	entries: TimeEntry[]
	isAdmin: boolean
	setOptimisticEntries: (action: {
		type: 'ADD' | 'REMOVE' | 'UPDATE'
		payload: any
	}) => void
	isViewingAll?: boolean
	members?: { id: string; name: string }[]
}

export function EntryList({
	entries,
	isAdmin,
	setOptimisticEntries,
	isViewingAll = false,
	members = [],
}: EntryListProps) {
	return (
		<Card className="scrollbar-thin scrollbar-track-transparent scrollbar-thumb-zinc-300 hover:scrollbar-thumb-zinc-400 relative flex min-h-[100px] flex-col justify-between overflow-y-auto p-6 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5">
			<div className="space-y-6">
				<div>
					<h3 className="font-bold text-lg">Time Entries</h3>
					<p className="text-xs text-zinc-500 dark:text-zinc-400">
						{isViewingAll
							? 'Logged entries for all selected team members.'
							: 'Individual clock-in and clock-out history.'}
					</p>
				</div>
				<div className="custom-scrollbar max-h-125 space-y-6 pr-2">
					{entries.length === 0 ? (
						<div className="flex flex-col items-center justify-center py-12 text-center text-zinc-500 italic">
							<p className="text-sm">
								No entries for this period
							</p>
							<p className="mt-1 font-bold text-[10px] text-zinc-400 uppercase">
								Try a different timeframe
							</p>
						</div>
					) : (
						entries.map((entry) => {
							const memberName = isViewingAll
								? members.find((m) => m.id === entry.user_id)?.name
								: undefined
							return (
								<EntryItem
									entry={entry}
									isAdmin={isAdmin}
									key={entry.id}
									memberName={memberName}
									setOptimisticEntries={setOptimisticEntries}
								/>
							)
						})
					)}
				</div>
			</div>
		</Card>
	)
}
