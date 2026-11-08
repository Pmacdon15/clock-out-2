import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Calendar subscription feeds: each member gets a private URL serving their
 * shifts as an iCalendar feed that Google Calendar, Apple Calendar and
 * Outlook subscribe to and refresh on their own. Calendar apps can't sign in,
 * so the URL carries a token signed with a server secret that names the org
 * and member; there is no table to keep in sync.
 */

export const CALENDAR_FEED_PATH = "/api/calendar";

/**
 * Token formats. v1 tokens name the org and member only; v2 tokens add the
 * member's feed nonce, which "Reset link" rotates to revoke old URLs. A v1
 * token keeps working until its member first resets their link.
 */
const TOKEN_V1 = "v1";
const TOKEN_V2 = "v2";

/** Where a member's feed nonce is kept, in their Clerk private metadata. */
export const FEED_NONCE_METADATA_KEY = "calendarFeedNonce";

function feedSecret(): string | null {
  return (
    process.env.CALENDAR_FEED_SECRET || process.env.CLERK_SECRET_KEY || null
  );
}

const sign = (payload: string, secret: string) =>
  createHmac("sha256", `clockout-calendar-feed:${secret}`)
    .update(payload)
    .digest("base64url");

/** A fresh random feed nonce. */
export const newFeedNonce = () => randomBytes(12).toString("base64url");

/** A member's current feed nonce from their Clerk private metadata. */
export function feedNonceFrom(
  privateMetadata: Record<string, unknown> | null | undefined,
): string | null {
  const nonce = privateMetadata?.[FEED_NONCE_METADATA_KEY];
  return typeof nonce === "string" && /^[\w-]{8,64}$/.test(nonce)
    ? nonce
    : null;
}

/**
 * A token for one member's feed in one org, or null without a secret. With a
 * nonce, the token only works while that nonce is the member's current one.
 */
export function createFeedToken(
  orgId: string,
  userId: string,
  nonce: string | null = null,
): string | null {
  const secret = feedSecret();
  if (!secret) return null;
  const raw = nonce
    ? `${TOKEN_V2}:${orgId}:${userId}:${nonce}`
    : `${TOKEN_V1}:${orgId}:${userId}`;
  const payload = Buffer.from(raw).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

/**
 * The org, member and nonce (null for a v1 token) a feed token was made
 * for, or null if it isn't valid. Callers must still check the nonce
 * against the member's current one with {@link feedNonceMatches}.
 */
export function verifyFeedToken(
  token: string,
): { orgId: string; userId: string; nonce: string | null } | null {
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
  if (!orgId || !userId) return null;
  if (version === TOKEN_V1 && extra.length === 0) {
    return { orgId, userId, nonce: null };
  }
  if (version === TOKEN_V2 && extra.length === 1 && extra[0]) {
    return { orgId, userId, nonce: extra[0] };
  }
  return null;
}

/** Whether a token's nonce is the member's current one (both null for v1). */
export const feedNonceMatches = (
  tokenNonce: string | null,
  currentNonce: string | null,
) => tokenNonce === currentNonce;

/** The feed's path for a token; `.ics` helps apps recognise it. */
export const feedPath = (token: string) => `${CALENDAR_FEED_PATH}/${token}.ics`;
