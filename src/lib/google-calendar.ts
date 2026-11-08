import { createHash } from "node:crypto";
import { clerkClient } from "@clerk/nextjs/server";
import { shiftToCalendarEvent } from "./calendar-export";
import { GOOGLE_CALENDAR_SCOPE } from "./calendar-feed-links";
import type { ScheduledShift } from "./types";

/**
 * Writes a member's shifts straight into their own primary Google Calendar,
 * through the Google account they signed in (or connected) with in Clerk.
 * Events get a fixed id per shift, so adding a shift twice updates it, and a
 * private property naming the org and member, so a sync only ever touches
 * events it made.
 */

export { GOOGLE_CALENDAR_SCOPE } from "./calendar-feed-links";

const API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

export type GoogleCalendarAccess =
  | { status: "ok"; token: string }
  | { status: "not_connected" | "missing_scope" };

/** The member's Google access token, if they've allowed calendar access. */
export async function getGoogleCalendarAccess(
  userId: string,
): Promise<GoogleCalendarAccess> {
  const client = await clerkClient();
  const tokens = await client.users
    .getUserOauthAccessToken(userId, "google")
    .then((res) => res.data)
    .catch(() => []);
  if (tokens.length === 0) return { status: "not_connected" };
  const withScope = tokens.find(
    (t) => t.token && t.scopes?.includes(GOOGLE_CALENDAR_SCOPE),
  );
  return withScope
    ? { status: "ok", token: withScope.token }
    : { status: "missing_scope" };
}

/** Marks events as ours, per org and member. */
export const syncScope = (orgId: string, userId: string) =>
  `${orgId}:${userId}`;

/**
 * Google event ids may only use a–v and 0–9. Hex is a subset of that, so the
 * org is hashed to hex and the shift id kept readable.
 */
export function googleEventId(shift: Pick<ScheduledShift, "id" | "org_id">) {
  const org = createHash("sha256").update(shift.org_id).digest("hex");
  return `clockout${org.slice(0, 16)}s${shift.id}`;
}

export function googleEventBody(shift: ScheduledShift) {
  const event = shiftToCalendarEvent(shift);
  return {
    id: googleEventId(shift),
    summary: event.title,
    description: event.description,
    start: { dateTime: event.start.toISOString() },
    end: { dateTime: event.end.toISOString() },
    status: "confirmed",
    extendedProperties: {
      private: {
        clockoutScope: syncScope(shift.org_id, shift.user_id),
        clockoutShift: String(shift.id),
      },
    },
  };
}

export class GoogleCalendarError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
  /** The token was revoked or lost the calendar scope. */
  get needsReconnect() {
    return this.status === 401 || this.status === 403;
  }
}

async function google(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  // A missing event is fine to "delete" again.
  if (
    !res.ok &&
    !(method === "DELETE" && (res.status === 404 || res.status === 410))
  ) {
    throw new GoogleCalendarError(
      res.status,
      `Google Calendar ${method} failed: ${res.status} ${await res.text().catch(() => "")}`,
    );
  }
  return res;
}

/** Adds the shift's event, or updates it if it's there (even if deleted). */
export async function upsertShiftEvent(token: string, shift: ScheduledShift) {
  const body = googleEventBody(shift);
  try {
    await google(token, "POST", "", body);
    return "added" as const;
  } catch (e) {
    if (!(e instanceof GoogleCalendarError) || e.status !== 409) throw e;
  }
  await google(token, "PUT", `/${body.id}`, body);
  return "updated" as const;
}

export async function deleteShiftEvent(
  token: string,
  shift: Pick<ScheduledShift, "id" | "org_id">,
) {
  await google(token, "DELETE", `/${googleEventId(shift)}`);
}

type ListedEvent = { id: string; status?: string };

/** Our events for this member in the window. */
async function listSyncedEvents(
  token: string,
  scope: string,
  start: Date,
  end: Date,
): Promise<ListedEvent[]> {
  const events: ListedEvent[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      privateExtendedProperty: `clockoutScope=${scope}`,
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      maxResults: "250",
      ...(pageToken ? { pageToken } : {}),
    });
    const res = await google(token, "GET", `?${params.toString()}`);
    const json = (await res.json()) as {
      items?: ListedEvent[];
      nextPageToken?: string;
    };
    events.push(...(json.items ?? []));
    pageToken = json.nextPageToken;
  } while (pageToken);
  return events;
}

/**
 * Makes the member's Google Calendar match their shifts in the window: adds
 * or updates every shift, and removes our events for shifts that are gone.
 */
export async function syncShiftsToGoogleCalendar(
  token: string,
  orgId: string,
  userId: string,
  shifts: ScheduledShift[],
  start: Date,
  end: Date,
) {
  const existing = await listSyncedEvents(
    token,
    syncScope(orgId, userId),
    start,
    end,
  );
  const wanted = new Set(shifts.map(googleEventId));
  let added = 0;
  let updated = 0;
  for (const shift of shifts) {
    if ((await upsertShiftEvent(token, shift)) === "added") added++;
    else updated++;
  }
  const stale = existing.filter(
    (event) => !wanted.has(event.id) && event.status !== "cancelled",
  );
  for (const event of stale) {
    await google(token, "DELETE", `/${event.id}`);
  }
  return { added, updated, removed: stale.length };
}

/**
 * Keeps one shift in step after an admin adds, changes or removes it, for a
 * member who turned on Google Calendar. Does nothing for anyone else.
 */
export async function mirrorShiftChange(
  change: "added" | "changed" | "removed",
  shift: ScheduledShift,
) {
  const access = await getGoogleCalendarAccess(shift.user_id);
  if (access.status !== "ok") return;
  if (change === "removed") {
    await deleteShiftEvent(access.token, shift);
  } else {
    await upsertShiftEvent(access.token, shift);
  }
}
