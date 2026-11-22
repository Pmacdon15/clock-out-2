"use client";

import type { NotificationSettingsView } from "@/lib/alerts-dal";
import type { ArrivalWatchConfig } from "@/lib/arrival-dal";
import type { SerializableResult } from "@/lib/types";
import ArrivalPromptSync from "./ArrivalPromptSync";
import { useOrgSwitcher } from "./OrgSwitcher";
import PushTokenSync from "./PushTokenSync";
import TimezoneSync from "./TimezoneSync";

/**
 * Background work every dashboard page needs, whichever page the member
 * opened first: follow the session's active organization, keep this
 * device's time zone and push token current, and watch for arrivals at a
 * work site. Renders nothing.
 */
export default function DashboardSync({
  orgIdPromise,
  settingsPromise,
  arrivalConfigPromise,
}: {
  orgIdPromise: Promise<string | undefined>;
  settingsPromise: Promise<
    SerializableResult<NotificationSettingsView, { reason: string }>
  >;
  arrivalConfigPromise: Promise<
    SerializableResult<ArrivalWatchConfig, { reason: string }>
  >;
}) {
  useOrgSwitcher(orgIdPromise);
  return (
    <>
      <TimezoneSync settingsPromise={settingsPromise} />
      <PushTokenSync settingsPromise={settingsPromise} />
      <ArrivalPromptSync configPromise={arrivalConfigPromise} />
    </>
  );
}
