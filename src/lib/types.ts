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
  /** Captured only while the org has location capture switched on. */
  clock_in_latitude?: number | null;
  clock_in_longitude?: number | null;
  clock_in_accuracy_m?: number | null;
  /** Site matched at clock-in, snapshotted by name at punch time. */
  clock_in_site_name?: string | null;
  /** Human-readable address resolved at clock-in via reverse geocoding. */
  clock_in_address?: string | null;
  clock_out_latitude?: number | null;
  clock_out_longitude?: number | null;
  clock_out_accuracy_m?: number | null;
  clock_out_site_name?: string | null;
  /** Human-readable address resolved at clock-out via reverse geocoding. */
  clock_out_address?: string | null;
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
  /**
   * Longest each kind of break may run, in minutes. Null/absent means no
   * limit. A break that reaches its limit is ended automatically (the member
   * is put back on the clock) and recorded as ending exactly at the limit.
   */
  max_meal_break_minutes?: number | null;
  max_unpaid_rest_break_minutes?: number | null;
  max_paid_break_minutes?: number | null;
  updated_at?: Date;
};

/** Per-break-type limits in minutes; null = no limit. */
export type BreakLimits = Record<BreakType, number | null>;

/**
 * Overtime thresholds in hours. Null/absent turns that threshold off; with
 * both off, nothing is ever counted as overtime.
 */
export type OvertimeSettingsData = {
  org_id: string;
  daily_threshold_hours: number | null;
  weekly_threshold_hours: number | null;
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
  address?: string | null;
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
  overtimeSettingsPromise?: Promise<
    SerializableResult<OvertimeSettingsData | null, { reason: string }>
  >;
  sitesPromise?: Promise<SerializableResult<SiteData[], { reason: string }>>;
  orgTimeEntriesPromise: Promise<
    SerializableResult<TimeEntry[], { reason: string }>
  >;
  recentEntriesPromise: Promise<
    SerializableResult<TimeEntry[], { reason: string }>
  >;
  schedulePromise: Promise<
    SerializableResult<ScheduledShiftWithStatus[], { reason: string }>
  >;
  timeOffPromise: Promise<
    SerializableResult<TimeOffRequest[], { reason: string }>
  >;
  timeOffAllowancesPromise?: Promise<
    SerializableResult<TimeOffAllowance[], { reason: string }>
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
  overtimeSettings?: OvertimeSettingsData | null;
  membersPromise?: Promise<
    {
      id: string;
      name: string;
    }[]
  >;
  orgTimeEntriesPromise: Promise<
    SerializableResult<TimeEntry[], { reason: string }>
  >;
  /** Approved requests in range are listed beside the worked hours. */
  timeOffPromise?: Promise<
    SerializableResult<TimeOffRequest[], { reason: string }>
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

/** A shift an admin has published for a member. */
export type ScheduledShift = {
  id: number;
  org_id: string;
  user_id: string;
  shift_start: Date;
  shift_end: Date;
  note: string | null;
  created_by: string;
  created_at?: Date;
  updated_at?: Date;
};

/**
 * How a scheduled shift compares with the member's actual clock times.
 * - `scheduled`: not started yet (or still inside the late grace period)
 * - `on_time` / `late`: the member clocked in for it
 * - `not_clocked_in`: started more than the grace period ago, shift still
 *   running, and no clock-in yet
 * - `no_show`: the shift ended without a clock-in
 */
export type ShiftStatus =
  | "scheduled"
  | "on_time"
  | "late"
  | "not_clocked_in"
  | "no_show";

export type ScheduledShiftWithStatus = ScheduledShift & {
  status: ShiftStatus;
  /** Clock-in of the time entry matched to this shift, if any. */
  actual_clock_in: Date | null;
  actual_clock_out: Date | null;
  /** Minutes after the scheduled start the member clocked in (0 if early). */
  minutes_late: number | null;
};

export type TimeOffType = "vacation" | "sick" | "unpaid";
export type TimeOffStatus = "pending" | "approved" | "denied" | "cancelled";

/**
 * A member's request for time off: vacation (PTO) and sick days are paid,
 * unpaid time off is not. Dates are whole calendar days as
 * `YYYY-MM-DD` strings (inclusive on both ends), so they mean the same day in
 * every time zone.
 */
export type TimeOffRequest = {
  id: number;
  org_id: string;
  user_id: string;
  request_type: TimeOffType;
  start_date: string;
  end_date: string;
  hours_per_day: number;
  note: string | null;
  status: TimeOffStatus;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  created_at?: Date;
  updated_at?: Date;
};

/**
 * How many PTO (vacation) days a member gets per calendar year. Members
 * without one have no limit.
 */
export type TimeOffAllowance = {
  org_id: string;
  user_id: string;
  pto_days: number;
  updated_at?: Date;
};
