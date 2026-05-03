'use client'

import { use, useOptimistic } from 'react'
import type {
	OrgSettingsData,
	ReportingSettingsData,
	SerializableResult,
} from '@/lib/types'
import ReportingSettings from './ReportingSettings'

interface OrgSettingsProps {
	orgSettingsPromise: Promise<
		SerializableResult<OrgSettingsData, { reason: string }>
	>
	hasReporting: boolean
}

export default function OrgSettings({
	hasReporting,
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

	return (
		<div className="space-y-8">
			<ReportingSettings
				hasReporting={hasReporting}
				initialData={optimisticSettings?.reporting ?? null}
				onUpdateOptimistic={(next) =>
					setOptimisticSettings({
						reporting: {
							...optimisticSettings?.reporting,
							...next,
						} as ReportingSettingsData,
					})
				}
			/>
			{/* Future settings modules can be added here */}
		</div>
	)
}
