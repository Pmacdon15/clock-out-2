'use client'

import { Check, Users } from 'lucide-react'
import { Card } from '../ui'
import { COLORS } from './OrgHoursChart'

interface MemberTogglesProps {
	members: { id: string; name: string }[]
	visibleMemberIds: Set<string>
	toggleMember: (id: string) => void
	toggleAll: () => void
}

export function MemberToggles({
	members,
	visibleMemberIds,
	toggleMember,
	toggleAll,
}: MemberTogglesProps) {
	const allVisible =
		members.length > 0 && visibleMemberIds.size === members.length

	return (
		<Card className="p-6">
			<div className="mb-6 flex items-center justify-between">
				<div className="flex items-center gap-2">
					<Users className="h-5 w-5 text-zinc-500" />
					<h3 className="font-bold text-lg">Team Members</h3>
				</div>
				<button
					className="font-bold text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
					onClick={toggleAll}
					type="button"
				>
					{allVisible ? 'Deselect All' : 'Select All'}
				</button>
			</div>

			<div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1">
				{members.map((member, index) => {
					const isVisible = visibleMemberIds.has(member.id)
					const color = COLORS[index % COLORS.length]
					return (
						<button
							className={`flex items-center justify-between rounded-xl p-3 text-left transition-all ${
								isVisible
									? 'bg-zinc-100 dark:bg-zinc-800'
									: 'opacity-50 hover:opacity-100'
							}`}
							key={member.id}
							onClick={() => toggleMember(member.id)}
							type="button"
						>
							<div className="flex items-center gap-3">
								<div
									className="h-2 w-2 rounded-full"
									style={{ backgroundColor: color }}
								/>
								<span className="font-medium text-sm">
									{member.name}
								</span>
							</div>
							{isVisible && (
								<div className="rounded-full bg-zinc-900 p-0.5 text-zinc-50 dark:bg-zinc-50 dark:text-zinc-900">
									<Check className="h-3 w-3" />
								</div>
							)}
						</button>
					)
				})}
			</div>
		</Card>
	)
}
