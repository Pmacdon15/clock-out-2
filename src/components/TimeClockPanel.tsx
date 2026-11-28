"use client";

import { use, useOptimistic } from "react";
import TimeClock from "@/components/time-clock";
import { timeEntriesReducer } from "@/lib/reducers/time-entries";
import type {
  BreakSettingsData,
  LocationSettingsData,
  ScheduledShift,
  SerializableResult,
  TimeEntry,
} from "@/lib/types";

type Result<T> = Promise<SerializableResult<T, { reason: string }>>;

/**
 * The Time Clock page's data hole. Unwraps what the server started loading
 * and keeps the recent entries optimistic, so a punch shows at once while
 * the server action (and the `updateTag` it calls) catches up.
 */
export default function TimeClockPanel({
  recentEntriesPromise,
  breakSettingsPromise,
  locationSettingsPromise,
  hasGeofencingPromise,
  isAdminPromise,
  shiftsPromise,
}: {
  recentEntriesPromise: Result<TimeEntry[]>;
  breakSettingsPromise: Result<BreakSettingsData | null>;
  locationSettingsPromise: Result<LocationSettingsData | null>;
  hasGeofencingPromise: Promise<boolean>;
  isAdminPromise: Promise<boolean>;
  shiftsPromise: Result<ScheduledShift[]>;
}) {
  const recent = use(recentEntriesPromise);
  const breakSettings = use(breakSettingsPromise);
  const locationSettings = use(locationSettingsPromise);
  const hasGeofencing = use(hasGeofencingPromise);
  const isAdmin = use(isAdminPromise);
  const shifts = use(shiftsPromise);

  const [entries, setOptimisticEntries] = useOptimistic(
    recent.ok ? (recent.value ?? []) : [],
    timeEntriesReducer,
  );

  return (
    <TimeClock
      breakSettings={breakSettings.ok ? breakSettings.value : null}
      initialEntries={entries}
      isAdmin={isAdmin}
      // Without the paid feature the clock behaves exactly as it always has:
      // no location prompt, nothing captured.
      locationSettings={
        hasGeofencing && locationSettings.ok ? locationSettings.value : null
      }
      scheduledShifts={shifts.ok ? shifts.value : undefined}
      setOptimisticEntries={setOptimisticEntries}
    />
  );
}
