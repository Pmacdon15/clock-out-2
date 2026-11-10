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
 * Token format. v2 tokens name the org, the member and the member's feed
 * nonce, which "Reset link" rotates to revoke old URLs. Legacy v1 tokens
 * (org and member only, no nonce) could never be revoked, so they are no
 * longer issued or accepted: a member with an old v1 URL subscribes again
 * with the link the Schedule page now shows.
 */
const TOKEN_V2 = "v2";

/** Where a member's feed nonce is kept, in their Clerk private metadata. */
export const FEED_NONCE_METADATA_KEY = "calendarFeedNonce";

let warnedAboutFallback = false;
let warnedAboutMissingSecret = false;

/**
 * The key feed URLs are signed with: CALENDAR_FEED_SECRET. Production
 * requires it and fails closed without it (feeds are turned off), so the
 * Clerk backend key is never reused there. Elsewhere (local dev, previews)
 * CLERK_SECRET_KEY stays as a convenience fallback, logged once per instance.
 */
function feedSecret(): string | null {
  const dedicated = process.env.CALENDAR_FEED_SECRET;
  if (dedicated) return dedicated;
  if (process.env.VERCEL_ENV === "production") {
    if (!warnedAboutMissingSecret) {
      warnedAboutMissingSecret = true;
      console.error(
        "Calendar feeds are off: CALENDAR_FEED_SECRET isn't set in production, and the Clerk secret is never used for them there.",
      );
    }
    return null;
  }
  const clerk = process.env.CLERK_SECRET_KEY;
  if (!clerk) return null;
  if (!warnedAboutFallback) {
    warnedAboutFallback = true;
    console.warn(
      "Calendar feeds are signed with CLERK_SECRET_KEY because CALENDAR_FEED_SECRET isn't set. This fallback only works outside production; set CALENDAR_FEED_SECRET.",
    );
  }
  return clerk;
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
 * A token for one member's feed in one org, or null without a secret. The
 * token only works while `nonce` is the member's current feed nonce.
 */
export function createFeedToken(
  orgId: string,
  userId: string,
  nonce: string,
): string | null {
  const secret = feedSecret();
  if (!secret) return null;
  const raw = `${TOKEN_V2}:${orgId}:${userId}:${nonce}`;
  const payload = Buffer.from(raw).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

/**
 * The org, member and nonce a feed token was made for, or null if it isn't
 * valid (legacy v1 tokens included). Callers must still check the nonce
 * against the member's current one with {@link feedNonceMatches}.
 */
export function verifyFeedToken(
  token: string,
): { orgId: string; userId: string; nonce: string } | null {
  const secret = feedSecret();
  if (!secret) return null;
  const [payload, signature, ...rest] = token.split(".");
  if (!payload || !signature || rest.length > 0) return null;
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return null;
  }
  const [version, orgId, userId, nonce, ...extra] = Buffer.from(
    payload,
    "base64url",
  )
    .toString()
    .split(":");
  if (version !== TOKEN_V2 || !orgId || !userId || !nonce) return null;
  if (extra.length > 0) return null;
  return { orgId, userId, nonce };
}

/**
 * Whether a token's nonce is the member's current one. A member without a
 * nonce has no valid feed URL.
 */
export const feedNonceMatches = (
  tokenNonce: string,
  currentNonce: string | null,
) => currentNonce !== null && tokenNonce === currentNonce;

/** The feed's path for a token; `.ics` helps apps recognise it. */
export const feedPath = (token: string) => `${CALENDAR_FEED_PATH}/${token}.ics`;
