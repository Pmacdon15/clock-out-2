import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import {
  isValidTimeZone,
  type NotificationMessage,
  normalizeAlertSettings,
} from "./alerts";
import {
  dbClaimAlert,
  dbGetAlertSettingsFor,
  dbGetNotificationPreferencesFor,
  dbGetScheduledShiftsBetween,
} from "./alerts-db";
import { loadOrgMembers, type OrgMember } from "./alerts-runner";
import { deliver } from "./notify";
import type { ScheduledShift } from "./types";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** The weekly schedule goes out on Sunday from this local hour (5 PM). */
export const DIGEST_HOUR = 17;
/** Zone used when we don't know the person's (shown in the text). */
export const FALLBACK_TIMEZONE = "UTC";

const SCHEDULE_URL = "/?defaultTab=schedule";

/** A person's zone, or the fallback when it's unknown or invalid. */
export function resolveTimezone(
  ...candidates: (string | null | undefined)[]
): { tz: string; known: boolean } {
  const tz = candidates.find(isValidTimeZone);
  return tz ? { tz, known: true } : { tz: FALLBACK_TIMEZONE, known: false };
}

/**
 * "Mon, Nov 3, 9:00 AM – 5:00 PM", with the end date when the shift crosses
 * midnight, and the zone name when we had to guess it.
 */
export function formatShiftRange(
  start: Date,
  end: Date,
  zone: { tz: string; known: boolean },
): string {
  const { tz, known } = zone;
  const sameDay =
    formatInTimeZone(start, tz, "yyyy-MM-dd") ===
    formatInTimeZone(end, tz, "yyyy-MM-dd");
  const from = formatInTimeZone(start, tz, "EEE, MMM d, h:mm a");
  const to = formatInTimeZone(end, tz, sameDay ? "h:mm a" : "EEE, MMM d, h:mm a");
  return `${from} – ${to}${known ? "" : ` ${tz}`}`;
}

export type ScheduleChange = "added" | "removed";

export function describeShiftChange(
  change: ScheduleChange,
  shift: Pick<ScheduledShift, "id" | "shift_start" | "shift_end" | "note">,
  zone: { tz: string; known: boolean },
): NotificationMessage {
  const start = new Date(shift.shift_start);
  const end = new Date(shift.shift_end);
  const day = formatInTimeZone(start, zone.tz, "EEE, MMM d");
  const range = formatShiftRange(start, end, zone);
  const note = shift.note ? ` Note: ${shift.note}` : "";
  return change === "added"
    ? {
        title: `New shift: ${day}`,
        body: `You're scheduled ${range}.${note}`,
        url: SCHEDULE_URL,
        tag: `shift-added:${shift.id}`,
      }
    : {
        title: `Shift cancelled: ${day}`,
        body: `Your shift ${range} was removed from the schedule.`,
        url: SCHEDULE_URL,
        tag: `shift-removed:${shift.id}`,
      };
}

/**
 * Tells a member that an admin added or removed one of their upcoming
 * shifts. Runs after the admin's request has been answered (`after()`), so
 * it never slows the schedule down and never throws.
 *
 * Skipped for shifts that already ended (tidying up history), for an admin
 * scheduling themselves, and for orgs that switched schedule notices off.
 */
export async function notifyScheduleChange(
  change: ScheduleChange,
  shift: ScheduledShift,
  actorTimezone?: string | null,
  now: Date = new Date(),
): Promise<boolean> {
  try {
    if (new Date(shift.shift_end).getTime() <= now.getTime()) return false;
    if (shift.created_by === shift.user_id) return false;

    const [settingsRows, prefRows, members] = await Promise.all([
      dbGetAlertSettingsFor([shift.org_id]),
      dbGetNotificationPreferencesFor([shift.user_id]),
      loadOrgMembers(shift.org_id),
    ]);
    if (!normalizeAlertSettings(settingsRows[0]).schedule_notifications) {
      return false;
    }
    const member = members.find((m) => m.userId === shift.user_id);
    if (!member) return false;

    const zone = resolveTimezone(prefRows[0]?.timezone, actorTimezone);
    await deliver([
      {
        recipient: { userId: member.userId, email: member.email },
        category: "schedule_alerts",
        message: describeShiftChange(change, shift, zone),
      },
    ]);
    return true;
  } catch (error) {
    console.error("[Schedule] Failed to send shift change notice:", error);
    return false;
  }
}

/* ------------------------------------------------------ weekly digest -- */

export type WeeklyDigest = {
  orgId: string;
  userId: string;
  zone: { tz: string; known: boolean };
  /** Local date (yyyy-MM-dd) of the Monday the digest covers. */
  weekOf: string;
  shifts: ScheduledShift[];
};

const addDaysToDateString = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);

/**
 * Which members are due their weekly schedule: it's Sunday from
 * {@link DIGEST_HOUR} in their own zone, and they have at least one shift
 * starting in the coming Monday–Sunday (local). Pure.
 */
export function planWeeklyDigests(
  shifts: ScheduledShift[],
  timezones: Map<string, string | null | undefined>,
  now: Date,
): WeeklyDigest[] {
  const byMember = new Map<string, ScheduledShift[]>();
  for (const shift of shifts) {
    const key = `${shift.org_id}\u0000${shift.user_id}`;
    const list = byMember.get(key);
    if (list) list.push(shift);
    else byMember.set(key, [shift]);
  }

  const digests: WeeklyDigest[] = [];
  for (const memberShifts of byMember.values()) {
    const { org_id: orgId, user_id: userId } = memberShifts[0];
    const zone = resolveTimezone(timezones.get(userId));
    const isSunday = formatInTimeZone(now, zone.tz, "i") === "7";
    const hour = Number(formatInTimeZone(now, zone.tz, "H"));
    if (!isSunday || hour < DIGEST_HOUR) continue;

    const today = formatInTimeZone(now, zone.tz, "yyyy-MM-dd");
    const weekOf = addDaysToDateString(today, 1);
    const weekStart = fromZonedTime(`${weekOf}T00:00:00`, zone.tz).getTime();
    const weekEnd = fromZonedTime(
      `${addDaysToDateString(weekOf, 7)}T00:00:00`,
      zone.tz,
    ).getTime();
    const week = memberShifts.filter((s) => {
      const t = new Date(s.shift_start).getTime();
      return t >= weekStart && t < weekEnd;
    });
    if (week.length > 0) {
      digests.push({ orgId, userId, zone, weekOf, shifts: week });
    }
  }
  return digests;
}

export function formatHours(ms: number): string {
  const hours = Math.round((ms / HOUR_MS) * 10) / 10;
  return `${hours}h`;
}

export function describeWeeklyDigest(digest: WeeklyDigest): NotificationMessage {
  const { zone, weekOf, shifts } = digest;
  const monday = fromZonedTime(`${weekOf}T12:00:00`, zone.tz);
  const sunday = new Date(monday.getTime() + 6 * DAY_MS);
  const label = `${formatInTimeZone(monday, zone.tz, "MMM d")} – ${formatInTimeZone(sunday, zone.tz, "MMM d")}`;
  const totalMs = shifts.reduce(
    (sum, s) =>
      sum + (new Date(s.shift_end).getTime() - new Date(s.shift_start).getTime()),
    0,
  );
  const count = `${shifts.length} shift${shifts.length === 1 ? "" : "s"}`;
  const lines = shifts.map((s) => {
    const range = formatShiftRange(
      new Date(s.shift_start),
      new Date(s.shift_end),
      zone,
    );
    return s.note ? `${range} (${s.note})` : range;
  });
  return {
    title: `Your schedule for ${label}`,
    body: `${count}, ${formatHours(totalMs)} scheduled next week. First up: ${lines[0]}.`,
    url: SCHEDULE_URL,
    tag: `week:${weekOf}`,
    lines,
  };
}

export type DigestRunResult = { digests: number; emails: number; pushes: number };

/**
 * Sends every weekly schedule that's due. Safe to run every few minutes: a
 * member gets one digest per week (`sent_alerts`), and a failing org never
 * stops the others.
 */
export async function runWeeklyScheduleDigests(
  now: Date = new Date(),
): Promise<DigestRunResult> {
  const result: DigestRunResult = { digests: 0, emails: 0, pushes: 0 };
  // Far enough ahead to cover next Sunday in any zone.
  const shifts = await dbGetScheduledShiftsBetween(
    now,
    new Date(now.getTime() + 9 * DAY_MS),
  );
  if (shifts.length === 0) return result;

  const userIds = [...new Set(shifts.map((s) => s.user_id))];
  const prefs = await dbGetNotificationPreferencesFor(userIds);
  const timezones = new Map(prefs.map((p) => [p.user_id, p.timezone]));
  const due = planWeeklyDigests(shifts, timezones, now);
  if (due.length === 0) return result;

  const orgIds = [...new Set(due.map((d) => d.orgId))];
  const settingsRows = await dbGetAlertSettingsFor(orgIds);
  const settingsByOrg = new Map(settingsRows.map((r) => [r.org_id, r]));

  for (const orgId of orgIds) {
    if (!normalizeAlertSettings(settingsByOrg.get(orgId)).schedule_notifications) {
      continue;
    }
    try {
      const members: OrgMember[] = await loadOrgMembers(orgId);
      for (const digest of due.filter((d) => d.orgId === orgId)) {
        const member = members.find((m) => m.userId === digest.userId);
        if (!member) continue;
        const key = `week:${orgId}:${digest.userId}:${digest.weekOf}`;
        if (!(await dbClaimAlert(key, orgId))) continue;
        const counts = await deliver([
          {
            recipient: { userId: member.userId, email: member.email },
            category: "schedule_alerts",
            message: describeWeeklyDigest(digest),
          },
        ]);
        result.digests += 1;
        result.emails += counts.email;
        result.pushes += counts.push;
      }
    } catch (error) {
      console.error(`[Schedule] Weekly digests failed for ${orgId}:`, error);
    }
  }
  return result;
}
