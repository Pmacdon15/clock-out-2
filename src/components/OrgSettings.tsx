"use client";

import { use, useOptimistic } from "react";
import type {
  BreakSettingsData,
  LocationSettingsData,
  OrgSettingsData,
  OvertimeSettingsData,
  ReportingSettingsData,
  SerializableResult,
  SiteData,
} from "@/lib/types";
import BreakSettings from "./BreakSettings";
import LocationSettings from "./LocationSettings";
import OvertimeSettings from "./OvertimeSettings";
import ReportingSettings from "./ReportingSettings";

interface OrgSettingsProps {
  orgSettingsPromise: Promise<
    SerializableResult<
      ReportingSettingsData | null,
      {
        reason: string;
      }
    >
  >;
  breakSettingsPromise?: Promise<
    SerializableResult<
      BreakSettingsData | null,
      {
        reason: string;
      }
    >
  >;
  locationSettingsPromise?: Promise<
    SerializableResult<
      LocationSettingsData | null,
      {
        reason: string;
      }
    >
  >;
  overtimeSettingsPromise?: Promise<
    SerializableResult<OvertimeSettingsData | null, { reason: string }>
  >;
  sitesPromise?: Promise<SerializableResult<SiteData[], { reason: string }>>;
  hasReporting: boolean;
  hasGeofencing?: boolean;
}

export default function OrgSettings({
  hasReporting,
  hasGeofencing = false,
  orgSettingsPromise,
  breakSettingsPromise,
  locationSettingsPromise,
  overtimeSettingsPromise,
  sitesPromise,
}: OrgSettingsProps) {
  const settingsResult = use(orgSettingsPromise);
  const breakSettingsResult = breakSettingsPromise
    ? use(breakSettingsPromise)
    : null;
  const locationSettingsResult = locationSettingsPromise
    ? use(locationSettingsPromise)
    : null;
  const overtimeSettingsResult = overtimeSettingsPromise
    ? use(overtimeSettingsPromise)
    : null;
  const sitesResult = sitesPromise ? use(sitesPromise) : null;
  const sites = sitesResult?.ok ? sitesResult.value : [];
  const [optimisticSettings, setOptimisticSettings] = useOptimistic(
    settingsResult?.ok ? settingsResult.value : null,
    (state: OrgSettingsData | null, next: Partial<OrgSettingsData>) => {
      if (!state) return state;
      return { ...state, ...next };
    },
  );
  const [optimisticBreakSettings, setOptimisticBreakSettings] = useOptimistic(
    breakSettingsResult?.ok ? breakSettingsResult.value : null,
    (state: BreakSettingsData | null, next: Partial<BreakSettingsData>) => {
      if (!state) return state;
      return { ...state, ...next };
    },
  );

  const [optimisticLocationSettings, setOptimisticLocationSettings] =
    useOptimistic(
      locationSettingsResult?.ok ? locationSettingsResult.value : null,
      (
        state: LocationSettingsData | null,
        next: Partial<LocationSettingsData>,
      ) => {
        if (!state) return state;
        return { ...state, ...next };
      },
    );

  const [optimisticOvertimeSettings, setOptimisticOvertimeSettings] =
    useOptimistic(
      overtimeSettingsResult?.ok ? overtimeSettingsResult.value : null,
      (
        state: OvertimeSettingsData | null,
        next: Partial<OvertimeSettingsData>,
      ) => {
        if (!state) return state;
        return { ...state, ...next };
      },
    );

  return (
    <div className="space-y-8">
      <BreakSettings
        initialData={optimisticBreakSettings}
        onUpdateOptimistic={(next) => setOptimisticBreakSettings(next)}
      />
      <OvertimeSettings
        initialData={optimisticOvertimeSettings}
        onUpdateOptimistic={(next) => setOptimisticOvertimeSettings(next)}
      />
      <LocationSettings
        hasGeofencing={hasGeofencing}
        initialData={optimisticLocationSettings}
        onUpdateOptimistic={(next) => setOptimisticLocationSettings(next)}
        sites={sites}
      />
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
    </div>
  );
}
