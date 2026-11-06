"use client";

import { use, useOptimistic } from "react";
import ViewHours from "@/components/ViewHours";
import type { PayrollView } from "@/lib/payroll";
import { timeEntriesReducer } from "@/lib/reducers/time-entries";
import type {
  BreakSettingsData,
  OvertimeSettingsData,
  PayPeriodSettingsData,
  PayRateData,
  SerializableResult,
  TimeEntry,
  ViewHoursProps,
} from "@/lib/types";
import { Card } from "./ui";

type Result<T> = Promise<SerializableResult<T, { reason: string }>>;

export type HoursPanelProps = Omit<
  ViewHoursProps,
  | "entries"
  | "setOptimisticEntries"
  | "isAdmin"
  | "breakSettings"
  | "overtimeSettings"
  | "payPeriodSettings"
  | "payRates"
  | "payroll"
> & {
  entriesPromise: Result<TimeEntry[]>;
  isAdminPromise: Promise<boolean>;
  breakSettingsPromise: Result<BreakSettingsData | null>;
  overtimeSettingsPromise: Result<OvertimeSettingsData | null>;
  payPeriodSettingsPromise: Result<PayPeriodSettingsData | null>;
  payRatesPromise: Result<PayRateData[]>;
  payrollPromise: Result<PayrollView>;
};

const valueOr = <T, F>(
  result: SerializableResult<T, { reason: string }>,
  fallback: F,
) => (result.ok ? result.value : fallback);

/**
 * The Hours page's data hole. Unwraps the entries for the range in the URL
 * and keeps them optimistic, so an edit or delete shows at once.
 */
export default function HoursPanel({
  entriesPromise,
  isAdminPromise,
  breakSettingsPromise,
  overtimeSettingsPromise,
  payPeriodSettingsPromise,
  payRatesPromise,
  payrollPromise,
  ...rest
}: HoursPanelProps) {
  const result = use(entriesPromise);
  const isAdmin = use(isAdminPromise);
  const breakSettings = valueOr(use(breakSettingsPromise), null);
  const overtimeSettings = valueOr(use(overtimeSettingsPromise), null);
  const payPeriodSettings = valueOr(use(payPeriodSettingsPromise), null);
  const payRates = valueOr(use(payRatesPromise), []);
  const payroll = valueOr(use(payrollPromise), null);

  const [entries, setOptimisticEntries] = useOptimistic(
    result.ok ? (result.value ?? []) : [],
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
    <ViewHours
      {...rest}
      breakSettings={breakSettings}
      entries={entries}
      isAdmin={isAdmin}
      overtimeSettings={overtimeSettings}
      payPeriodSettings={payPeriodSettings}
      payRates={payRates}
      payroll={payroll}
      setOptimisticEntries={setOptimisticEntries}
    />
  );
}
