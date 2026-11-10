import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getMemberships: vi.fn(),
  getUser: vi.fn(),
  dbGetScheduledShifts: vi.fn(),
  orgHasPlanFeature: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: vi.fn(async () => ({
    organizations: { getOrganizationMembershipList: mocks.getMemberships },
    users: { getUser: mocks.getUser },
  })),
}));
vi.mock("@/lib/db", () => ({
  dbGetScheduledShifts: mocks.dbGetScheduledShifts,
}));
vi.mock("@/lib/plan-features", () => ({
  SCHEDULING_FEATURE: "scheduling",
  orgHasPlanFeature: mocks.orgHasPlanFeature,
}));

import { GET } from "@/app/api/calendar/[token]/route";
import { createFeedToken } from "@/lib/calendar-feed";

/** The member's current feed nonce in most tests. */
const NONCE = "nonce_current";

/** A legacy v1 token (org and member, no nonce), signed with the test secret. */
const legacyV1Token = () => {
  const payload = Buffer.from("v1:org_1:user_1").toString("base64url");
  const signature = createHmac("sha256", "clockout-calendar-feed:test-secret")
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
};

const call = (token: string) =>
  GET(new Request(`https://clockout.app/api/calendar/${token}`), {
    params: Promise.resolve({ token }),
  });

const membership = {
  publicUserData: { userId: "user_1" },
  organization: { name: "Acme" },
};

describe("GET /api/calendar/[token]", () => {
  beforeEach(() => {
    vi.stubEnv("CALENDAR_FEED_SECRET", "test-secret");
    mocks.getMemberships.mockResolvedValue({ data: [membership] });
    mocks.getUser.mockResolvedValue({
      privateMetadata: { calendarFeedNonce: NONCE },
    });
    mocks.orgHasPlanFeature.mockResolvedValue(true);
    mocks.dbGetScheduledShifts.mockResolvedValue([
      {
        id: 7,
        org_id: "org_1",
        user_id: "user_1",
        shift_start: new Date("2026-01-05T09:00:00Z"),
        shift_end: new Date("2026-01-05T17:00:00Z"),
        note: null,
        created_by: "admin_1",
      },
    ]);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("serves the member's shifts as an iCalendar feed", async () => {
    const token = createFeedToken("org_1", "user_1", NONCE) as string;
    const res = await call(`${token}.ics`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(
      "text/calendar; charset=utf-8",
    );
    const body = await res.text();
    expect(body).toContain("X-WR-CALNAME:Clock Out shifts · Acme");
    expect(body).toContain("SUMMARY:Shift · Acme");
    expect(body).toContain("UID:clockout-org_1-shift-7@clockout");
    expect(mocks.getMemberships).toHaveBeenCalledWith({
      organizationId: "org_1",
      userId: ["user_1"],
    });
    const [orgId, userId, start, end] = mocks.dbGetScheduledShifts.mock
      .calls[0] as [string, string, Date, Date];
    expect([orgId, userId]).toEqual(["org_1", "user_1"]);
    expect(end.getTime()).toBeGreaterThan(start.getTime());
  });

  it("keeps the URL out of search indexes and referrers", async () => {
    const token = createFeedToken("org_1", "user_1", NONCE) as string;
    const res = await call(`${token}.ics`);
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("serves a v2 link with the member's current nonce", async () => {
    mocks.getUser.mockResolvedValue({
      privateMetadata: { calendarFeedNonce: "nonce_current" },
    });
    const token = createFeedToken("org_1", "user_1", "nonce_current") as string;
    expect((await call(`${token}.ics`)).status).toBe(200);
  });

  it("rejects legacy v1 links, with or without a nonce on the member", async () => {
    expect((await call(`${legacyV1Token()}.ics`)).status).toBe(404);
    mocks.getUser.mockResolvedValue({ privateMetadata: {} });
    expect((await call(`${legacyV1Token()}.ics`)).status).toBe(404);
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.dbGetScheduledShifts).not.toHaveBeenCalled();
  });

  it("rejects every link for a member without a nonce", async () => {
    mocks.getUser.mockResolvedValue({ privateMetadata: {} });
    const token = createFeedToken("org_1", "user_1", NONCE) as string;
    expect((await call(`${token}.ics`)).status).toBe(404);
    expect(mocks.dbGetScheduledShifts).not.toHaveBeenCalled();
  });

  it("revokes links made before the member reset theirs", async () => {
    const old = createFeedToken("org_1", "user_1", "nonce_previous") as string;
    expect((await call(`${old}.ics`)).status).toBe(404);
    expect(mocks.dbGetScheduledShifts).not.toHaveBeenCalled();
  });

  it("fails closed when the member can't be looked up", async () => {
    mocks.getUser.mockRejectedValue(new Error("clerk down"));
    const token = createFeedToken("org_1", "user_1", NONCE) as string;
    expect((await call(`${token}.ics`)).status).toBe(404);
  });

  it("rejects a bad token", async () => {
    const res = await call("forged.token.ics");
    expect(res.status).toBe(404);
    expect(mocks.getMemberships).not.toHaveBeenCalled();
  });

  it("stops serving once the member leaves the org", async () => {
    mocks.getMemberships.mockResolvedValue({ data: [] });
    const token = createFeedToken("org_1", "user_1", NONCE) as string;
    expect((await call(token)).status).toBe(404);

    mocks.getMemberships.mockRejectedValue(new Error("clerk down"));
    expect((await call(token)).status).toBe(404);
    expect(mocks.dbGetScheduledShifts).not.toHaveBeenCalled();
  });

  it("serves an empty calendar when the plan loses scheduling", async () => {
    mocks.orgHasPlanFeature.mockResolvedValue(false);
    mocks.getMemberships.mockResolvedValue({
      data: [{ publicUserData: { userId: "user_1" } }],
    });
    const token = createFeedToken("org_1", "user_1", NONCE) as string;
    const res = await call(token);
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(body).toContain("X-WR-CALNAME:Clock Out shifts\r\n");
    expect(body).not.toContain("BEGIN:VEVENT");
    expect(mocks.dbGetScheduledShifts).not.toHaveBeenCalled();
  });
});
