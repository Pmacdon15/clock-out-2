import { Suspense } from "react";
import TimeClockSkeleton from "@/components/fallbacks/time-clock-fallback";
import McpConnectCard from "@/components/McpConnectCard";
import TimeClockPanel from "@/components/TimeClockPanel";
import {
  getOrgBreakSettings,
  getOrgLocationSettings,
  getTimeEntries,
} from "@/lib/dal";
import { GEOFENCING_FEATURE } from "@/lib/plan-features";
import { hasFeature, isAdmin } from "@/lib/session";

export default function TimeClockPage() {
  return (
    <>
      <h2 className="sr-only">Time Clock</h2>
      <Suspense fallback={<TimeClockSkeleton />}>
        <TimeClockPanel
          breakSettingsPromise={getOrgBreakSettings()}
          hasGeofencingPromise={hasFeature(GEOFENCING_FEATURE)}
          isAdminPromise={isAdmin()}
          locationSettingsPromise={getOrgLocationSettings()}
          recentEntriesPromise={getTimeEntries()}
        />
      </Suspense>
      <McpConnectCard />
    </>
  );
}
