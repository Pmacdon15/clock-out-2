import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Calendar subscription feeds: each member gets a private URL serving their
 * shifts as an iCalendar feed that Google Calendar, Apple Calendar and
 * Outlook subscribe to and refresh on their own. Calendar apps can't sign in,
 * so the URL carries a token signed with a server secret that names the org
 * and member; there is no table to keep in sync.
 */

export const CALENDAR_FEED_PATH = "/api/calendar";

/** Bump to invalidate every feed URL handed out so far. */
const TOKEN_VERSION = "v1";

function feedSecret(): string | null {
  return (
    process.env.CALENDAR_FEED_SECRET || process.env.CLERK_SECRET_KEY || null
  );
}

const sign = (payload: string, secret: string) =>
  createHmac("sha256", `clockout-calendar-feed:${secret}`)
    .update(payload)
    .digest("base64url");

/** A token for one member's feed in one org, or null without a secret. */
export function createFeedToken(orgId: string, userId: string): string | null {
  const secret = feedSecret();
  if (!secret) return null;
  const payload = Buffer.from(`${TOKEN_VERSION}:${orgId}:${userId}`).toString(
    "base64url",
  );
  return `${payload}.${sign(payload, secret)}`;
}

/** The org and member a feed token was made for, or null if it isn't valid. */
export function verifyFeedToken(
  token: string,
): { orgId: string; userId: string } | null {
  const secret = feedSecret();
  if (!secret) return null;
  const [payload, signature, ...rest] = token.split(".");
  if (!payload || !signature || rest.length > 0) return null;
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return null;
  }
  const [version, orgId, userId, ...extra] = Buffer.from(payload, "base64url")
    .toString()
    .split(":");
  if (version !== TOKEN_VERSION || !orgId || !userId || extra.length > 0) {
    return null;
  }
  return { orgId, userId };
}

/** The feed's path for a token; `.ics` helps apps recognise it. */
export const feedPath = (token: string) => `${CALENDAR_FEED_PATH}/${token}.ics`;
