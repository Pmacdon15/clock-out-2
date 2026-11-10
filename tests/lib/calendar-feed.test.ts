import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CALENDAR_FEED_PATH,
  createFeedToken,
  feedNonceFrom,
  feedNonceMatches,
  feedPath,
  newFeedNonce,
  verifyFeedToken,
} from "@/lib/calendar-feed";
import { calendarSubscribeLinks } from "@/lib/calendar-feed-links";

/** A token for any payload, signed the way the server signs them. */
const signRaw = (raw: string, secret = "test-secret") => {
  const payload = Buffer.from(raw).toString("base64url");
  const signature = createHmac("sha256", `clockout-calendar-feed:${secret}`)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
};

describe("calendar feed tokens", () => {
  beforeEach(() => {
    vi.stubEnv("CALENDAR_FEED_SECRET", "test-secret");
    vi.stubEnv("CLERK_SECRET_KEY", "");
    vi.stubEnv("VERCEL_ENV", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("round-trips the org, member and nonce", () => {
    const nonce = newFeedNonce();
    const token = createFeedToken("org_1", "user_1", nonce) as string;
    expect(token).toMatch(/^[\w-]+\.[\w-]+$/);
    expect(token).toBe(signRaw(`v2:org_1:user_1:${nonce}`));
    const feed = verifyFeedToken(token);
    expect(feed).toEqual({ orgId: "org_1", userId: "user_1", nonce });
    expect(feedPath(token)).toBe(`${CALENDAR_FEED_PATH}/${token}.ics`);
  });

  it("matches only the member's current nonce", () => {
    const nonce = newFeedNonce();
    expect(feedNonceMatches(nonce, nonce)).toBe(true);
    expect(feedNonceMatches(nonce, newFeedNonce())).toBe(false);
    // A member without a nonce has no valid feed URL.
    expect(feedNonceMatches(nonce, null)).toBe(false);
  });

  it("rejects legacy v1 tokens, even when validly signed", () => {
    expect(verifyFeedToken(signRaw("v1:org_1:user_1"))).toBeNull();
    expect(verifyFeedToken(signRaw("v3:org_1:user_1:nonce_1234"))).toBeNull();
  });

  it("reads only well-formed nonces from metadata", () => {
    expect(feedNonceFrom({ calendarFeedNonce: "abcdefgh12" })).toBe(
      "abcdefgh12",
    );
    expect(feedNonceFrom({ calendarFeedNonce: "short" })).toBeNull();
    expect(feedNonceFrom({ calendarFeedNonce: "bad:nonce1" })).toBeNull();
    expect(feedNonceFrom({ calendarFeedNonce: 5 })).toBeNull();
    expect(feedNonceFrom(undefined)).toBeNull();
  });

  it("rejects tampered, malformed or foreign tokens", () => {
    const token = createFeedToken("org_1", "user_1", "nonce_1234") as string;
    const [, signature] = token.split(".");
    const forged = `${Buffer.from("v2:org_1:user_2:nonce_1234").toString("base64url")}.${signature}`;
    expect(verifyFeedToken(forged)).toBeNull();
    expect(verifyFeedToken(`${token}x`)).toBeNull();
    expect(verifyFeedToken("nodot")).toBeNull();
    expect(verifyFeedToken(`${token}.extra`)).toBeNull();

    vi.stubEnv("CALENDAR_FEED_SECRET", "other-secret");
    expect(verifyFeedToken(token)).toBeNull();
  });

  it("rejects a validly signed payload of the wrong shape", () => {
    expect(
      verifyFeedToken(signRaw("v2:org_1:user_1:nonce_1234:more")),
    ).toBeNull();
    expect(verifyFeedToken(signRaw("v2:org_1::nonce_1234"))).toBeNull();
    expect(verifyFeedToken(signRaw("v2::user_1:nonce_1234"))).toBeNull();
    expect(verifyFeedToken(signRaw("v2:org_1:user_1:"))).toBeNull();
    expect(verifyFeedToken(signRaw("v2:org_1:user_1"))).toBeNull();
  });

  it("requires CALENDAR_FEED_SECRET in production and never uses the Clerk key there", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const token = createFeedToken("org_1", "user_1", "nonce_1234") as string;
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("CALENDAR_FEED_SECRET", "");
    vi.stubEnv("CLERK_SECRET_KEY", "sk_live");
    expect(createFeedToken("org_1", "user_1", "nonce_1234")).toBeNull();
    expect(verifyFeedToken(token)).toBeNull();
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]?.[0]).toContain("CALENDAR_FEED_SECRET");
    error.mockRestore();

    // With the dedicated secret set, production signs as usual.
    vi.stubEnv("CALENDAR_FEED_SECRET", "test-secret");
    expect(verifyFeedToken(token)).not.toBeNull();
  });

  it("falls back to the Clerk secret outside production, warning once, and needs one of them", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("CALENDAR_FEED_SECRET", "");
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test");
    const token = createFeedToken("org_1", "user_1", "nonce_1234") as string;
    expect(verifyFeedToken(token)).not.toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("CALENDAR_FEED_SECRET");
    warn.mockRestore();

    vi.stubEnv("CLERK_SECRET_KEY", "");
    expect(createFeedToken("org_1", "user_1", "nonce_1234")).toBeNull();
    expect(verifyFeedToken(token)).toBeNull();
  });
});

describe("calendarSubscribeLinks", () => {
  it("builds one-click subscribe links", () => {
    const links = calendarSubscribeLinks(
      "https://clockout.app/api/calendar/tok.ics",
    );
    expect(links.apple).toBe("webcal://clockout.app/api/calendar/tok.ics");
    const outlook = new URL(links.outlook);
    expect(outlook.origin).toBe("https://outlook.live.com");
    expect(outlook.searchParams.get("url")).toBe(
      "https://clockout.app/api/calendar/tok.ics",
    );
    expect(outlook.searchParams.get("name")).toBe("Clock Out shifts");
  });
});
