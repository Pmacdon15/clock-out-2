"use client";

import { useClerk } from "@clerk/nextjs";
import { use, useEffect } from "react";

export function useOrgSwitcher(orgIdPromise: Promise<string | undefined>) {
  const { setActive, organization } = useClerk();
  const orgId = use(orgIdPromise);

  useEffect(() => {
    if (orgId && organization?.id !== orgId && orgId !== "" && setActive) {
      console.log(`[Org Switcher] Switching to organization: ${orgId}`);
      setActive({ organization: orgId }).catch((error) => {
        console.warn(`[Org Switcher] Failed to set active organization`, error);
      });
    }
  }, [organization, setActive, orgId]);

  return {
    orgId,
    currentOrgId: organization?.id,
    isSwitched: organization?.id === orgId,
  };
}
