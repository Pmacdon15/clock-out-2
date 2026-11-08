import { type NotificationMessage, normalizeAlertSettings } from "./alerts";
import {
  dbGetAlertSettingsFor,
  dbGetNotificationPreferencesFor,
} from "./alerts-db";
import { loadOrgMembers, type OrgMember } from "./alerts-runner";
import { NOTIFICATIONS_FEATURE, orgHasFeature } from "./billing";
import { mirrorShiftToGoogleCalendar } from "./google-calendar";
import { type Delivery, deliver } from "./notify";
import { formatShiftRange, resolveTimezone } from "./schedule-notify";
import { shiftRequestParties } from "./shift-requests";
import type { ScheduledShift, ShiftRequest } from "./types";

/*
 * Who hears about each step of a shift swap or pickup request, and what
 * they're told. Sent like schedule notices: only for orgs with the paid
 * `notifications` feature and schedule notices on, over each person's own
 * channels. Never throws.
 */

export type ShiftRequestEvent =
  | "created"
  | "claimed"
  | "approved"
  | "denied"
  | "cancelled";

const SCHEDULE_URL = "/schedule";

type Shift = { shift_start: Date | string; shift_end: Date | string };

/** Whom to tell about `event`, leaving out whoever did it. */
export function shiftRequestRecipients(
  event: ShiftRequestEvent,
  request: ShiftRequest,
  members: OrgMember[],
  actorId: string,
): OrgMember[] {
  const { giver, taker } = shiftRequestParties(request);
  let ids: string[];
  if (event === "created") {
    ids =
      request.target_user_id !== null
        ? [request.target_user_id]
        : // An open offer goes to every coworker who could claim it.
          members.map((m) => m.userId);
  } else if (event === "claimed") {
    ids = [
      request.requested_by,
      ...(taker ? [taker] : []),
      ...members.filter((m) => m.isAdmin).map((m) => m.userId),
    ];
  } else {
    ids = [giver, request.requested_by, ...(taker ? [taker] : [])];
    if (request.target_user_id) ids.push(request.target_user_id);
  }
  const wanted = new Set(ids);
  wanted.delete(actorId);
  return members.filter((m) => wanted.has(m.userId));
}

/** The text one recipient gets. Pure. */
export function describeShiftRequestEvent(
  event: ShiftRequestEvent,
  request: ShiftRequest,
  shift: Shift,
  names: Map<string, string>,
  recipient: OrgMember,
  zone: { tz: string; known: boolean },
): NotificationMessage {
  const name = (id: string | null) => (id && names.get(id)) || "A coworker";
  const range = formatShiftRange(
    new Date(shift.shift_start),
    new Date(shift.shift_end),
    zone,
  );
  const tag = `shift-request:${request.id}:${event}`;
  const base = { url: SCHEDULE_URL, tag };
  const requester = name(request.requested_by);
  const note = request.note ? ` Note: ${request.note}` : "";

  if (event === "created") {
    if (request.request_type === "offer") {
      return {
        ...base,
        title: "Shift up for grabs",
        body: `${requester} is offering their shift ${range}. Claim it in Clock Out.${note}`,
      };
    }
    return request.request_type === "swap"
      ? {
          ...base,
          title: "Shift swap request",
          body: `${requester} wants to swap their shift ${range} for one of yours. Accept or decline it in Clock Out.${note}`,
        }
      : {
          ...base,
          title: "Pickup request",
          body: `${requester} would like to take your shift ${range}. Accept or decline it in Clock Out.${note}`,
        };
  }
  if (event === "claimed") {
    const taker = name(request.claimed_by);
    return recipient.isAdmin && recipient.userId !== request.requested_by
      ? {
          ...base,
          title: "Shift change needs approval",
          body: `${requester} and ${taker} agreed to a ${request.request_type === "swap" ? "swap" : "shift change"} for ${range}. Approve or deny it in Clock Out.`,
        }
      : {
          ...base,
          title: "Shift request accepted",
          body: `${taker} accepted the request for ${range}. It's waiting for a manager's approval.`,
        };
  }
  if (event === "approved") {
    return {
      ...base,
      title: "Shift change approved",
      body: `The ${request.request_type === "swap" ? "swap" : "shift change"} for ${range} was approved, and the schedule is updated.${request.review_note ? ` Note: ${request.review_note}` : ""}`,
    };
  }
  if (event === "denied") {
    return {
      ...base,
      title: "Shift change denied",
      body: `The request for ${range} was denied, so the schedule stays as it was.${request.review_note ? ` Note: ${request.review_note}` : ""}`,
    };
  }
  return {
    ...base,
    title: "Shift request withdrawn",
    body: `The request for ${range} was cancelled, so the schedule stays as it was.`,
  };
}

/**
 * Tells the people involved that a request was made, claimed, approved,
 * denied or cancelled by `actorId`. Returns how many people were told.
 */
export async function notifyShiftRequest(
  event: ShiftRequestEvent,
  request: ShiftRequest,
  shift: Shift,
  actorId: string,
  actorTimezone?: string | null,
): Promise<number> {
  try {
    const orgId = request.org_id;
    const [settingsRows, members] = await Promise.all([
      dbGetAlertSettingsFor([orgId]),
      loadOrgMembers(orgId),
    ]);
    if (!normalizeAlertSettings(settingsRows[0]).schedule_notifications) {
      return 0;
    }
    if (!(await orgHasFeature(orgId, NOTIFICATIONS_FEATURE))) return 0;
    const recipients = shiftRequestRecipients(event, request, members, actorId);
    if (recipients.length === 0) return 0;

    const prefs = await dbGetNotificationPreferencesFor(
      recipients.map((m) => m.userId),
    );
    const zones = new Map(prefs.map((p) => [p.user_id, p.timezone]));
    const names = new Map(members.map((m) => [m.userId, m.name]));
    const deliveries: Delivery[] = recipients.map((member) => ({
      recipient: { userId: member.userId, email: member.email },
      category: "schedule_alerts",
      message: describeShiftRequestEvent(
        event,
        request,
        shift,
        names,
        member,
        resolveTimezone(zones.get(member.userId), actorTimezone),
      ),
    }));
    await deliver(deliveries);
    return deliveries.length;
  } catch (error) {
    console.error("[Shift requests] Failed to send a notice:", error);
    return 0;
  }
}

/**
 * Moves reassigned shifts between people's own Google Calendars: off the
 * old owner's, onto the new owner's. Never throws.
 */
export async function mirrorReassignedShifts(
  previous: ScheduledShift[],
  current: ScheduledShift[],
): Promise<void> {
  const log = (error: unknown) => {
    console.error("[Google Calendar] Failed to move a traded shift:", error);
  };
  await Promise.all([
    ...previous.map((shift) =>
      mirrorShiftToGoogleCalendar("removed", shift).catch(log),
    ),
    ...current.map((shift) =>
      mirrorShiftToGoogleCalendar("added", shift).catch(log),
    ),
  ]);
}
