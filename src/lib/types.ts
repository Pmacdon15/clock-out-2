export type TimeEntry = {
  id: number;
  user_id: string;
  org_id: string;
  clock_in: Date;
  clock_out: Date | null;
  skip_lunch?: boolean;
  created_at: Date;
  updated_at: Date;
  /** Captured only while the org has location capture switched on. */
  clock_in_latitude?: number | null;
  clock_in_longitude?: number | null;
  clock_in_accuracy_m?: number | null;
  /** Site matched at clock-in, snapshotted by name at punch time. */
  clock_in_site_name?: string | null;
  clock_out_latitude?: number | null;
  clock_out_longitude?: number | null;
  clock_out_accuracy_m?: number | null;
  clock_out_site_name?: string | null;
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

export type LocationSettingsData = {
  org_id: string;
  /** 'off' | 'optional' | 'required' */
  capture_mode: string;
  restrict_clock_in: boolean;
  updated_at?: Date;
};

export type SiteData = {
  id: number;
  org_id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
  created_at?: Date;
  updated_at?: Date;
};

export type OrgSettingsData = {
  org_id: string;
  updated_at?: Date;
  reporting?: ReportingSettingsData;
  breaks?: BreakSettingsData;
  location?: LocationSettingsData;
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
  locationSettingsPromise?: Promise<
    SerializableResult<
      LocationSettingsData | null,
      {
        reason: string;
      }
    >
  >;
  sitesPromise?: Promise<SerializableResult<SiteData[], { reason: string }>>;
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
  hasGeofencingPromise?: Promise<boolean>;
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
