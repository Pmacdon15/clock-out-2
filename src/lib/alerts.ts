import type { OpenShift, OpenShiftBreak } from "./alerts-db";
import { breakTypeLabel, getBreakLimitMinutes } from "./break-utils";
import type {
  AlertSettingsData,
  AlertSettingsInput,
  BreakSettingsData,
  FcmTokenInput,
  NotificationPreferencesData,
  NotificationPreferencesInput,
  PushSubscriptionInput,
} from "./types";

/** Bounds an admin may choose for each alert rule. */
export const ALERT_BOUNDS = {
  minHours: 1,
  maxHours: 48,
  minBreakMinutes: 5,
  maxBreakMinutes: 480,
} as const;

/** What a brand-new org gets: every rule off, sensible numbers pre-filled. */
export const DEFAULT_ALERT_SETTINGS: AlertSettingsInput = {
  forgot_clock_out_enabled: false,
  forgot_clock_out_hours: 10,
  auto_clock_out_enabled: false,
  auto_clock_out_hours: 16,
  break_reminder_enabled: false,
  break_reminder_minutes: 45,
  notify_admins: true,
  schedule_notifications: true,
};

/** What a person gets before saving any preference: email and push both on. */
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferencesInput = {
  email_enabled: true,
  push_enabled: true,
  shift_alerts: true,
  break_alerts: true,
  admin_alerts: true,
  schedule_alerts: true,
};

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

/** A stored row (numeric columns may arrive as strings) or defaults. */
export function normalizeAlertSettings(
  data?: Partial<AlertSettingsData> | null,
): AlertSettingsInput {
  const d = DEFAULT_ALERT_SETTINGS;
  const num = (value: unknown, fallback: number) => {
    const n = Number(value);
    return value !== null && value !== undefined && Number.isFinite(n)
      ? n
      : fallback;
  };
  return {
    forgot_clock_out_enabled: Boolean(data?.forgot_clock_out_enabled),
    forgot_clock_out_hours: num(
      data?.forgot_clock_out_hours,
      d.forgot_clock_out_hours,
    ),
    auto_clock_out_enabled: Boolean(data?.auto_clock_out_enabled),
    auto_clock_out_hours: num(
      data?.auto_clock_out_hours,
      d.auto_clock_out_hours,
    ),
    break_reminder_enabled: Boolean(data?.break_reminder_enabled),
    break_reminder_minutes: num(
      data?.break_reminder_minutes,
      d.break_reminder_minutes,
    ),
    notify_admins: data?.notify_admins ?? d.notify_admins,
    schedule_notifications:
      data?.schedule_notifications ?? d.schedule_notifications,
  };
}

/**
 * Why a set of alert rules can't be saved, or null when it can. Bounds are
 * checked for every field (not only enabled ones) so whatever is stored is
 * always usable the moment a rule is switched on.
 */
export function validateAlertSettings(
  input: AlertSettingsInput,
): string | null {
  const hoursOk = (h: unknown) =>
    typeof h === "number" &&
    Number.isFinite(h) &&
    h >= ALERT_BOUNDS.minHours &&
    h <= ALERT_BOUNDS.maxHours;
  const booleans = [
    input.forgot_clock_out_enabled,
    input.auto_clock_out_enabled,
    input.break_reminder_enabled,
    input.notify_admins,
    input.schedule_notifications,
  ];
  if (!booleans.every((b) => typeof b === "boolean")) {
    return "Invalid alert settings";
  }
  if (!hoursOk(input.forgot_clock_out_hours)) {
    return `Reminder hours must be between ${ALERT_BOUNDS.minHours} and ${ALERT_BOUNDS.maxHours}`;
  }
  if (!hoursOk(input.auto_clock_out_hours)) {
    return `Auto clock-out hours must be between ${ALERT_BOUNDS.minHours} and ${ALERT_BOUNDS.maxHours}`;
  }
  const minutes = input.break_reminder_minutes;
  if (
    !Number.isInteger(minutes) ||
    minutes < ALERT_BOUNDS.minBreakMinutes ||
    minutes > ALERT_BOUNDS.maxBreakMinutes
  ) {
    return `Break reminder minutes must be a whole number between ${ALERT_BOUNDS.minBreakMinutes} and ${ALERT_BOUNDS.maxBreakMinutes}`;
  }
  if (
    input.forgot_clock_out_enabled &&
    input.auto_clock_out_enabled &&
    input.auto_clock_out_hours <= input.forgot_clock_out_hours
  ) {
    return "Auto clock-out must come after the forgot-to-clock-out reminder";
  }
  return null;
}

export function normalizeNotificationPreferences(
  data?: Partial<NotificationPreferencesData> | null,
): NotificationPreferencesInput {
  const d = DEFAULT_NOTIFICATION_PREFERENCES;
  return {
    email_enabled: data?.email_enabled ?? d.email_enabled,
    push_enabled: data?.push_enabled ?? d.push_enabled,
    shift_alerts: data?.shift_alerts ?? d.shift_alerts,
    break_alerts: data?.break_alerts ?? d.break_alerts,
    admin_alerts: data?.admin_alerts ?? d.admin_alerts,
    schedule_alerts: data?.schedule_alerts ?? d.schedule_alerts,
  };
}

/** Whether a string is an IANA time zone this runtime knows. */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length === 0 || tz.length > 64) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function isValidNotificationPreferences(
  input: unknown,
): input is NotificationPreferencesInput {
  if (!input || typeof input !== "object") return false;
  const record = input as Record<string, unknown>;
  return (
    Object.keys(
      DEFAULT_NOTIFICATION_PREFERENCES,
    ) as (keyof NotificationPreferencesInput)[]
  ).every((key) => typeof record[key] === "boolean");
}

/** Push endpoints are always https URLs; anything else is refused. */
export function isValidPushSubscription(
  input: unknown,
): input is PushSubscriptionInput {
  if (!input || typeof input !== "object") return false;
  const { endpoint, keys } = input as {
    endpoint?: unknown;
    keys?: { p256dh?: unknown; auth?: unknown } | null;
  };
  if (typeof endpoint !== "string" || endpoint.length > 2048) return false;
  if (!endpoint.startsWith("https://")) return false;
  return (
    typeof keys?.p256dh === "string" &&
    keys.p256dh.length > 0 &&
    keys.p256dh.length <= 512 &&
    typeof keys.auth === "string" &&
    keys.auth.length > 0 &&
    keys.auth.length <= 512
  );
}

const isOptionalHttpsUrl = (value: unknown) =>
  value === undefined ||
  value === null ||
  (typeof value === "string" &&
    value.length <= 2048 &&
    value.startsWith("https://"));

/**
 * FCM registration tokens are opaque, but always URL-safe text of a bounded
 * length; the endpoints beside them are push service URLs.
 */
export function isValidFcmToken(input: unknown): input is FcmTokenInput {
  if (!input || typeof input !== "object") return false;
  const { token, endpoint, replacedEndpoint } = input as Record<
    string,
    unknown
  >;
  return (
    typeof token === "string" &&
    /^[A-Za-z0-9_:-]{20,4096}$/.test(token) &&
    isOptionalHttpsUrl(endpoint) &&
    isOptionalHttpsUrl(replacedEndpoint)
  );
}

/* ---------------------------------------------------------- planning -- */

export type PlannedAlert =
  | {
      kind: "auto_clock_out";
      key: string;
      shift: OpenShift;
      hours: number;
    }
  | {
      kind: "forgot_clock_out";
      key: string;
      shift: OpenShift;
      openMs: number;
    }
  | {
      kind: "break_reminder";
      key: string;
      brk: OpenShiftBreak;
      elapsedMs: number;
      /** The break type's limit, when it is the limit that was reached. */
      limitMinutes: number | null;
    };

/**
 * Decides which alerts one org is due, given its open shifts and breaks.
 * Pure: the cron fetches, this decides, the cron acts.
 *
 * - A shift past the auto clock-out limit is closed (and not also reminded).
 * - A shift past the reminder threshold gets one "forgot to clock out" alert.
 * - A break running longer than the reminder threshold — or its type's limit,
 *   when that comes first — gets one "still on break" alert, unless its shift
 *   is being closed anyway.
 */
export function planShiftAlerts({
  settings,
  breakSettings,
  shifts,
  breaks,
  now,
}: {
  settings: AlertSettingsInput;
  breakSettings?: BreakSettingsData | null;
  shifts: OpenShift[];
  breaks: OpenShiftBreak[];
  now: Date;
}): PlannedAlert[] {
  const planned: PlannedAlert[] = [];
  const closing = new Set<number>();
  const nowMs = now.getTime();

  for (const shift of shifts) {
    const openMs = nowMs - new Date(shift.clock_in).getTime();
    if (
      settings.auto_clock_out_enabled &&
      openMs >= settings.auto_clock_out_hours * HOUR_MS
    ) {
      closing.add(shift.id);
      planned.push({
        kind: "auto_clock_out",
        key: `auto:${shift.id}`,
        shift,
        hours: settings.auto_clock_out_hours,
      });
    } else if (
      settings.forgot_clock_out_enabled &&
      openMs >= settings.forgot_clock_out_hours * HOUR_MS
    ) {
      planned.push({
        kind: "forgot_clock_out",
        key: `forgot:${shift.id}`,
        shift,
        openMs,
      });
    }
  }

  if (settings.break_reminder_enabled) {
    for (const brk of breaks) {
      if (closing.has(brk.time_entry_id)) continue;
      const elapsedMs = nowMs - new Date(brk.break_start).getTime();
      const limit = getBreakLimitMinutes(brk.break_type, breakSettings);
      const reminder = settings.break_reminder_minutes;
      const limitFirst = limit !== null && limit <= reminder;
      const thresholdMinutes = limitFirst ? limit : reminder;
      if (elapsedMs >= thresholdMinutes * MINUTE_MS) {
        planned.push({
          kind: "break_reminder",
          key: `break:${brk.id}`,
          brk,
          elapsedMs,
          limitMinutes: limitFirst ? limit : null,
        });
      }
    }
  }

  return planned;
}

/**
 * When this org's next alert falls due, or null when nothing is pending — the
 * moment to wake the alert check. Mirrors {@link planShiftAlerts}: alerts
 * already sent (`claimed`) don't count, a shift's forgot-to-clock-out reminder
 * only counts while it comes before its automatic clock-out, and breaks on a
 * shift that is past its auto clock-out are left to that. Pure.
 */
export function nextShiftAlertDueAt({
  settings,
  breakSettings,
  shifts,
  breaks,
  claimed,
}: {
  settings: AlertSettingsInput;
  breakSettings?: BreakSettingsData | null;
  shifts: OpenShift[];
  breaks: OpenShiftBreak[];
  claimed: Set<string>;
}): Date | null {
  let next = Number.POSITIVE_INFINITY;
  const consider = (ms: number) => {
    if (ms < next) next = ms;
  };
  const autoAt = new Map<number, number>();

  for (const shift of shifts) {
    const start = new Date(shift.clock_in).getTime();
    const auto = settings.auto_clock_out_enabled
      ? start + settings.auto_clock_out_hours * HOUR_MS
      : Number.POSITIVE_INFINITY;
    if (settings.auto_clock_out_enabled) {
      autoAt.set(shift.id, auto);
      consider(auto);
    }
    const forgot = start + settings.forgot_clock_out_hours * HOUR_MS;
    if (
      settings.forgot_clock_out_enabled &&
      forgot < auto &&
      !claimed.has(`forgot:${shift.id}`)
    ) {
      consider(forgot);
    }
  }

  if (settings.break_reminder_enabled) {
    for (const brk of breaks) {
      if (claimed.has(`break:${brk.id}`)) continue;
      const limit = getBreakLimitMinutes(brk.break_type, breakSettings);
      const reminder = settings.break_reminder_minutes;
      const threshold = limit !== null && limit <= reminder ? limit : reminder;
      const due = new Date(brk.break_start).getTime() + threshold * MINUTE_MS;
      // Its shift closes first: the auto clock-out ends the break anyway.
      const auto = autoAt.get(brk.time_entry_id);
      if (auto !== undefined && auto <= due) continue;
      consider(due);
    }
  }

  return Number.isFinite(next) ? new Date(next) : null;
}

/** The alert keys {@link nextShiftAlertDueAt} needs to know were sent. */
export function pendingAlertKeys(
  shifts: OpenShift[],
  breaks: OpenShiftBreak[],
): string[] {
  return [
    ...shifts.map((s) => `forgot:${s.id}`),
    ...breaks.map((b) => `break:${b.id}`),
  ];
}

/* ----------------------------------------------------------- wording -- */

export type AlertCategory =
  | "shift_alerts"
  | "break_alerts"
  | "admin_alerts"
  | "schedule_alerts";

export type NotificationMessage = {
  title: string;
  body: string;
  /** Path (relative to the app) the notification opens. */
  url: string;
  /** Collapses repeat notifications about the same thing on a device. */
  tag: string;
  /** Extra detail lines, listed in the email (push shows `body` only). */
  lines?: string[];
};

export function formatElapsed(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / MINUTE_MS));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

const formatHours = (hours: number) =>
  `${Number.isInteger(hours) ? hours : hours.toFixed(1)}-hour`;

/** The user the alert is about. */
export function alertUserId(alert: PlannedAlert): string {
  return alert.kind === "break_reminder"
    ? alert.brk.user_id
    : alert.shift.user_id;
}

export function alertCategory(alert: PlannedAlert): AlertCategory {
  return alert.kind === "break_reminder" ? "break_alerts" : "shift_alerts";
}

/**
 * The notification text for one alert. Durations only — never clock times —
 * because the cron doesn't know the reader's time zone.
 */
export function describeAlert(
  alert: PlannedAlert,
  audience: { forAdmin: boolean; memberName: string; orgId: string },
): NotificationMessage {
  const { forAdmin, memberName, orgId } = audience;
  const userId = alertUserId(alert);
  const memberUrl = `/?defaultTab=time-clock&orgId=${encodeURIComponent(orgId)}`;
  const adminUrl = `/?defaultTab=view&orgId=${encodeURIComponent(orgId)}&userId=${encodeURIComponent(userId)}`;
  const url = forAdmin ? adminUrl : memberUrl;
  const tag = forAdmin ? `${alert.key}:admin` : alert.key;

  switch (alert.kind) {
    case "forgot_clock_out": {
      const open = formatElapsed(alert.openMs);
      return forAdmin
        ? {
            title: `${memberName} may have forgotten to clock out`,
            body: `${memberName} has been clocked in for ${open}.`,
            url,
            tag,
          }
        : {
            title: "Still clocked in?",
            body: `You've been clocked in for ${open}. Forgot to clock out? Tap to open Clock Out.`,
            url,
            tag,
          };
    }
    case "auto_clock_out": {
      const limit = formatHours(alert.hours);
      return forAdmin
        ? {
            title: `${memberName} was clocked out automatically`,
            body: `${memberName}'s shift reached the ${limit} limit and was closed. Review it in Hours.`,
            url,
            tag,
          }
        : {
            title: "You were clocked out automatically",
            body: `Your shift reached your organization's ${limit} limit, so it was closed. Ask an admin if the time needs correcting.`,
            url,
            tag,
          };
    }
    case "break_reminder": {
      const label = breakTypeLabel(alert.brk.break_type).toLowerCase();
      const elapsed = formatElapsed(alert.elapsedMs);
      if (alert.limitMinutes !== null) {
        return forAdmin
          ? {
              title: `${memberName}'s break is over`,
              body: `${memberName}'s ${label} reached its ${alert.limitMinutes}-minute limit.`,
              url,
              tag,
            }
          : {
              title: "Your break is over",
              body: `Your ${label} reached its ${alert.limitMinutes}-minute limit, so you're back on the clock.`,
              url,
              tag,
            };
      }
      return forAdmin
        ? {
            title: `${memberName} is still on break`,
            body: `${memberName}'s ${label} has been running for ${elapsed}.`,
            url,
            tag,
          }
        : {
            title: "Still on break?",
            body: `Your ${label} has been running for ${elapsed}. Forgot to clock back in? Tap to end your break.`,
            url,
            tag,
          };
    }
  }
}
