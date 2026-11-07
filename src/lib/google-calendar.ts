import { createHash } from "node:crypto";
import type { CalendarShiftEvent } from "./calendar-export";
import type { ScheduledShift } from "./types";

/**
 * Puts shifts straight onto the user's own Google Calendar through the
 * Calendar API, with the Google access token Clerk holds for their linked
 * Google account. Unlike a "new event" link, nothing depends on the Google
 * Calendar app picking up the link's details, so it works the same on phones
 * and computers.
 */

const EVENTS_URL =
  "https://www.googleapis.com/calendar/v3/calendars/primary/events";

/**
 * A stable Google event id per shift, so adding a shift again updates its
 * event instead of duplicating it. Google ids allow only 0-9 and a-v; hex
 * fits.
 */
export const googleShiftEventId = (
  shift: Pick<ScheduledShift, "id" | "org_id">,
) =>
  `clockout${createHash("sha256")
    .update(`${shift.org_id}:${shift.id}`)
    .digest("hex")
    .slice(0, 40)}`;

export type GoogleCalendarFailure =
  /** The token is gone, expired or lacks the calendar scope. */
  | "reconnect"
  /** The Calendar API isn't turned on for the app's Google Cloud project. */
  | "api_disabled"
  | "failed";

export type GoogleCalendarWrite =
  | { ok: true; outcome: "added" | "updated" }
  | { ok: false; failure: GoogleCalendarFailure };

const eventBody = (event: CalendarShiftEvent, id: string) => ({
  id,
  summary: event.title,
  description: event.description,
  start: { dateTime: event.start.toISOString() },
  end: { dateTime: event.end.toISOString() },
  // Brings back an event the user deleted when the shift is added again.
  status: "confirmed",
});

async function failureFor(res: Response): Promise<GoogleCalendarFailure> {
  if (res.status === 401) return "reconnect";
  if (res.status === 403) {
    const body = await res.text().catch(() => "");
    if (/accessNotConfigured|SERVICE_DISABLED/.test(body)) {
      return "api_disabled";
    }
    if (/insufficient/i.test(body)) return "reconnect";
  }
  return "failed";
}

/** Adds the shift's event, or updates it if it is already on the calendar. */
export async function writeGoogleCalendarEvent(
  accessToken: string,
  event: CalendarShiftEvent,
  id: string,
): Promise<GoogleCalendarWrite> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
  const body = JSON.stringify(eventBody(event, id));

  const created = await fetch(EVENTS_URL, { method: "POST", headers, body });
  if (created.ok) return { ok: true, outcome: "added" };
  // 409: an event with this id exists (even one the user deleted).
  if (created.status !== 409) {
    return { ok: false, failure: await failureFor(created) };
  }

  const updated = await fetch(`${EVENTS_URL}/${id}`, {
    method: "PUT",
    headers,
    body,
  });
  if (updated.ok) return { ok: true, outcome: "updated" };
  return { ok: false, failure: await failureFor(updated) };
}
