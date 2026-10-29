"use client";

import { use, useOptimistic } from "react";
import type {
  BreakSettingsData,
  OrgSettingsData,
  ReportingSettingsData,
  SerializableResult,
} from "@/lib/types";
import BreakSettings from "./BreakSettings";
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
  hasReporting: boolean;
}

export default function OrgSettings({
  hasReporting,
  orgSettingsPromise,
  breakSettingsPromise,
}: OrgSettingsProps) {
  const settingsResult = use(orgSettingsPromise);
  const breakSettingsResult = breakSettingsPromise
    ? use(breakSettingsPromise)
    : null;
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

  return (
    <div className="space-y-8">
      <BreakSettings
        initialData={optimisticBreakSettings}
        onUpdateOptimistic={(next) => setOptimisticBreakSettings(next)}
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
