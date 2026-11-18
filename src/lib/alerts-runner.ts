import { clerkClient } from "@clerk/nextjs/server";
import { revalidateTag } from "next/cache";
import {
  alertCategory,
  alertUserId,
  describeAlert,
  normalizeAlertSettings,
  type PlannedAlert,
  planShiftAlerts,
  SCHEDULED_CLOCK_OUT_WINDOW_MS,
  SCHEDULED_EARLY_CLOCK_IN_MS,
} from "./alerts";
import {
  dbAutoClockOut,
  dbClaimAlert,
  dbDisableScheduledClockRules,
  dbGetActiveAlertSettings,
  dbGetOpenShiftBreaks,
  dbGetOpenShifts,
  dbGetOrgScheduledShiftsOverlapping,
  dbScheduledClockIn,
  dbScheduledClockOut,
} from "./alerts-db";
import { createFeatureCheck, NOTIFICATIONS_FEATURE } from "./billing";
import { getBreakLimits } from "./break-utils";
import { fetchAllPages } from "./clerk-pagination";
import { dbGetBreakSettings } from "./db";
import { type Delivery, deliver } from "./notify";
import { orgHasPlanFeatureStrict, SCHEDULING_FEATURE } from "./plan-features";
import type { AlertSettingsData, AlertSettingsInput } from "./types";

export type OrgMember = {
  userId: string;
  name: string;
  email: string | null;
  isAdmin: boolean;
};

export type OrgAlertResult =
  | {
      orgId: string;
      status: "ok";
      alerts: number;
      autoClockIns: number;
      autoClockOuts: number;
      emails: number;
      pushes: number;
    }
  | { orgId: string; status: "error" };

/** Every member of an org, with what the alert sender needs. */
export async function loadOrgMembers(orgId: string): Promise<OrgMember[]> {
  const client = await clerkClient();
  const memberships = await fetchAllPages(
    (params) =>
      client.organizations.getOrganizationMembershipList({
        organizationId: orgId,
        ...params,
      }),
    { label: `members of ${orgId}` },
  );
  const members: OrgMember[] = [];
  for (const m of memberships) {
    const data = m.publicUserData;
    if (!data?.userId) continue;
    const identifier = data.identifier ?? "";
    const fullName = `${data.firstName ?? ""} ${data.lastName ?? ""}`.trim();
    members.push({
      userId: data.userId,
      name: fullName || identifier || "A team member",
      email: identifier.includes("@") ? identifier : null,
      isAdmin: m.role === "org:admin",
    });
  }
  return members;
}

/** Who hears about one alert: the member, plus (optionally) their admins. */
export function buildDeliveries(
  alert: PlannedAlert,
  members: OrgMember[],
  orgId: string,
  notifyAdmins: boolean,
): Delivery[] {
  const userId = alertUserId(alert);
  const member = members.find((m) => m.userId === userId);
  const memberName = member?.name ?? "A team member";
  const deliveries: Delivery[] = [];

  if (member) {
    deliveries.push({
      recipient: { userId, email: member.email },
      category: alertCategory(alert),
      message: describeAlert(alert, { forAdmin: false, memberName, orgId }),
    });
  }

  if (notifyAdmins) {
    const adminMessage = describeAlert(alert, {
      forAdmin: true,
      memberName,
      orgId,
    });
    for (const admin of members) {
      // An admin's own shift already reaches them as the member.
      if (!admin.isAdmin || admin.userId === userId) continue;
      deliveries.push({
        recipient: { userId: admin.userId, email: admin.email },
        category: "admin_alerts",
        message: adminMessage,
      });
    }
  }

  return deliveries;
}

/**
 * Whether admins also hear about this alert. "Your break is over" goes out
 * for every break with a time limit, so admins only get it when they asked to
 * follow breaks (the "forgot to end break" rule is on).
 */
export function alertNotifiesAdmins(
  alert: PlannedAlert,
  settings: ReturnType<typeof normalizeAlertSettings>,
): boolean {
  if (!settings.notify_admins) return false;
  // Every scheduled shift starts and ends: copying admins on each would be
  // noise. They see it on the schedule and in Hours.
  if (
    alert.kind === "scheduled_clock_in" ||
    alert.kind === "scheduled_clock_out"
  ) {
    return false;
  }
  return alert.kind !== "break_over" || settings.break_reminder_enabled;
}

/**
 * Switches the org's scheduled auto clock-in/out rules off for good (they're
 * saved off, so the Settings page shows them off too). Returns whether one
 * was on.
 */
export async function turnOffScheduledClockRules(
  orgId: string,
): Promise<boolean> {
  const row = await dbDisableScheduledClockRules(orgId);
  if (!row) return false;
  console.log(
    `[Alerts] Scheduling is off for ${orgId}: turned off auto clock-in/out`,
  );
  revalidateTag(`alert-settings-${orgId}`, { expire: 0 });
  return true;
}

/**
 * The rules as they apply to this org: the scheduled auto clock-in/out rules
 * act on the schedule, so they're off while the org's plan doesn't include
 * Scheduling (its schedule is hidden then, and its reminders stop), and are
 * then switched off for good. Only asks Clerk when one of them is on. When
 * Clerk can't be reached they're skipped this time but left saved on, so a
 * billing outage never turns them off.
 */
export async function withScheduledRulesAllowed(
  orgId: string,
  settings: AlertSettingsInput,
): Promise<AlertSettingsInput> {
  if (!settings.auto_clock_in_scheduled && !settings.auto_clock_out_scheduled) {
    return settings;
  }
  const off = {
    ...settings,
    auto_clock_in_scheduled: false,
    auto_clock_out_scheduled: false,
  };
  let hasScheduling: boolean;
  try {
    hasScheduling = await orgHasPlanFeatureStrict(orgId, SCHEDULING_FEATURE);
  } catch (error) {
    console.error(`[Alerts] Plan unavailable for ${orgId}:`, error);
    return off;
  }
  if (hasScheduling) return settings;
  await turnOffScheduledClockRules(orgId).catch((error) => {
    console.error(
      `[Alerts] Couldn't turn off auto clocking for ${orgId}:`,
      error,
    );
  });
  return off;
}

/** Alerts that change someone's clock, which run on every plan. */
function isClockAction(alert: PlannedAlert): boolean {
  return (
    alert.kind === "auto_clock_out" ||
    alert.kind === "scheduled_clock_in" ||
    alert.kind === "scheduled_clock_out"
  );
}

/**
 * Runs one org's rules: close what ran too long, then send what's due.
 * With `notify` false (no paid `notifications` feature) shifts are still
 * closed, but no alert is sent. `row` may hold just the org id when the org
 * has no alert rules saved: break time limits alone still send "your break
 * is over".
 */
export async function processOrgAlerts(
  row: Pick<AlertSettingsData, "org_id"> & Partial<AlertSettingsData>,
  now: Date,
  notify = true,
): Promise<OrgAlertResult> {
  const orgId = row.org_id;
  const settings = await withScheduledRulesAllowed(
    orgId,
    normalizeAlertSettings(row),
  );
  const scheduledRules =
    settings.auto_clock_in_scheduled || settings.auto_clock_out_scheduled;
  const [shifts, breaks, breakSettings, scheduled] = await Promise.all([
    dbGetOpenShifts(orgId),
    // Fetched whatever the rules: a break's time limit alone sends "your
    // break is over".
    dbGetOpenShiftBreaks(orgId),
    dbGetBreakSettings(orgId).catch((e) => {
      console.error(`[Alerts] Break settings unavailable for ${orgId}:`, e);
      return undefined;
    }),
    scheduledRules
      ? dbGetOrgScheduledShiftsOverlapping(
          orgId,
          new Date(now.getTime() - SCHEDULED_CLOCK_OUT_WINDOW_MS),
          new Date(now.getTime() + 1),
        )
      : Promise.resolve([]),
  ]);

  const planned = planShiftAlerts({
    settings,
    breakSettings,
    shifts,
    breaks,
    scheduled,
    now,
  }).filter((alert) => notify || isClockAction(alert));
  const result = {
    orgId,
    status: "ok" as const,
    alerts: 0,
    autoClockIns: 0,
    autoClockOuts: 0,
    emails: 0,
    pushes: 0,
  };
  if (planned.length === 0) return result;

  const members = await loadOrgMembers(orgId);
  const limits = getBreakLimits(breakSettings);

  for (const alert of planned) {
    if (
      alert.kind === "scheduled_clock_in" ||
      alert.kind === "scheduled_clock_out"
    ) {
      // Claimed before acting, not after: each scheduled start and end is
      // acted on once, so a member who clocks out early isn't clocked back
      // in by the next check, nor clocked out twice.
      if (!(await dbClaimAlert(alert.key, orgId))) continue;
      const entry =
        alert.kind === "scheduled_clock_in"
          ? await dbScheduledClockIn(alert.scheduled)
          : await dbScheduledClockOut(
              alert.scheduled,
              SCHEDULED_EARLY_CLOCK_IN_MS,
              limits,
            );
      // Already in (or out), or the shift moved: nothing to tell.
      if (!entry) continue;
      if (alert.kind === "scheduled_clock_in") result.autoClockIns += 1;
      else result.autoClockOuts += 1;
      revalidateTag(`time-entries-${entry.user_id}-${orgId}`, { expire: 0 });
      revalidateTag(`org-time-entries-${orgId}`, { expire: 0 });
      if (!notify) continue;
      const counts = await deliver(
        buildDeliveries(
          alert,
          members,
          orgId,
          alertNotifiesAdmins(alert, settings),
        ),
      );
      result.alerts += 1;
      result.emails += counts.email;
      result.pushes += counts.push;
      continue;
    }

    if (alert.kind === "auto_clock_out") {
      const closed = await dbAutoClockOut(alert.shift.id, alert.hours, limits);
      // Already clocked out (or edited) since we looked: nothing to tell.
      if (!closed) continue;
      result.autoClockOuts += 1;
      revalidateTag(`time-entries-${closed.user_id}-${orgId}`, { expire: 0 });
      revalidateTag(`org-time-entries-${orgId}`, { expire: 0 });
    }

    if (!notify) continue;
    if (!(await dbClaimAlert(alert.key, orgId))) continue;

    const counts = await deliver(
      buildDeliveries(
        alert,
        members,
        orgId,
        alertNotifiesAdmins(alert, settings),
      ),
    );
    result.alerts += 1;
    result.emails += counts.email;
    result.pushes += counts.push;
  }

  return result;
}

/**
 * One pass of the shift-alert cron over every org with a rule switched on.
 * Orgs without the paid `notifications` feature still get auto clock-outs,
 * but nobody is emailed or pushed. A failure in one org is logged and
 * reported, and never stops the others.
 */
export async function runShiftAlerts(
  now: Date = new Date(),
  hasNotifications: (orgId: string) => Promise<boolean> = createFeatureCheck(
    NOTIFICATIONS_FEATURE,
  ),
): Promise<OrgAlertResult[]> {
  const rows = await dbGetActiveAlertSettings();
  const results: OrgAlertResult[] = [];
  for (const row of rows) {
    try {
      const notify = await hasNotifications(row.org_id);
      results.push(await processOrgAlerts(row, now, notify));
    } catch (error) {
      console.error(`[Alerts] Failed for org ${row.org_id}:`, error);
      results.push({ orgId: row.org_id, status: "error" });
    }
  }
  return results;
}
