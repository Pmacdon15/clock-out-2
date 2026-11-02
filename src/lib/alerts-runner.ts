import { clerkClient } from "@clerk/nextjs/server";
import { revalidateTag } from "next/cache";
import {
  alertCategory,
  alertUserId,
  describeAlert,
  normalizeAlertSettings,
  type PlannedAlert,
  planShiftAlerts,
} from "./alerts";
import {
  dbAutoClockOut,
  dbClaimAlert,
  dbGetActiveAlertSettings,
  dbGetOpenShiftBreaks,
  dbGetOpenShifts,
  type OpenShiftBreak,
} from "./alerts-db";
import { createFeatureCheck, NOTIFICATIONS_FEATURE } from "./billing";
import { getBreakLimits } from "./break-utils";
import { fetchAllPages } from "./clerk-pagination";
import { dbGetBreakSettings } from "./db";
import { type Delivery, deliver } from "./notify";
import type { AlertSettingsData } from "./types";

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
 * Runs one org's rules: close what ran too long, then send what's due.
 * With `notify` false (no paid `notifications` feature) shifts are still
 * closed, but no alert is sent.
 */
export async function processOrgAlerts(
  row: AlertSettingsData,
  now: Date,
  notify = true,
): Promise<OrgAlertResult> {
  const orgId = row.org_id;
  const settings = normalizeAlertSettings(row);
  const [shifts, breaks, breakSettings] = await Promise.all([
    dbGetOpenShifts(orgId),
    settings.break_reminder_enabled
      ? dbGetOpenShiftBreaks(orgId)
      : Promise.resolve([] as OpenShiftBreak[]),
    dbGetBreakSettings(orgId).catch((e) => {
      console.error(`[Alerts] Break settings unavailable for ${orgId}:`, e);
      return undefined;
    }),
  ]);

  const planned = planShiftAlerts({
    settings,
    breakSettings,
    shifts,
    breaks,
    now,
  }).filter((alert) => notify || alert.kind === "auto_clock_out");
  const result = {
    orgId,
    status: "ok" as const,
    alerts: 0,
    autoClockOuts: 0,
    emails: 0,
    pushes: 0,
  };
  if (planned.length === 0) return result;

  const members = await loadOrgMembers(orgId);
  const limits = getBreakLimits(breakSettings);

  for (const alert of planned) {
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
      buildDeliveries(alert, members, orgId, settings.notify_admins),
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
