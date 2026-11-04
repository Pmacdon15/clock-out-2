import { Client, Receiver } from "@upstash/qstash";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { after } from "next/server";
import {
  nextShiftAlertDueAt,
  normalizeAlertSettings,
  pendingAlertKeys,
} from "./alerts";
import {
  dbDeleteAlertJob,
  dbGetActiveAlertSettings,
  dbGetAlertJob,
  dbGetAlertSettingsFor,
  dbGetClaimedAlertKeys,
  dbGetNotificationPreferencesFor,
  dbGetOpenShiftBreaks,
  dbGetOpenShifts,
  dbGetScheduledShiftsBetween,
  dbUpsertAlertJob,
} from "./alerts-db";
import { processOrgAlerts } from "./alerts-runner";
import { NOTIFICATIONS_FEATURE, orgHasFeature } from "./billing";
import { getBreakLimits } from "./break-utils";
import { dbGetBreakSettings, dbGetScheduledShiftById } from "./db";
import { appUrl } from "./notify";
import {
  DIGEST_HOUR,
  resolveTimezone,
  runWeeklyScheduleDigests,
  type ScheduleChange,
  SHIFT_REMINDER_MINUTES,
  sendUpcomingShiftReminders,
} from "./schedule-notify";
import type { ScheduledShift } from "./types";

/**
 * Exactly-timed alerts without polling. Whenever something changes when an
 * alert falls due (a clock-in, a break, an edit, a rule), ONE delayed Upstash
 * QStash message is (re)scheduled for that moment. QStash calls
 * `/api/alerts/dispatch` (signed), which re-checks the database, sends what is
 * due and schedules the next one. Nothing runs while nothing is due.
 *
 * Every send is still claimed in `sent_alerts`, so a duplicate, late or
 * stale message is harmless: the dispatch re-checks and sends nothing twice.
 */

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/**
 * Upcoming-shift reminders and weekly schedules are scheduled at most this far
 * ahead (QStash's free plan caps delays at 7 days). The daily sweep schedules
 * the rest as they come into range.
 */
export const SCHEDULE_HORIZON_MS = 6 * DAY_MS;

/**
 * After a dispatch, a check still due "now" is retried no sooner than this,
 * so a clock difference with the database can't make it loop.
 */
export const RETRY_FLOOR_MS = 30_000;

/** What a delayed message asks the dispatch endpoint to do. */
export type AlertJob =
  | { type: "shift-alerts"; orgId: string }
  | { type: "upcoming-shift"; orgId: string; shiftId: number; start: number }
  | { type: "weekly-digest" };

/** The message body: the job plus when it was meant to run. */
export type AlertJobMessage = AlertJob & { runAt: number };

export function isQStashConfigured(): boolean {
  return Boolean(
    process.env.QSTASH_TOKEN &&
      process.env.QSTASH_CURRENT_SIGNING_KEY &&
      process.env.QSTASH_NEXT_SIGNING_KEY,
  );
}

/** Where QStash delivers jobs: the production origin, not a preview's. */
export function dispatchUrl(): string {
  return `${appUrl()}/api/alerts/dispatch`;
}

function qstash() {
  return new Client({
    token: process.env.QSTASH_TOKEN as string,
    ...(process.env.QSTASH_URL ? { baseUrl: process.env.QSTASH_URL } : {}),
  });
}

/** Checks a delivery really came from QStash, for this exact URL and body. */
export async function verifyQStashSignature(
  signature: string | null,
  body: string,
): Promise<boolean> {
  if (!signature || !isQStashConfigured()) return false;
  const receiver = new Receiver({
    currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY as string,
    nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY as string,
  });
  try {
    return await receiver.verify({
      signature,
      body,
      url: dispatchUrl(),
      clockTolerance: 5,
    });
  } catch {
    return false;
  }
}

/** Parses a delivered body, or null when it isn't a job we know. */
export function parseAlertJob(body: string): AlertJobMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const job = value as Record<string, unknown>;
  if (typeof job.runAt !== "number" || !Number.isFinite(job.runAt)) {
    return null;
  }
  const runAt = job.runAt;
  if (job.type === "weekly-digest") return { type: "weekly-digest", runAt };
  if (typeof job.orgId !== "string" || job.orgId.length === 0) return null;
  if (job.type === "shift-alerts") {
    return { type: "shift-alerts", orgId: job.orgId, runAt };
  }
  if (
    job.type === "upcoming-shift" &&
    Number.isInteger(job.shiftId) &&
    typeof job.start === "number"
  ) {
    return {
      type: "upcoming-shift",
      orgId: job.orgId,
      shiftId: job.shiftId as number,
      start: job.start,
      runAt,
    };
  }
  return null;
}

/**
 * Publishes one delayed message. `deduplicationId` (letters, digits, `_.-`)
 * makes QStash drop repeats of a message it has already accepted; only jobs
 * that are never cancelled use it, since a cancelled id can't be reused.
 */
async function publish(job: AlertJob, runAt: number, deduplicationId?: string) {
  const { messageId } = await qstash().publishJSON({
    url: dispatchUrl(),
    body: { ...job, runAt } satisfies AlertJobMessage,
    notBefore: Math.ceil(runAt / 1000),
    retries: 3,
    ...(deduplicationId ? { deduplicationId } : {}),
  });
  return messageId;
}

async function cancelMessage(messageId: string) {
  try {
    await qstash().messages.cancel(messageId);
  } catch (error) {
    // Already delivered or gone. The dispatch re-checks anyway.
    console.warn(`[Jobs] Could not cancel message ${messageId}:`, error);
  }
}

/**
 * Makes `key` run at `runAt` (ms): a no-op when it already does, otherwise
 * the old message is cancelled and a new one published. Returns whether a
 * message was published.
 */
export async function scheduleJob(
  key: string,
  orgId: string,
  runAt: number,
  job: AlertJob,
): Promise<boolean> {
  const runAtMs = Math.ceil(runAt / 1000) * 1000;
  const existing = await dbGetAlertJob(key);
  if (existing && new Date(existing.run_at).getTime() === runAtMs) {
    return false;
  }
  const messageId = await publish(job, runAtMs);
  await dbUpsertAlertJob(key, orgId, messageId, new Date(runAtMs));
  if (existing) await cancelMessage(existing.message_id);
  return true;
}

/** Cancels `key`'s pending message, if it has one. */
export async function cancelJob(key: string): Promise<boolean> {
  const existing = await dbDeleteAlertJob(key);
  if (!existing) return false;
  await cancelMessage(existing.message_id);
  return true;
}

export const shiftAlertsJobKey = (orgId: string) => `shift-alerts:${orgId}`;
export const upcomingShiftJobKey = (shiftId: number) => `upcoming:${shiftId}`;

/* ------------------------------------------------------- shift alerts -- */

/**
 * (Re)schedules the org's single shift-alert job for when its next alert
 * falls due, or cancels it when nothing is pending. `minRunAt` (ms) keeps a
 * just-dispatched job from re-firing immediately.
 */
export async function syncOrgShiftAlerts(
  orgId: string,
  now: Date = new Date(),
  minRunAt = 0,
): Promise<Date | null> {
  if (!isQStashConfigured()) return null;
  const key = shiftAlertsJobKey(orgId);
  const [[row], breakSettings] = await Promise.all([
    dbGetAlertSettingsFor([orgId]),
    dbGetBreakSettings(orgId).catch(() => undefined),
  ]);
  const settings = normalizeAlertSettings(row);
  // A break time limit sends "your break is over" even with every rule off.
  const anyBreakLimit = Object.values(getBreakLimits(breakSettings)).some(
    (limit) => limit !== null,
  );
  const anyRule =
    settings.forgot_clock_out_enabled ||
    settings.auto_clock_out_enabled ||
    settings.break_reminder_enabled ||
    anyBreakLimit;
  if (!anyRule) {
    await cancelJob(key);
    return null;
  }

  const [shifts, breaks] = await Promise.all([
    dbGetOpenShifts(orgId),
    settings.break_reminder_enabled || anyBreakLimit
      ? dbGetOpenShiftBreaks(orgId)
      : Promise.resolve([]),
  ]);
  const claimed = await dbGetClaimedAlertKeys(pendingAlertKeys(shifts, breaks));
  const due = nextShiftAlertDueAt({
    settings,
    breakSettings,
    shifts,
    breaks,
    claimed,
  });
  if (!due) {
    await cancelJob(key);
    return null;
  }
  const runAt = Math.max(due.getTime(), now.getTime(), minRunAt);
  await scheduleJob(key, orgId, runAt, { type: "shift-alerts", orgId });
  return new Date(runAt);
}

/**
 * Schedules the org's alert check after the current request has been
 * answered, so a clock-in or a settings save never waits on QStash. Never
 * throws: a failure is logged and the daily sweep catches up.
 */
export function queueShiftAlertSync(orgId: string | null | undefined) {
  if (!orgId || !isQStashConfigured()) return;
  const run = () =>
    syncOrgShiftAlerts(orgId).catch((error) => {
      console.error(`[Jobs] Failed to schedule alerts for ${orgId}:`, error);
    });
  try {
    after(run);
  } catch {
    // Outside a request (scripts, tests): run it now instead.
    void run();
  }
}

/* -------------------------------------------- upcoming shift reminder -- */

/**
 * Keeps one scheduled shift's "starts in an hour" reminder in step with it:
 * scheduled an hour ahead (or right away when that has passed), moved when
 * the shift moves, cancelled when it is removed or already started. Shifts
 * past the horizon wait for the daily sweep.
 */
export async function syncShiftReminderJob(
  change: ScheduleChange,
  shift: Pick<ScheduledShift, "id" | "org_id" | "shift_start">,
  now: Date = new Date(),
): Promise<boolean> {
  if (!isQStashConfigured()) return false;
  const key = upcomingShiftJobKey(shift.id);
  const start = new Date(shift.shift_start).getTime();
  const nowMs = now.getTime();
  const remindAt = start - SHIFT_REMINDER_MINUTES * MINUTE_MS;
  if (
    change === "removed" ||
    start <= nowMs ||
    remindAt > nowMs + SCHEDULE_HORIZON_MS
  ) {
    await cancelJob(key);
    return false;
  }
  return await scheduleJob(key, shift.org_id, Math.max(remindAt, nowMs), {
    type: "upcoming-shift",
    orgId: shift.org_id,
    shiftId: shift.id,
    start,
  });
}

/* ------------------------------------------------------ weekly digest -- */

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);

/** The next Sunday {@link DIGEST_HOUR}:00 in `tz`, strictly after `now`. */
export function nextDigestInstant(tz: string, now: Date): Date {
  const today = formatInTimeZone(now, tz, "yyyy-MM-dd");
  const weekday = Number(formatInTimeZone(now, tz, "i")); // Mon=1 … Sun=7
  const hour = `${String(DIGEST_HOUR).padStart(2, "0")}:00:00`;
  let sunday = addDays(today, 7 - weekday);
  let instant = fromZonedTime(`${sunday}T${hour}`, tz);
  if (instant.getTime() <= now.getTime()) {
    sunday = addDays(sunday, 7);
    instant = fromZonedTime(`${sunday}T${hour}`, tz);
  }
  return instant;
}

/**
 * Schedules a weekly-schedule run at Sunday 5 PM in each time zone that has
 * members with upcoming shifts. QStash's deduplication makes repeating this
 * daily harmless. Returns how many distinct moments were scheduled.
 */
export async function scheduleWeeklyDigestJobs(
  now: Date = new Date(),
): Promise<number> {
  if (!isQStashConfigured()) return 0;
  const shifts = await dbGetScheduledShiftsBetween(
    now,
    new Date(now.getTime() + 9 * DAY_MS),
  );
  if (shifts.length === 0) return 0;
  const userIds = [...new Set(shifts.map((s) => s.user_id))];
  const prefs = await dbGetNotificationPreferencesFor(userIds);
  const zoneByUser = new Map(prefs.map((p) => [p.user_id, p.timezone]));
  const zones = new Set(
    userIds.map((id) => resolveTimezone(zoneByUser.get(id)).tz),
  );
  const instants = new Set(
    [...zones].map((tz) => nextDigestInstant(tz, now).getTime()),
  );
  for (const runAt of instants) {
    await publish({ type: "weekly-digest" }, runAt, `weekly-digest-${runAt}`);
  }
  return instants.size;
}

/* ------------------------------------------------------------ running -- */

export type AlertJobResult = { type: AlertJob["type"]; sent: number };

/**
 * Runs one delivered job. `now` is never earlier than the time the job was
 * meant for, so a message that arrives a moment early still finds its alert
 * due.
 */
export async function runAlertJob(
  job: AlertJobMessage,
  received: Date = new Date(),
): Promise<AlertJobResult> {
  const now = new Date(Math.max(received.getTime(), job.runAt));

  if (job.type === "weekly-digest") {
    const result = await runWeeklyScheduleDigests(now);
    return { type: job.type, sent: result.digests };
  }

  if (job.type === "upcoming-shift") {
    const shift = await dbGetScheduledShiftById(job.shiftId, job.orgId);
    // Moved or removed since: its own job (if any) takes over.
    if (!shift || new Date(shift.shift_start).getTime() !== job.start) {
      return { type: job.type, sent: 0 };
    }
    if (job.start <= now.getTime()) return { type: job.type, sent: 0 };
    const result = await sendUpcomingShiftReminders([shift], now);
    await dbDeleteAlertJob(upcomingShiftJobKey(job.shiftId));
    return { type: job.type, sent: result.reminders };
  }

  // This message has been delivered: forget it, so scheduling the next one
  // doesn't try to cancel it.
  const key = shiftAlertsJobKey(job.orgId);
  const current = await dbGetAlertJob(key);
  if (current && new Date(current.run_at).getTime() === job.runAt) {
    await dbDeleteAlertJob(key);
  }
  const [row] = await dbGetAlertSettingsFor([job.orgId]);
  let sent = 0;
  // Without the paid `notifications` feature shifts still auto clock out,
  // but nobody is emailed or pushed (same as the daily sweep). An org with
  // no rules saved can still be due a "your break is over" from its limits.
  const notify = await orgHasFeature(job.orgId, NOTIFICATIONS_FEATURE);
  const result = await processOrgAlerts(
    row ?? { org_id: job.orgId },
    now,
    notify,
  );
  if (result.status === "ok") sent = result.alerts;
  await syncOrgShiftAlerts(job.orgId, now, now.getTime() + RETRY_FLOOR_MS);
  return { type: job.type, sent };
}

/* -------------------------------------------------------- daily sweep -- */

export type SweepResult = {
  orgs: number;
  reminders: number;
  digests: number;
};

/**
 * The once-a-day safety net (Vercel Cron): makes sure every org with open
 * shifts has its next alert scheduled, every shift starting in the next six
 * days has its reminder, and every zone has its weekly schedule. This is what
 * picks up anything a failed publish missed, and shifts scheduled far ahead.
 */
export async function scheduleAllAlertJobs(
  now: Date = new Date(),
): Promise<SweepResult> {
  const result: SweepResult = { orgs: 0, reminders: 0, digests: 0 };
  if (!isQStashConfigured()) return result;

  for (const row of await dbGetActiveAlertSettings()) {
    try {
      if (await syncOrgShiftAlerts(row.org_id, now)) result.orgs += 1;
    } catch (error) {
      console.error(`[Jobs] Sweep failed for org ${row.org_id}:`, error);
    }
  }

  const shifts = await dbGetScheduledShiftsBetween(
    now,
    new Date(now.getTime() + SCHEDULE_HORIZON_MS),
  );
  for (const shift of shifts) {
    try {
      await syncShiftReminderJob("changed", shift, now);
      result.reminders += 1;
    } catch (error) {
      console.error(`[Jobs] Sweep failed for shift ${shift.id}:`, error);
    }
  }

  result.digests = await scheduleWeeklyDigestJobs(now);
  return result;
}
