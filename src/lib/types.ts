/**
 * Break kinds recorded against a time entry. The `paid_*` kinds are paid
 * (recorded, never deducted); the `unpaid_*` kinds are unpaid and are
 * subtracted from worked hours. `unpaid_meal` and `paid_meal` are the meal
 * period (lunch) many labour codes require a record of; which one the clock
 * offers depends on the org's `paid_lunch` setting.
 */
export type BreakType =
  | "unpaid_meal"
  | "paid_meal"
  | "unpaid_rest"
  | "paid_rest";

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

import type { PayrollView } from "./payroll";
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
   * Whether lunch (the meal period) is paid. When true the clock offers a
   * paid meal period instead of an unpaid one, and lunch is never docked.
   */
  paid_lunch?: boolean;
  /**
   * Longest each kind of break may run, in minutes. Null/absent means no
   * limit. A break that reaches its limit is ended automatically (the member
   * is put back on the clock) and recorded as ending exactly at the limit.
   * `max_meal_break_minutes` covers both the paid and unpaid meal period.
   */
  max_meal_break_minutes?: number | null;
  max_unpaid_rest_break_minutes?: number | null;
  max_paid_break_minutes?: number | null;
  /**
   * How many paid / unpaid breaks a member may start in one shift. Null or
   * absent means no limit. A meal period counts toward whichever kind
   * lunch is (see `paid_lunch`).
   */
  max_paid_breaks_per_shift?: number | null;
  max_unpaid_breaks_per_shift?: number | null;
  updated_at?: Date;
};

/** Per-break-type limits in minutes; null = no limit. */
export type BreakLimits = Record<BreakType, number | null>;

/** How many paid / unpaid breaks fit in one shift; null = no limit. */
export type BreakCountLimits = { paid: number | null; unpaid: number | null };

/**
 * Overtime thresholds in hours. Null/absent turns that threshold off; with
 * both off, nothing is ever counted as overtime.
 */
export type OvertimeSettingsData = {
  org_id: string;
  daily_threshold_hours: number | null;
  weekly_threshold_hours: number | null;
  /**
   * Bank overtime as time in lieu instead of paying it. Each week the first
   * `bank_after_overtime_hours` overtime hours are paid; every overtime hour
   * past that is banked. Null/0 banks all overtime.
   */
  bank_overtime?: boolean | null;
  bank_after_overtime_hours?: number | null;
  updated_at?: Date;
};

/**
 * When paydays fall and which worked days each one pays for. A payday every
 * week or two weeks from `anchor_payday` (YYYY-MM-DD) pays for the 7 or 14
 * days ending `holdback_days` before it.
 */
export type PayPeriodSettingsData = {
  org_id: string;
  enabled: boolean;
  frequency: "weekly" | "bi-weekly";
  anchor_payday: string;
  holdback_days: number;
  updated_at?: Date;
};

/**
 * A member's pay rate. Gross pay is regular hours × `hourly_rate` plus
 * overtime hours × `hourly_rate` × `overtime_multiplier`.
 */
export type PayRateData = {
  org_id: string;
  user_id: string;
  hourly_rate: number;
  overtime_multiplier: number;
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

export interface ViewHoursProps {
  entries: TimeEntry[];
  setOptimisticEntries: (action: EntryAction) => void;
  isAdmin?: boolean;
  breakSettings?: BreakSettingsData | null;
  overtimeSettings?: OvertimeSettingsData | null;
  /** Adds a Pay Period timeframe to the Hours view when enabled. */
  payPeriodSettings?: PayPeriodSettingsData | null;
  /** Rates the viewer may see; gross pay is estimated for these members. */
  payRates?: PayRateData[];
  /** Deductions are estimated beside gross pay when enabled. */
  payroll?: PayrollView | null;
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

/**
 * Per-organization "forgot to clock out / forgot to end break" alert rules.
 * Every rule is off until an admin turns it on.
 */
export type AlertSettingsData = {
  org_id: string;
  /** Remind members whose shift has been open for `forgot_clock_out_hours`. */
  forgot_clock_out_enabled: boolean;
  forgot_clock_out_hours: number;
  /** Close shifts automatically at clock-in + `auto_clock_out_hours`. */
  auto_clock_out_enabled: boolean;
  auto_clock_out_hours: number;
  /** Remind members still on a break after `break_reminder_minutes`. */
  break_reminder_enabled: boolean;
  break_reminder_minutes: number;
  /** Also send every alert to the org's admins. */
  notify_admins: boolean;
  /** Tell members about their weekly schedule and shifts added/removed. */
  schedule_notifications: boolean;
  updated_at?: Date;
};

/** The editable part of {@link AlertSettingsData}. */
export type AlertSettingsInput = Omit<
  AlertSettingsData,
  "org_id" | "updated_at"
>;

/** How one person wants to be told about alerts (shared across their orgs). */
export type NotificationPreferencesData = {
  user_id: string;
  email_enabled: boolean;
  push_enabled: boolean;
  /** Forgot-to-clock-out reminders and automatic clock-out notices. */
  shift_alerts: boolean;
  /** Still-on-break reminders. */
  break_alerts: boolean;
  /** Admins only: alerts about other members of their org. */
  admin_alerts: boolean;
  /** My weekly schedule, and shifts added to or removed from it. */
  schedule_alerts: boolean;
  /** IANA zone from the person's browser, for wording shift times. */
  timezone?: string | null;
  updated_at?: Date;
};

/** The editable part of {@link NotificationPreferencesData}. */
export type NotificationPreferencesInput = Omit<
  NotificationPreferencesData,
  "user_id" | "updated_at" | "timezone"
>;

/** A browser push subscription, as `PushSubscription.toJSON()` gives it. */
export type PushSubscriptionInput = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export type PushSubscriptionRow = {
  id: number;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent?: string | null;
  created_at?: Date;
};

/** A device registered with Firebase Cloud Messaging. */
export type FcmTokenRow = {
  token: string;
  user_id: string;
  /** The browser push subscription the token wraps, when the client sent it. */
  endpoint?: string | null;
  user_agent?: string | null;
  created_at?: Date;
  last_seen_at?: Date;
};

/** A device's FCM registration, as the browser sends it after `getToken`. */
export type FcmTokenInput = {
  token: string;
  /** Push subscription endpoint the token wraps. */
  endpoint?: string | null;
  /** A legacy Web Push endpoint this registration replaced, to forget. */
  replacedEndpoint?: string | null;
};

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

/**
 * A member's request to hand a scheduled shift to a coworker:
 * - `offer`: the owner posts it; any coworker (or `target_user_id`) claims it.
 * - `pickup`: a member asks to take a coworker's shift; the owner agrees.
 * - `swap`: the owner trades `shift_id` for the coworker's `swap_shift_id`.
 * `claimed_by` is whoever takes `shift_id`. An admin approves (which moves
 * the shift(s) in the schedule) or denies it.
 */
export type ShiftRequestType = "offer" | "pickup" | "swap";
export type ShiftRequestStatus =
  | "open"
  | "pending_approval"
  | "approved"
  | "denied"
  | "cancelled";

export type ShiftRequest = {
  id: number;
  org_id: string;
  request_type: ShiftRequestType;
  shift_id: number;
  swap_shift_id: number | null;
  requested_by: string;
  target_user_id: string | null;
  claimed_by: string | null;
  note: string | null;
  status: ShiftRequestStatus;
  claimed_at: Date | string | null;
  reviewed_by: string | null;
  reviewed_at: Date | string | null;
  review_note: string | null;
  cancelled_by: string | null;
  created_at?: Date | string;
  updated_at?: Date | string;
};

/** A request with the times and owners of the shift(s) it moves. */
export type ShiftRequestDetail = ShiftRequest & {
  shift_start: Date | string;
  shift_end: Date | string;
  shift_owner: string;
  shift_note: string | null;
  swap_shift_start: Date | string | null;
  swap_shift_end: Date | string | null;
  swap_shift_owner: string | null;
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
  /**
   * Where an imported request came from, e.g. "google-calendar:<event id>".
   * Null for requests filed by hand.
   */
  external_ref?: string | null;
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
