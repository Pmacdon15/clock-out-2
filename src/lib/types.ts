/**
 * Break kinds recorded against a time entry. `paid_rest` is a paid rest
 * break (recorded, never deducted); the two `unpaid_*` kinds are unpaid and
 * are subtracted from worked hours. `unpaid_meal` is the jurisdictional meal
 * period many labour codes require a record of.
 */
export type BreakType = "unpaid_meal" | "unpaid_rest" | "paid_rest";

export type TimeEntryBreak = {
  id: number;
  time_entry_id: number;
  break_type: BreakType;
  break_start: Date;
  /** Null while the break is still running. */
  break_end: Date | null;
  created_at?: Date;
  updated_at?: Date;
};

export type TimeEntry = {
  id: number;
  user_id: string;
  org_id: string;
  clock_in: Date;
  clock_out: Date | null;
  skip_lunch?: boolean;
  /** Break records for this entry, oldest first (loaded alongside entries). */
  breaks?: TimeEntryBreak[];
  created_at: Date;
  updated_at: Date;
};

export type SerializableResult<T, E> =
  | { value: T; ok: true }
  | { error: E; ok: false };

import type { EntryAction } from "./reducers/time-entries";

export type ReportingSettingsData = {
  org_id: string;
  report_frequency: string;
  report_day: string | null;
  report_interval: number;
  updated_at?: Date;
};

export type BreakSettingsData = {
  org_id: string;
  dock_lunch: boolean;
  lunch_duration_minutes: number;
  lunch_min_shift_hours: number;
  updated_at?: Date;
};

export type OrgSettingsData = {
  org_id: string;
  updated_at?: Date;
  reporting?: ReportingSettingsData;
  breaks?: BreakSettingsData;
};

export interface DashboardTabsProps {
  defaultTabPromise: Promise<string | undefined>;
  entriesPromise: Promise<SerializableResult<TimeEntry[], { reason: string }>>;
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
  orgTimeEntriesPromise: Promise<
    SerializableResult<TimeEntry[], { reason: string }>
  >;
  recentEntriesPromise: Promise<
    SerializableResult<TimeEntry[], { reason: string }>
  >;
  membersPromise?: Promise<
    {
      id: string;
      name: string;
    }[]
  >;
  selectedUserIdPromise?: Promise<string | undefined>;
  selectedWeekPromise?: Promise<string | undefined>;
  selectedMonthPromise?: Promise<string | undefined>;
  selectedYearPromise?: Promise<string | undefined>;
  timeframePromise?: Promise<string | undefined>;
  endDatePromise: Promise<string | undefined>;
  startDatePromise: Promise<string | undefined>;
  isAdminPromise: Promise<boolean>;
  hasReportingPromise: Promise<boolean>;
  userIdPromise: Promise<string | undefined>;
  orgIdPromise: Promise<string | undefined>;
}
export interface ViewHoursProps {
  entries: TimeEntry[];
  setOptimisticEntries: (action: EntryAction) => void;
  isAdmin?: boolean;
  breakSettings?: BreakSettingsData | null;
  membersPromise?: Promise<
    {
      id: string;
      name: string;
    }[]
  >;
  orgTimeEntriesPromise: Promise<
    SerializableResult<TimeEntry[], { reason: string }>
  >;
  selectedUserIdPromise?: Promise<string | undefined>;
  selectedWeekPromise?: Promise<string | undefined>;
  selectedMonthPromise?: Promise<string | undefined>;
  selectedYearPromise?: Promise<string | undefined>;
  timeframePromise?: Promise<string | undefined>;
  startDatePromise?: Promise<string | undefined>;
  endDatePromise?: Promise<string | undefined>;
  currentUserIdPromise?: Promise<string | null | undefined>;
}
