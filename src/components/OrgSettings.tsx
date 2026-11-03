"use client";

import { use, useOptimistic } from "react";
import type { PayrollView } from "@/lib/payroll";
import type {
  AlertSettingsData,
  BreakSettingsData,
  LocationSettingsData,
  OvertimeSettingsData,
  PayRateData,
  ReportingSettingsData,
  SerializableResult,
  SiteData,
} from "@/lib/types";
import AlertSettings from "./AlertSettings";
import BreakSettings from "./BreakSettings";
import LocationSettings from "./LocationSettings";
import OvertimeSettings from "./OvertimeSettings";
import PayRateSettings from "./PayRateSettings";
import PayrollSettings from "./PayrollSettings";
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
  /** Every member's pay rate (this view is admin-only). */
  payRates?: PayRateData[];
  /** CPP/QPP and EI deduction settings, or null when they couldn't load. */
  payroll?: PayrollView | null;
  membersPromise?: Promise<{ id: string; name: string }[]>;
  sitesPromise?: Promise<SerializableResult<SiteData[], { reason: string }>>;
  alertSettingsPromise?: Promise<
    SerializableResult<AlertSettingsData, { reason: string }>
  >;
  hasReporting: boolean;
  hasGeofencing?: boolean;
  /** False when the org's plan does not include the `notifications` feature. */
  hasNotifications?: boolean;
}

export default function OrgSettings({
  hasReporting,
  hasGeofencing = false,
  hasNotifications = false,
  orgSettingsPromise,
  breakSettingsPromise,
  locationSettingsPromise,
  overtimeSettingsPromise,
  payRates = [],
  payroll = null,
  membersPromise,
  sitesPromise,
  alertSettingsPromise,
}: OrgSettingsProps) {
  const members = membersPromise ? use(membersPromise) : [];
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
  const alertSettingsResult = alertSettingsPromise
    ? use(alertSettingsPromise)
    : null;
  // The reporting read returns the flat reporting_settings row, so the
  // optimistic state is that row itself (not a nested `reporting` field).
  const [optimisticReportingSettings, setOptimisticReportingSettings] =
    useOptimistic(
      settingsResult?.ok ? settingsResult.value : null,
      (
        state: ReportingSettingsData | null,
        next: Partial<ReportingSettingsData>,
      ) => {
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
      {alertSettingsResult && (
        <AlertSettings
          hasNotifications={hasNotifications}
          initialData={
            alertSettingsResult.ok ? alertSettingsResult.value : null
          }
        />
      )}
      <OvertimeSettings
        initialData={optimisticOvertimeSettings}
        onUpdateOptimistic={(next) => setOptimisticOvertimeSettings(next)}
      />
      <PayRateSettings initialRates={payRates} members={members} />
      <PayrollSettings initialData={payroll} />
      <LocationSettings
        hasGeofencing={hasGeofencing}
        initialData={optimisticLocationSettings}
        onUpdateOptimistic={(next) => setOptimisticLocationSettings(next)}
        sites={sites}
      />
      <ReportingSettings
        hasReporting={hasReporting}
        initialData={optimisticReportingSettings}
        onUpdateOptimistic={(next) => setOptimisticReportingSettings(next)}
      />
    </div>
  );
}
