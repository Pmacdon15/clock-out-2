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
}

export function EntryList({
	entries,
	isAdmin,
	setOptimisticEntries,
}: EntryListProps) {
	return (
		<Card className="relative flex min-h-[400px] flex-col justify-between overflow-hidden p-6">
			<div className="space-y-4">
				<h3 className="mb-6 font-bold text-lg">Details</h3>
				<div className="custom-scrollbar max-h-[500px] space-y-6 overflow-auto pr-2">
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
						entries.map((entry) => (
							<EntryItem
								entry={entry}
								isAdmin={isAdmin}
								key={entry.id}
								setOptimisticEntries={setOptimisticEntries}
							/>
						))
					)}
				</div>
			</div>
		</Card>
	)
}
