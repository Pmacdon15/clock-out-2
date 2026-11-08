"use server";

import { auth, clerkClient } from "@clerk/nextjs/server";
import { shiftToCalendarEvent } from "./calendar-export";
import { dbGetScheduledShiftById } from "./db";
import {
  type GoogleCalendarFailure,
  googleShiftEventId,
  writeGoogleCalendarEvent,
} from "./google-calendar";
import { GOOGLE_CALENDAR_SCOPE } from "./google-calendar-scope";
import { SCHEDULING_FEATURE, SCHEDULING_UPGRADE_REASON } from "./plan-features";
import type { ScheduledShift } from "./types";

/** Most shifts one tap can add; the schedule shows four weeks at most. */
const MAX_SHIFTS_PER_ADD = 60;

export type AddToGoogleCalendarResult =
  | { status: "ok"; added: number; updated: number }
  /** The user must link Google or allow calendar access first. */
  | { status: "connect" }
  | { status: "error"; error: string; failure?: GoogleCalendarFailure };

const FAILURE_MESSAGES: Record<GoogleCalendarFailure, string> = {
  reconnect: "Google Calendar access expired. Allow access again.",
  api_disabled:
    "Google Calendar isn't set up for Clock Out yet. Ask your admin to turn on the Google Calendar API.",
  failed: "Google Calendar didn't accept the shift. Try again.",
};

/** The user's Google token, if they linked Google with calendar access. */
async function googleCalendarToken(userId: string): Promise<string | null> {
  const client = await clerkClient();
  const tokens = await client.users
    .getUserOauthAccessToken(userId, "google")
    .catch(() => null);
  const token = tokens?.data.find((t) =>
    t.scopes?.includes(GOOGLE_CALENDAR_SCOPE),
  );
  return token?.token ?? null;
}

async function memberName(userId: string): Promise<string | undefined> {
  const client = await clerkClient();
  const user = await client.users.getUser(userId).catch(() => null);
  const name = `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim();
  return name || undefined;
}

/**
 * Adds shifts to the signed-in user's own Google Calendar. Members can add
 * their own shifts; admins can add any shift in the org (titled with the
 * member's name). Adding a shift again updates its event.
 */
export async function addShiftsToGoogleCalendarAction(
  shiftIds: number[],
): Promise<AddToGoogleCalendarResult> {
  const { userId, orgId, orgRole, has } = await auth.protect();
  if (!userId || !orgId) {
    return { status: "error", error: "Unauthorized" };
  }
  if (!has({ feature: SCHEDULING_FEATURE })) {
    return { status: "error", error: SCHEDULING_UPGRADE_REASON };
  }
  const ids = [...new Set(shiftIds)].filter(Number.isInteger);
  if (ids.length === 0 || ids.length > MAX_SHIFTS_PER_ADD) {
    return { status: "error", error: "Pick between 1 and 60 shifts" };
  }

  const isAdmin = orgRole === "org:admin";
  const shifts = (
    await Promise.all(ids.map((id) => dbGetScheduledShiftById(id, orgId)))
  ).filter(
    (shift): shift is ScheduledShift =>
      !!shift && (isAdmin || shift.user_id === userId),
  );
  if (shifts.length === 0) {
    return { status: "error", error: "Shift not found" };
  }

  const token = await googleCalendarToken(userId);
  if (!token) return { status: "connect" };

  const names = new Map<string, string | undefined>();
  let added = 0;
  let updated = 0;
  for (const shift of shifts) {
    if (shift.user_id !== userId && !names.has(shift.user_id)) {
      names.set(shift.user_id, await memberName(shift.user_id));
    }
    const write = await writeGoogleCalendarEvent(
      token,
      shiftToCalendarEvent(shift, names.get(shift.user_id)),
      googleShiftEventId(shift),
    ).catch(() => ({ ok: false as const, failure: "failed" as const }));
    if (!write.ok) {
      if (write.failure === "reconnect") return { status: "connect" };
      console.error("[Google Calendar] Write failed:", write.failure);
      return {
        status: "error",
        error: FAILURE_MESSAGES[write.failure],
        failure: write.failure,
      };
    }
    if (write.outcome === "added") added++;
    else updated++;
  }
  return { status: "ok", added, updated };
}
