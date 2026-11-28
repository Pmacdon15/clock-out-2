"use client";

import { Bell, Clock, type LucideIcon, MapPin, Wallet } from "lucide-react";
import { use, useEffect, useOptimistic, useState } from "react";
import { DEFAULT_PROVINCE, type PayrollView } from "@/lib/payroll";
import type {
  AlertSettingsData,
  BreakSettingsData,
  LocationSettingsData,
  OvertimeSettingsData,
  PayPeriodSettingsData,
  PayRateData,
  ReportingSettingsData,
  SerializableResult,
  SiteData,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import AlertSettings from "./AlertSettings";
import BreakSettings from "./BreakSettings";
import LocationSettings from "./LocationSettings";
import OvertimeSettings from "./OvertimeSettings";
import PayPeriodSettings from "./PayPeriodSettings";
import PayRateSettings from "./PayRateSettings";
import PayrollSettings from "./PayrollSettings";
import ReportingSettings from "./ReportingSettings";
import TaxClaimSettings from "./TaxClaimSettings";

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
  payPeriodSettingsPromise?: Promise<
    SerializableResult<PayPeriodSettingsData | null, { reason: string }>
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
  /** False when the org's plan does not include the `scheduling` feature. */
  hasScheduling?: boolean;
}

export default function OrgSettings({
  hasReporting,
  hasGeofencing = false,
  hasNotifications = false,
  hasScheduling = false,
  orgSettingsPromise,
  breakSettingsPromise,
  locationSettingsPromise,
  overtimeSettingsPromise,
  payPeriodSettingsPromise,
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
  const payPeriodSettingsResult = payPeriodSettingsPromise
    ? use(payPeriodSettingsPromise)
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

  const [optimisticPayPeriodSettings, setOptimisticPayPeriodSettings] =
    useOptimistic(
      payPeriodSettingsResult?.ok ? payPeriodSettingsResult.value : null,
      (
        state: PayPeriodSettingsData | null,
        next: Partial<PayPeriodSettingsData>,
      ) => {
        if (!state) return state;
        return { ...state, ...next };
      },
    );

  const sections: SettingsSectionDef[] = [
    {
      id: "time",
      label: "Time & Breaks",
      description: "Break deductions and overtime rules",
      icon: Clock,
      content: (
        <>
          <BreakSettings
            initialData={optimisticBreakSettings}
            onUpdateOptimistic={(next) => setOptimisticBreakSettings(next)}
          />
          <OvertimeSettings
            initialData={optimisticOvertimeSettings}
            onUpdateOptimistic={(next) => setOptimisticOvertimeSettings(next)}
          />
        </>
      ),
    },
    {
      id: "pay",
      label: "Pay & Payroll",
      description: "Rates, pay periods and deductions",
      icon: Wallet,
      content: (
        <>
          <PayRateSettings initialRates={payRates} members={members} />
          <PayPeriodSettings
            initialData={optimisticPayPeriodSettings}
            onUpdateOptimistic={(next) => setOptimisticPayPeriodSettings(next)}
          />
          <PayrollSettings initialData={payroll} />
          <TaxClaimSettings
            enabled={payroll?.enabled ?? false}
            initialClaims={payroll?.claims ?? []}
            members={members}
            province={payroll?.province ?? DEFAULT_PROVINCE}
          />
        </>
      ),
    },
    {
      id: "locations",
      label: "Locations",
      description: "Location capture and work sites",
      icon: MapPin,
      content: (
        <LocationSettings
          hasGeofencing={hasGeofencing}
          initialData={optimisticLocationSettings}
          onUpdateOptimistic={(next) => setOptimisticLocationSettings(next)}
          sites={sites}
        />
      ),
    },
    {
      id: "alerts",
      label: "Alerts & Reports",
      description: "Shift alerts and report emails",
      icon: Bell,
      content: (
        <>
          {alertSettingsResult && (
            <AlertSettings
              hasNotifications={hasNotifications}
              hasScheduling={hasScheduling}
              initialData={
                alertSettingsResult.ok ? alertSettingsResult.value : null
              }
            />
          )}
          <ReportingSettings
            hasReporting={hasReporting}
            initialData={optimisticReportingSettings}
            onUpdateOptimistic={(next) => setOptimisticReportingSettings(next)}
            payPeriodSettings={optimisticPayPeriodSettings}
          />
        </>
      ),
    },
  ];

  return <SettingsSections sections={sections} />;
}

interface SettingsSectionDef {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  content: React.ReactNode;
}

/**
 * Groups the settings cards into sections behind a menu: a sidebar on wide
 * screens, a scrollable pill row on phones. The open section is kept in the
 * URL hash (e.g. /settings#pay) so it survives a reload and can be linked.
 * Every section stays mounted (only hidden), so unsaved edits in one section
 * are not lost when switching to another.
 */
function SettingsSections({ sections }: { sections: SettingsSectionDef[] }) {
  const [activeId, setActiveId] = useState(sections[0].id);

  // Joined into a string so the effect only re-runs if the ids change.
  const sectionIds = sections.map((section) => section.id).join(",");

  useEffect(() => {
    const ids = sectionIds.split(",");
    const fromHash = () => {
      const id = window.location.hash.slice(1);
      if (ids.includes(id)) setActiveId(id);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [sectionIds]);

  const select = (id: string) => {
    setActiveId(id);
    window.history.replaceState(null, "", `#${id}`);
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-8">
      <nav
        aria-label="Settings sections"
        className="-mx-1 flex gap-1 overflow-x-auto px-1 [scrollbar-width:none] md:sticky md:top-6 md:mx-0 md:w-60 md:shrink-0 md:flex-col md:overflow-visible md:px-0 [&::-webkit-scrollbar]:hidden"
      >
        {sections.map((section) => {
          const Icon = section.icon;
          const isActive = section.id === activeId;
          return (
            <button
              aria-controls={`settings-${section.id}`}
              aria-current={isActive ? "true" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2 text-left font-medium text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 dark:focus-visible:ring-zinc-300 md:whitespace-normal md:py-2.5",
                isActive
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 hover:text-zinc-900 md:bg-transparent dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50 md:dark:bg-transparent",
              )}
              key={section.id}
              onClick={() => select(section.id)}
              type="button"
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>
                <span className="block">{section.label}</span>
                <span
                  className={cn(
                    "hidden font-normal text-xs md:block",
                    isActive
                      ? "text-zinc-300 dark:text-zinc-600"
                      : "text-muted-foreground",
                  )}
                >
                  {section.description}
                </span>
              </span>
            </button>
          );
        })}
      </nav>

      <div className="min-w-0 flex-1">
        {sections.map((section) => (
          <section
            aria-label={section.label}
            className="space-y-8"
            hidden={section.id !== activeId}
            id={`settings-${section.id}`}
            key={section.id}
          >
            {section.content}
          </section>
        ))}
      </div>
    </div>
  );
}
