'use client'

import { useClerk } from '@clerk/nextjs'
import { use, useEffect } from 'react'

export function useOrgSwitcher(orgIdPromise: Promise<string | undefined>) {
	const { setActive, organization } = useClerk()
	const orgId = use(orgIdPromise)

	useEffect(() => {
		if (orgId && organization?.id !== orgId && setActive) {
			console.log(`[Org Switcher] Switching to organization: ${orgId}`)
			setActive({ organization: orgId })
		}
	}, [organization, setActive, orgId])

	return {
		orgId,
		currentOrgId: organization?.id,
		isSwitched: organization?.id === orgId,
	}
}
