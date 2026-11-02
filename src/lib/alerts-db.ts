import { cacheLife, cacheTag } from "next/cache";
import {
  ensureScheduledShiftsTable,
  ensureTimeEntryBreaksTable,
  sql,
} from "./db";
import type {
  AlertSettingsData,
  AlertSettingsInput,
  BreakLimits,
  BreakType,
  NotificationPreferencesData,
  NotificationPreferencesInput,
  PushSubscriptionInput,
  PushSubscriptionRow,
  ScheduledShift,
} from "./types";

let alertTablesReady: Promise<void> | null = null;

/**
 * Alert rules, notification preferences, push subscriptions and the sent-alert
 * log. Production databases that predate them in schema.sql don't have the
 * tables, so create them on first use, the same way `ensureBreakSettingsTable`
 * does. Runs once per server instance; a failure is not cached, so the next
 * call retries.
 */
export function ensureAlertTables(): Promise<void> {
  alertTablesReady ??= (async () => {
    await sql`
		CREATE TABLE IF NOT EXISTS settings (
			org_id TEXT PRIMARY KEY,
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)
	`;
    await sql`
		CREATE TABLE IF NOT EXISTS alert_settings (
			org_id TEXT PRIMARY KEY REFERENCES settings(org_id) ON DELETE CASCADE,
			forgot_clock_out_enabled BOOLEAN NOT NULL DEFAULT FALSE,
			forgot_clock_out_hours DOUBLE PRECISION NOT NULL DEFAULT 10,
			auto_clock_out_enabled BOOLEAN NOT NULL DEFAULT FALSE,
			auto_clock_out_hours DOUBLE PRECISION NOT NULL DEFAULT 16,
			break_reminder_enabled BOOLEAN NOT NULL DEFAULT FALSE,
			break_reminder_minutes INTEGER NOT NULL DEFAULT 45,
			notify_admins BOOLEAN NOT NULL DEFAULT TRUE,
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)
	`;
    await sql`
		CREATE TABLE IF NOT EXISTS notification_preferences (
			user_id TEXT PRIMARY KEY,
			email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
			push_enabled BOOLEAN NOT NULL DEFAULT TRUE,
			shift_alerts BOOLEAN NOT NULL DEFAULT TRUE,
			break_alerts BOOLEAN NOT NULL DEFAULT TRUE,
			admin_alerts BOOLEAN NOT NULL DEFAULT TRUE,
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)
	`;
    await sql`
		CREATE TABLE IF NOT EXISTS push_subscriptions (
			id SERIAL PRIMARY KEY,
			user_id TEXT NOT NULL,
			endpoint TEXT NOT NULL UNIQUE,
			p256dh TEXT NOT NULL,
			auth TEXT NOT NULL,
			user_agent TEXT,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)
	`;
    await sql`
		CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
			ON push_subscriptions (user_id)
	`;
    await sql`
		CREATE TABLE IF NOT EXISTS sent_alerts (
			alert_key TEXT PRIMARY KEY,
			org_id TEXT NOT NULL,
			sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)
	`;
    await sql`
		ALTER TABLE alert_settings
			ADD COLUMN IF NOT EXISTS schedule_notifications BOOLEAN NOT NULL DEFAULT TRUE
	`;
    await sql`
		ALTER TABLE notification_preferences
			ADD COLUMN IF NOT EXISTS schedule_alerts BOOLEAN NOT NULL DEFAULT TRUE,
			ADD COLUMN IF NOT EXISTS timezone TEXT
	`;
  })().catch((error) => {
    alertTablesReady = null;
    throw error;
  });
  return alertTablesReady;
}

/** Test-only: forget that the table check ran. */
export function resetAlertTablesCheck() {
  alertTablesReady = null;
}

/* ------------------------------------------------------ alert settings -- */

export async function dbGetAlertSettings(orgId: string) {
  "use cache";
  cacheTag(`alert-settings-${orgId}`);
  cacheLife("hours");
  await ensureAlertTables();
  const [settings] = await sql`
		SELECT * FROM alert_settings WHERE org_id = ${orgId}
	`;
  return settings as AlertSettingsData | undefined;
}

export async function dbUpdateAlertSettings(
  orgId: string,
  input: AlertSettingsInput,
) {
  await ensureAlertTables();
  await sql`
		INSERT INTO settings (org_id, updated_at)
		VALUES (${orgId}, NOW())
		ON CONFLICT (org_id) DO UPDATE SET updated_at = NOW()
	`;
  const [updated] = await sql`
		INSERT INTO alert_settings (
			org_id,
			forgot_clock_out_enabled, forgot_clock_out_hours,
			auto_clock_out_enabled, auto_clock_out_hours,
			break_reminder_enabled, break_reminder_minutes,
			notify_admins, schedule_notifications, updated_at
		)
		VALUES (
			${orgId},
			${input.forgot_clock_out_enabled}, ${input.forgot_clock_out_hours},
			${input.auto_clock_out_enabled}, ${input.auto_clock_out_hours},
			${input.break_reminder_enabled}, ${input.break_reminder_minutes},
			${input.notify_admins}, ${input.schedule_notifications}, NOW()
		)
		ON CONFLICT (org_id)
		DO UPDATE SET
			forgot_clock_out_enabled = ${input.forgot_clock_out_enabled},
			forgot_clock_out_hours = ${input.forgot_clock_out_hours},
			auto_clock_out_enabled = ${input.auto_clock_out_enabled},
			auto_clock_out_hours = ${input.auto_clock_out_hours},
			break_reminder_enabled = ${input.break_reminder_enabled},
			break_reminder_minutes = ${input.break_reminder_minutes},
			notify_admins = ${input.notify_admins},
			schedule_notifications = ${input.schedule_notifications},
			updated_at = NOW()
		RETURNING *
	`;
  return updated as AlertSettingsData;
}

/**
 * Every org with at least one alert rule switched on. Uncached: the cron must
 * see a rule the moment an admin saves it.
 */
export async function dbGetActiveAlertSettings() {
  await ensureAlertTables();
  const rows = await sql`
		SELECT * FROM alert_settings
		WHERE forgot_clock_out_enabled
		OR auto_clock_out_enabled
		OR break_reminder_enabled
	`;
  return rows as unknown as AlertSettingsData[];
}

/* ------------------------------------------- notification preferences -- */

export async function dbGetNotificationPreferences(userId: string) {
  "use cache";
  cacheTag(`notification-prefs-${userId}`);
  cacheLife("hours");
  await ensureAlertTables();
  const [prefs] = await sql`
		SELECT * FROM notification_preferences WHERE user_id = ${userId}
	`;
  return prefs as NotificationPreferencesData | undefined;
}

/** Uncached preferences for many people at once, for the alert sender. */
export async function dbGetNotificationPreferencesFor(userIds: string[]) {
  if (userIds.length === 0) return [] as NotificationPreferencesData[];
  await ensureAlertTables();
  const rows = await sql`
		SELECT * FROM notification_preferences WHERE user_id = ANY(${userIds})
	`;
  return rows as unknown as NotificationPreferencesData[];
}

export async function dbUpdateNotificationPreferences(
  userId: string,
  input: NotificationPreferencesInput,
) {
  await ensureAlertTables();
  const [updated] = await sql`
		INSERT INTO notification_preferences (
			user_id, email_enabled, push_enabled,
			shift_alerts, break_alerts, admin_alerts, schedule_alerts, updated_at
		)
		VALUES (
			${userId}, ${input.email_enabled}, ${input.push_enabled},
			${input.shift_alerts}, ${input.break_alerts}, ${input.admin_alerts},
			${input.schedule_alerts}, NOW()
		)
		ON CONFLICT (user_id)
		DO UPDATE SET
			email_enabled = ${input.email_enabled},
			push_enabled = ${input.push_enabled},
			shift_alerts = ${input.shift_alerts},
			break_alerts = ${input.break_alerts},
			admin_alerts = ${input.admin_alerts},
			schedule_alerts = ${input.schedule_alerts},
			updated_at = NOW()
		RETURNING *
	`;
  return updated as NotificationPreferencesData;
}

/**
 * Remembers the person's browser time zone, creating their preferences row
 * (with defaults) if they have none, so shift times can be worded locally.
 */
export async function dbSetUserTimezone(userId: string, timezone: string) {
  await ensureAlertTables();
  await sql`
		INSERT INTO notification_preferences (user_id, timezone, updated_at)
		VALUES (${userId}, ${timezone}, NOW())
		ON CONFLICT (user_id)
		DO UPDATE SET timezone = ${timezone}, updated_at = NOW()
	`;
}

/* -------------------------------------------------- push subscriptions -- */

/**
 * Saves a device's subscription. The endpoint is unique per browser install,
 * so re-subscribing (or a different person signing in on the same device)
 * moves the endpoint to the current user rather than duplicating it.
 */
export async function dbSavePushSubscription(
  userId: string,
  subscription: PushSubscriptionInput,
  userAgent: string | null,
) {
  await ensureAlertTables();
  const [saved] = await sql`
		INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
		VALUES (
			${userId}, ${subscription.endpoint},
			${subscription.keys.p256dh}, ${subscription.keys.auth}, ${userAgent}
		)
		ON CONFLICT (endpoint)
		DO UPDATE SET
			user_id = ${userId},
			p256dh = ${subscription.keys.p256dh},
			auth = ${subscription.keys.auth},
			user_agent = ${userAgent}
		RETURNING *
	`;
  return saved as unknown as PushSubscriptionRow;
}

/** Removes one of the user's own devices. */
export async function dbDeletePushSubscription(
  userId: string,
  endpoint: string,
) {
  await ensureAlertTables();
  const [deleted] = await sql`
		DELETE FROM push_subscriptions
		WHERE user_id = ${userId} AND endpoint = ${endpoint}
		RETURNING *
	`;
  return deleted as unknown as PushSubscriptionRow | undefined;
}

/** Drops a subscription the push service says is gone (404/410). */
export async function dbDeleteExpiredPushSubscription(endpoint: string) {
  await ensureAlertTables();
  await sql`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint}`;
}

export async function dbGetPushSubscriptionsFor(userIds: string[]) {
  if (userIds.length === 0) return [] as PushSubscriptionRow[];
  await ensureAlertTables();
  const rows = await sql`
		SELECT * FROM push_subscriptions WHERE user_id = ANY(${userIds})
	`;
  return rows as unknown as PushSubscriptionRow[];
}

/* ---------------------------------------------------------- cron reads -- */

/** An open shift, as the alert cron sees it. */
export type OpenShift = {
  id: number;
  user_id: string;
  org_id: string;
  clock_in: Date;
};

/** A running break on an open shift, as the alert cron sees it. */
export type OpenShiftBreak = {
  id: number;
  time_entry_id: number;
  break_type: BreakType;
  break_start: Date;
  user_id: string;
  org_id: string;
};

export async function dbGetOpenShifts(orgId: string) {
  const rows = await sql`
		SELECT id, user_id, org_id, clock_in FROM time_entries
		WHERE org_id = ${orgId} AND clock_out IS NULL
	`;
  return rows as unknown as OpenShift[];
}

export async function dbGetOpenShiftBreaks(orgId: string) {
  await ensureTimeEntryBreaksTable();
  const rows = await sql`
		SELECT b.id, b.time_entry_id, b.break_type, b.break_start, e.user_id, e.org_id
		FROM time_entry_breaks b
		JOIN time_entries e ON e.id = b.time_entry_id
		WHERE e.org_id = ${orgId} AND e.clock_out IS NULL AND b.break_end IS NULL
	`;
  return rows as unknown as OpenShiftBreak[];
}

/**
 * Records that an alert went out. Returns true only for the first claim of a
 * key, so overlapping or repeated cron runs never send the same alert twice.
 */
export async function dbClaimAlert(alertKey: string, orgId: string) {
  await ensureAlertTables();
  const rows = await sql`
		INSERT INTO sent_alerts (alert_key, org_id)
		VALUES (${alertKey}, ${orgId})
		ON CONFLICT (alert_key) DO NOTHING
		RETURNING alert_key
	`;
  return rows.length > 0;
}

/**
 * Closes a shift that ran past the org's limit, at exactly
 * `clock_in + maxHours` (not at the time the cron got to it), in one atomic
 * statement:
 *
 * - breaks that started at or after the new clock-out are outside the shift
 *   and are removed;
 * - breaks still running, or ending after the new clock-out, are ended at the
 *   earliest of now, the new clock-out and (for a running break) its type's
 *   limit — the same cap `dbEndOpenBreak` applies.
 *
 * Returns undefined when the shift was already closed (the member clocked out
 * in the meantime) or hasn't reached the limit yet.
 */
export async function dbAutoClockOut(
  entryId: number,
  maxHours: number,
  limits?: BreakLimits | null,
) {
  await ensureTimeEntryBreaksTable();
  const meal = limits?.unpaid_meal ?? null;
  const unpaidRest = limits?.unpaid_rest ?? null;
  const paidRest = limits?.paid_rest ?? null;
  const [closed] = await sql`
		WITH closed AS (
			UPDATE time_entries
			SET clock_out = clock_in + make_interval(secs => ${maxHours}::DOUBLE PRECISION * 3600),
				updated_at = NOW()
			WHERE id = ${entryId}
			AND clock_out IS NULL
			AND clock_in + make_interval(secs => ${maxHours}::DOUBLE PRECISION * 3600) <= NOW()
			RETURNING *
		),
		dropped AS (
			DELETE FROM time_entry_breaks b
			USING closed c
			WHERE b.time_entry_id = c.id AND b.break_start >= c.clock_out
			RETURNING b.id
		),
		capped AS (
			UPDATE time_entry_breaks b
			SET break_end = LEAST(
					COALESCE(b.break_end, NOW()),
					c.clock_out,
					CASE WHEN b.break_end IS NULL THEN
						b.break_start + make_interval(mins => (CASE b.break_type
							WHEN 'unpaid_meal' THEN ${meal}::INTEGER
							WHEN 'unpaid_rest' THEN ${unpaidRest}::INTEGER
							WHEN 'paid_rest' THEN ${paidRest}::INTEGER
						END))
					END
				),
				updated_at = NOW()
			FROM closed c
			WHERE b.time_entry_id = c.id
			AND b.break_start < c.clock_out
			AND (b.break_end IS NULL OR b.break_end > c.clock_out)
			RETURNING b.id
		)
		SELECT * FROM closed
	`;
  return closed as unknown as OpenShift | undefined;
}

/* --------------------------------------------------- schedule digests -- */

/** Uncached settings for many orgs at once (missing orgs have no row). */
export async function dbGetAlertSettingsFor(orgIds: string[]) {
  if (orgIds.length === 0) return [] as AlertSettingsData[];
  await ensureAlertTables();
  const rows = await sql`
		SELECT * FROM alert_settings WHERE org_id = ANY(${orgIds})
	`;
  return rows as unknown as AlertSettingsData[];
}

/** Every org's shifts starting in [start, end), uncached, for the digest. */
export async function dbGetScheduledShiftsBetween(start: Date, end: Date) {
  await ensureScheduledShiftsTable();
  const rows = await sql`
		SELECT * FROM scheduled_shifts
		WHERE shift_start >= ${start} AND shift_start < ${end}
		ORDER BY shift_start ASC, id ASC
	`;
  return rows as unknown as ScheduledShift[];
}
