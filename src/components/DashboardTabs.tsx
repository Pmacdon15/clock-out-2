"use client";

import { Suspense, use, useOptimistic } from "react";
import TimeClock from "@/components/time-clock";
import { timeEntriesReducer } from "@/lib/reducers/time-entries";
import type { DashboardTabsProps } from "@/lib/types";
import OrgSettings from "./OrgSettings";
import { useOrgSwitcher } from "./OrgSwitcher";
import { Card } from "./ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { SettingsFallback } from "./fallbacks/settings-fallback";
import { ViewHoursFallback } from "./fallbacks/view-hours-fallback";
import ViewHours from "./ViewHours";

export default function DashboardTabs({
  defaultTabPromise,
  orgSettingsPromise,
  entriesPromise,
  orgTimeEntriesPromise,
  recentEntriesPromise,
  membersPromise,
  selectedUserIdPromise,
  selectedWeekPromise,
  selectedMonthPromise,
  selectedYearPromise,
  timeframePromise,
  startDatePromise,
  endDatePromise,
  isAdminPromise,
  hasReportingPromise,
  userIdPromise,
  orgIdPromise,
}: DashboardTabsProps) {
  useOrgSwitcher(orgIdPromise);
  const hasReporting = use(hasReportingPromise);
  const isAdmin = use(isAdminPromise);
  const result = use(entriesPromise);
  const recentEntriesResult = use(recentEntriesPromise);
  const defaultTab = use(defaultTabPromise) || "time-clock";

  const [optimisticEntries, setOptimisticEntries] = useOptimistic(
    result.ok ? (result.value ?? []) : [],
    timeEntriesReducer,
  );

  const [optimisticRecentEntries, setOptimisticRecentEntries] = useOptimistic(
    recentEntriesResult.ok ? (recentEntriesResult.value ?? []) : [],
    timeEntriesReducer,
  );

  if (!result.ok) {
    return (
      <Card className="p-8 text-center text-red-500">
        {"Error fetching time entries: "}
        {result.error.reason}
      </Card>
    );
  }

  return (
    <Tabs className="space-y-8" defaultValue={defaultTab}>
      <TabsList>
        <TabsTrigger value="time-clock">Time Clock</TabsTrigger>
        <TabsTrigger value="view">Hours</TabsTrigger>
        {isAdmin && hasReporting && (
          <TabsTrigger value="settings">Settings</TabsTrigger>
        )}
      </TabsList>

      <TabsContent className="mt-0" value="time-clock">
        <TimeClock
          initialEntries={optimisticRecentEntries}
          isAdmin={isAdmin}
          setOptimisticEntries={setOptimisticRecentEntries}
        />
      </TabsContent>

      <TabsContent className="mt-0" value="view">
        <Suspense
          fallback={<ViewHoursFallback />}
        >
          <ViewHours
            currentUserIdPromise={userIdPromise}
            endDatePromise={endDatePromise}
            entries={optimisticEntries}
            isAdmin={isAdmin}
            membersPromise={membersPromise}
            orgTimeEntriesPromise={orgTimeEntriesPromise}
            selectedMonthPromise={selectedMonthPromise}
            selectedUserIdPromise={selectedUserIdPromise}
            selectedWeekPromise={selectedWeekPromise}
            selectedYearPromise={selectedYearPromise}
            setOptimisticEntries={setOptimisticEntries}
            startDatePromise={startDatePromise}
            timeframePromise={timeframePromise}
          />
        </Suspense>
      </TabsContent>

      {isAdmin && hasReporting && (
        <TabsContent className="mt-0" value="settings">
          <Suspense fallback={<SettingsFallback />}>
            <OrgSettings
              hasReporting={hasReporting}
              orgSettingsPromise={orgSettingsPromise}
            />
          </Suspense>
        </TabsContent>
      )}
    </Tabs>
  );
}
