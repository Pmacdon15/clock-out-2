"use client";

import { CalendarDays, Plane } from "lucide-react";
import { Suspense, use, useOptimistic } from "react";
import TimeClock from "@/components/time-clock";
import { timeEntriesReducer } from "@/lib/reducers/time-entries";
import type { DashboardTabsProps } from "@/lib/types";
import { SettingsFallback } from "./fallbacks/settings-fallback";
import { ViewHoursFallback } from "./fallbacks/view-hours-fallback";
import NotificationSettings from "./NotificationSettings";
import OrgSettings from "./OrgSettings";
import { useOrgSwitcher } from "./OrgSwitcher";
import { PremiumFeatureCard } from "./PremiumFeatureCard";
import Schedule from "./Schedule";
import TimeOff from "./TimeOff";
import TimezoneSync from "./TimezoneSync";
import { Card } from "./ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import ViewHours from "./ViewHours";

export default function DashboardTabs({
  defaultTabPromise,
  orgSettingsPromise,
  breakSettingsPromise,
  locationSettingsPromise,
  overtimeSettingsPromise,
  payRatesPromise,
  payrollPromise,
  sitesPromise,
  alertSettingsPromise,
  notificationSettingsPromise,
  entriesPromise,
  orgTimeEntriesPromise,
  recentEntriesPromise,
  schedulePromise,
  timeOffPromise,
  timeOffAllowancesPromise,
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
  hasGeofencingPromise,
  hasSchedulingPromise,
  hasTimeOffPromise,
  hasNotificationsPromise,
  userIdPromise,
  orgIdPromise,
}: DashboardTabsProps) {
  useOrgSwitcher(orgIdPromise);
  const hasReporting = use(hasReportingPromise);
  const hasGeofencing = hasGeofencingPromise
    ? use(hasGeofencingPromise)
    : false;
  const hasScheduling = use(hasSchedulingPromise);
  const hasTimeOff = use(hasTimeOffPromise);
  const hasNotifications = hasNotificationsPromise
    ? use(hasNotificationsPromise)
    : false;
  const isAdmin = use(isAdminPromise);
  const result = use(entriesPromise);
  const recentEntriesResult = use(recentEntriesPromise);
  const breakSettingsResult = breakSettingsPromise
    ? use(breakSettingsPromise)
    : null;
  const breakSettings = breakSettingsResult?.ok
    ? breakSettingsResult.value
    : null;
  const overtimeSettingsResult = overtimeSettingsPromise
    ? use(overtimeSettingsPromise)
    : null;
  const overtimeSettings = overtimeSettingsResult?.ok
    ? overtimeSettingsResult.value
    : null;
  const payRatesResult = payRatesPromise ? use(payRatesPromise) : null;
  const payRates = payRatesResult?.ok ? payRatesResult.value : [];
  const payrollResult = payrollPromise ? use(payrollPromise) : null;
  const payroll = payrollResult?.ok ? payrollResult.value : null;
  const locationSettingsResult = locationSettingsPromise
    ? use(locationSettingsPromise)
    : null;
  // Without the paid feature the clock behaves exactly as it always has: no
  // location prompt, nothing captured.
  const locationSettings =
    hasGeofencing && locationSettingsResult?.ok
      ? locationSettingsResult.value
      : null;
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
      {notificationSettingsPromise && (
        <Suspense fallback={null}>
          <TimezoneSync settingsPromise={notificationSettingsPromise} />
        </Suspense>
      )}
      <TabsList>
        <TabsTrigger value="time-clock">Time Clock</TabsTrigger>
        <TabsTrigger value="view">Hours</TabsTrigger>
        {notificationSettingsPromise && (
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
        )}
        <TabsTrigger value="schedule">Schedule</TabsTrigger>
        <TabsTrigger value="time-off">Time Off</TabsTrigger>
        {isAdmin && <TabsTrigger value="settings">Settings</TabsTrigger>}
      </TabsList>

      <TabsContent className="mt-0" value="time-clock">
        <TimeClock
          breakSettings={breakSettings}
          initialEntries={optimisticRecentEntries}
          isAdmin={isAdmin}
          locationSettings={locationSettings}
          setOptimisticEntries={setOptimisticRecentEntries}
        />
      </TabsContent>

      <TabsContent className="mt-0" value="view">
        <Suspense fallback={<ViewHoursFallback />}>
          <ViewHours
            breakSettings={breakSettings}
            currentUserIdPromise={userIdPromise}
            endDatePromise={endDatePromise}
            entries={optimisticEntries}
            isAdmin={isAdmin}
            membersPromise={membersPromise}
            orgTimeEntriesPromise={orgTimeEntriesPromise}
            overtimeSettings={overtimeSettings}
            payRates={payRates}
            payroll={payroll}
            selectedMonthPromise={selectedMonthPromise}
            selectedUserIdPromise={selectedUserIdPromise}
            selectedWeekPromise={selectedWeekPromise}
            selectedYearPromise={selectedYearPromise}
            setOptimisticEntries={setOptimisticEntries}
            startDatePromise={startDatePromise}
            timeOffPromise={timeOffPromise}
            timeframePromise={timeframePromise}
          />
        </Suspense>
      </TabsContent>

      {notificationSettingsPromise && (
        <TabsContent className="mt-0" value="notifications">
          <Suspense fallback={<SettingsFallback />}>
            <NotificationSettings
              hasNotifications={hasNotifications}
              isAdmin={isAdmin}
              settingsPromise={notificationSettingsPromise}
            />
          </Suspense>
        </TabsContent>
      )}
      <TabsContent className="mt-0" value="schedule">
        {hasScheduling ? (
          <Suspense fallback={<ViewHoursFallback />}>
            <Schedule
              isAdmin={isAdmin}
              membersPromise={membersPromise}
              schedulePromise={schedulePromise}
              timeOffPromise={timeOffPromise}
            />
          </Suspense>
        ) : (
          <PremiumFeatureCard
            description="Scheduling shifts is only available on paid plans. Upgrade your organization to unlock this feature."
            icon={CalendarDays}
          />
        )}
      </TabsContent>

      <TabsContent className="mt-0" value="time-off">
        {hasTimeOff ? (
          <Suspense fallback={<ViewHoursFallback />}>
            <TimeOff
              allowancesPromise={timeOffAllowancesPromise}
              currentUserIdPromise={userIdPromise}
              isAdmin={isAdmin}
              membersPromise={membersPromise}
              timeOffPromise={timeOffPromise}
            />
          </Suspense>
        ) : (
          <PremiumFeatureCard
            description="Time off requests and PTO tracking are only available on paid plans. Upgrade your organization to unlock this feature."
            icon={Plane}
          />
        )}
      </TabsContent>

      {isAdmin && (
        <TabsContent className="mt-0" value="settings">
          <Suspense fallback={<SettingsFallback />}>
            <OrgSettings
              alertSettingsPromise={alertSettingsPromise}
              breakSettingsPromise={breakSettingsPromise}
              hasGeofencing={hasGeofencing}
              hasNotifications={hasNotifications}
              hasReporting={hasReporting}
              locationSettingsPromise={locationSettingsPromise}
              membersPromise={membersPromise}
              orgSettingsPromise={orgSettingsPromise}
              overtimeSettingsPromise={overtimeSettingsPromise}
              payRates={payRates}
              payroll={payroll}
              sitesPromise={sitesPromise}
            />
          </Suspense>
        </TabsContent>
      )}
    </Tabs>
  );
}
