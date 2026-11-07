import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CALENDAR_FEED_PATH,
  createFeedToken,
  feedPath,
  verifyFeedToken,
} from "@/lib/calendar-feed";
import { calendarSubscribeLinks } from "@/lib/calendar-feed-links";

describe("calendar feed tokens", () => {
  beforeEach(() => {
    vi.stubEnv("CALENDAR_FEED_SECRET", "test-secret");
    vi.stubEnv("CLERK_SECRET_KEY", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("round-trips the org and member", () => {
    const token = createFeedToken("org_1", "user_1") as string;
    expect(token).toMatch(/^[\w-]+\.[\w-]+$/);
    expect(verifyFeedToken(token)).toEqual({
      orgId: "org_1",
      userId: "user_1",
    });
    expect(feedPath(token)).toBe(`${CALENDAR_FEED_PATH}/${token}.ics`);
  });

  it("rejects tampered, malformed or foreign tokens", () => {
    const token = createFeedToken("org_1", "user_1") as string;
    const [, signature] = token.split(".");
    const forged = `${Buffer.from("v1:org_1:user_2").toString("base64url")}.${signature}`;
    expect(verifyFeedToken(forged)).toBeNull();
    expect(verifyFeedToken(`${token}x`)).toBeNull();
    expect(verifyFeedToken("nodot")).toBeNull();
    expect(verifyFeedToken(`${token}.extra`)).toBeNull();

    vi.stubEnv("CALENDAR_FEED_SECRET", "other-secret");
    expect(verifyFeedToken(token)).toBeNull();
  });

  it("rejects a validly signed payload of the wrong shape", () => {
    // Sign odd payloads with the real secret by making tokens for odd ids.
    const extraPart = createFeedToken("org_1", "user_1:more") as string;
    expect(verifyFeedToken(extraPart)).toBeNull();
    const emptyUser = createFeedToken("org_1", "") as string;
    expect(verifyFeedToken(emptyUser)).toBeNull();
  });

  it("falls back to the Clerk secret, and needs one of them", () => {
    vi.stubEnv("CALENDAR_FEED_SECRET", "");
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test");
    const token = createFeedToken("org_1", "user_1") as string;
    expect(verifyFeedToken(token)).not.toBeNull();

    vi.stubEnv("CLERK_SECRET_KEY", "");
    expect(createFeedToken("org_1", "user_1")).toBeNull();
    expect(verifyFeedToken(token)).toBeNull();
  });
});

describe("calendarSubscribeLinks", () => {
  it("builds one-click subscribe links", () => {
    const links = calendarSubscribeLinks(
      "https://clockout.app/api/calendar/tok.ics",
    );
    expect(links.apple).toBe("webcal://clockout.app/api/calendar/tok.ics");
    expect(new URL(links.google).searchParams.get("cid")).toBe(
      "webcal://clockout.app/api/calendar/tok.ics",
    );
    const outlook = new URL(links.outlook);
    expect(outlook.origin).toBe("https://outlook.live.com");
    expect(outlook.searchParams.get("url")).toBe(
      "https://clockout.app/api/calendar/tok.ics",
    );
    expect(outlook.searchParams.get("name")).toBe("Clock Out shifts");
  });
});
