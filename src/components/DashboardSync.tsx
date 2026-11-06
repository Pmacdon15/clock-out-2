"use client";

import type { NotificationSettingsView } from "@/lib/alerts-dal";
import type { SerializableResult } from "@/lib/types";
import { useOrgSwitcher } from "./OrgSwitcher";
import PushTokenSync from "./PushTokenSync";
import TimezoneSync from "./TimezoneSync";

/**
 * Background work every dashboard page needs, whichever page the member
 * opened first: follow the session's active organization, and keep this
 * device's time zone and push token current. Renders nothing.
 */
export default function DashboardSync({
  orgIdPromise,
  settingsPromise,
}: {
  orgIdPromise: Promise<string | undefined>;
  settingsPromise: Promise<
    SerializableResult<NotificationSettingsView, { reason: string }>
  >;
}) {
  useOrgSwitcher(orgIdPromise);
  return (
    <>
      <TimezoneSync settingsPromise={settingsPromise} />
      <PushTokenSync settingsPromise={settingsPromise} />
    </>
  );
}
