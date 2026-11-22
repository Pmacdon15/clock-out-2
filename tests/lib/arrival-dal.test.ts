// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  protect: vi.fn(),
  checkRateLimit: vi.fn(),
  dbClaimAlert: vi.fn(),
  dbCheckActiveEntry: vi.fn(),
  dbGetLocationSettings: vi.fn(),
  dbGetSites: vi.fn(),
  dbGetSitesForEnforcement: vi.fn(),
  deliver: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: { protect: mocks.protect } }));
vi.mock("@/lib/rate-limit", () => ({
  ARRIVAL_REPORT_LIMIT: { name: "arrival" },
  checkRateLimit: mocks.checkRateLimit,
  rateLimitedMessage: (s: number) => `Too many requests (${s}s).`,
}));
vi.mock("@/lib/alerts-db", () => ({ dbClaimAlert: mocks.dbClaimAlert }));
vi.mock("@/lib/db", () => ({
  dbCheckActiveEntry: mocks.dbCheckActiveEntry,
  dbGetLocationSettings: mocks.dbGetLocationSettings,
  dbGetSites: mocks.dbGetSites,
  dbGetSitesForEnforcement: mocks.dbGetSitesForEnforcement,
}));
vi.mock("@/lib/notify", () => ({ deliver: mocks.deliver }));

import { arrivalAlertKey } from "@/lib/arrival";
import { getArrivalWatchConfig, reportSiteArrivalDal } from "@/lib/arrival-dal";

const site = {
  id: 3,
  org_id: "org_1",
  name: "Site A",
  latitude: 45,
  longitude: -75,
  radius_meters: 150,
  address: "1 Main St",
};
const atSite = { latitude: 45, longitude: -75, accuracy: 15 };
const farAway = { latitude: 46, longitude: -75, accuracy: 15 };
const now = new Date("2026-11-22T13:00:00Z");

const session = (features: string[], extra: object = {}) => ({
  userId: "user_1",
  orgId: "org_1",
  has: vi.fn(({ feature }: { feature: string }) => features.includes(feature)),
  ...extra,
});

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.protect.mockResolvedValue(session(["geofencing", "notifications"]));
  mocks.checkRateLimit.mockResolvedValue({ ok: true, remaining: 1 });
  mocks.dbGetLocationSettings.mockResolvedValue({ arrival_prompts: true });
  mocks.dbGetSites.mockResolvedValue([site]);
  mocks.dbGetSitesForEnforcement.mockResolvedValue([site]);
  mocks.dbCheckActiveEntry.mockResolvedValue([]);
  mocks.dbClaimAlert.mockResolvedValue(true);
  mocks.deliver.mockResolvedValue({ email: 0, push: 2 });
});

describe("getArrivalWatchConfig", () => {
  it("hands the device the org's sites when prompts are on", async () => {
    await expect(getArrivalWatchConfig()).resolves.toEqual({
      ok: true,
      value: {
        enabled: true,
        sites: [
          {
            id: 3,
            name: "Site A",
            latitude: 45,
            longitude: -75,
            radius_meters: 150,
          },
        ],
      },
    });
    expect(mocks.dbGetLocationSettings).toHaveBeenCalledWith("org_1");
    expect(mocks.dbGetSites).toHaveBeenCalledWith("org_1");
  });

  const off = { ok: true, value: { enabled: false, sites: [] } };

  it.each([
    ["no user", session(["geofencing"], { userId: null })],
    ["no org", session(["geofencing"], { orgId: null })],
    ["no geofencing feature", session([])],
  ])("is off with %s", async (_label, s) => {
    mocks.protect.mockResolvedValue(s);
    await expect(getArrivalWatchConfig()).resolves.toEqual(off);
    expect(mocks.dbGetLocationSettings).not.toHaveBeenCalled();
  });

  it("is off when the org hasn't switched prompts on", async () => {
    mocks.dbGetLocationSettings.mockResolvedValue(undefined);
    await expect(getArrivalWatchConfig()).resolves.toEqual(off);
    expect(mocks.dbGetSites).not.toHaveBeenCalled();
  });

  it("is off when there are no sites", async () => {
    mocks.dbGetSites.mockResolvedValue([]);
    await expect(getArrivalWatchConfig()).resolves.toEqual(off);
  });

  it("reports a failed read", async () => {
    mocks.dbGetSites.mockRejectedValue(new Error("db"));
    await expect(getArrivalWatchConfig()).resolves.toEqual({
      ok: false,
      error: { reason: "Error loading arrival prompts." },
    });
  });
});

describe("reportSiteArrivalDal", () => {
  it("pushes the prompt once for a member who isn't clocked in", async () => {
    const result = await reportSiteArrivalDal(atSite, now);
    expect(result._unsafeUnwrap()).toEqual({
      status: "prompted",
      siteName: "Site A",
      pushed: 2,
    });
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(
      { name: "arrival" },
      "user_1",
    );
    expect(mocks.dbCheckActiveEntry).toHaveBeenCalledWith("user_1", "org_1");
    expect(mocks.dbClaimAlert).toHaveBeenCalledWith(
      arrivalAlertKey({ userId: "user_1", orgId: "org_1", siteId: 3, now }),
      "org_1",
    );
    expect(mocks.deliver).toHaveBeenCalledWith([
      {
        recipient: { userId: "user_1", email: null },
        category: "shift_alerts",
        message: {
          title: "Clock in?",
          body: "You've arrived at Site A. Clock in?",
          url: "/?orgId=org_1",
          tag: "arrival:org_1",
        },
      },
    ]);
  });

  it("defaults to the current time", async () => {
    vi.useFakeTimers({ now });
    try {
      await reportSiteArrivalDal(atSite);
    } finally {
      vi.useRealTimers();
    }
    expect(mocks.dbClaimAlert).toHaveBeenCalledWith(
      arrivalAlertKey({ userId: "user_1", orgId: "org_1", siteId: 3, now }),
      "org_1",
    );
  });

  it("skips the push without the notifications feature", async () => {
    mocks.protect.mockResolvedValue(session(["geofencing"]));
    expect((await reportSiteArrivalDal(atSite, now))._unsafeUnwrap()).toEqual({
      status: "prompted",
      siteName: "Site A",
      pushed: 0,
    });
    expect(mocks.deliver).not.toHaveBeenCalled();
  });

  it.each([
    ["no user", session(["geofencing"], { userId: null })],
    ["no org", session(["geofencing"], { orgId: null })],
  ])("refuses %s", async (_label, s) => {
    mocks.protect.mockResolvedValue(s);
    expect(
      (await reportSiteArrivalDal(atSite, now))._unsafeUnwrapErr(),
    ).toEqual({ reason: "Unauthorized or no organization selected" });
  });

  it("does nothing without the geofencing feature", async () => {
    mocks.protect.mockResolvedValue(session([]));
    expect((await reportSiteArrivalDal(atSite, now))._unsafeUnwrap()).toEqual({
      status: "skipped",
      why: "off",
    });
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
  });

  it("ignores a vague or missing fix", async () => {
    expect(
      (
        await reportSiteArrivalDal({ ...atSite, accuracy: 2_000 }, now)
      )._unsafeUnwrap(),
    ).toEqual({ status: "skipped", why: "imprecise" });
    expect((await reportSiteArrivalDal(null, now))._unsafeUnwrap()).toEqual({
      status: "skipped",
      why: "imprecise",
    });
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
  });

  it("is rate limited", async () => {
    mocks.checkRateLimit.mockResolvedValue({ ok: false, retryAfterSeconds: 5 });
    expect(
      (await reportSiteArrivalDal(atSite, now))._unsafeUnwrapErr(),
    ).toEqual({ reason: "Too many requests (5s)." });
    expect(mocks.dbGetLocationSettings).not.toHaveBeenCalled();
  });

  it("does nothing when the org has prompts off", async () => {
    mocks.dbGetLocationSettings.mockResolvedValue({ arrival_prompts: false });
    expect((await reportSiteArrivalDal(atSite, now))._unsafeUnwrap()).toEqual({
      status: "skipped",
      why: "off",
    });
    expect(mocks.dbGetSitesForEnforcement).not.toHaveBeenCalled();
  });

  it("re-checks the point against the sites server-side", async () => {
    expect((await reportSiteArrivalDal(farAway, now))._unsafeUnwrap()).toEqual({
      status: "skipped",
      why: "not_at_site",
    });
    expect(mocks.dbClaimAlert).not.toHaveBeenCalled();
  });

  it("doesn't ask someone already on the clock", async () => {
    mocks.dbCheckActiveEntry.mockResolvedValue([{ id: 9 }]);
    expect((await reportSiteArrivalDal(atSite, now))._unsafeUnwrap()).toEqual({
      status: "skipped",
      why: "clocked_in",
    });
    expect(mocks.dbClaimAlert).not.toHaveBeenCalled();
  });

  it("asks once per site per cooldown window", async () => {
    mocks.dbClaimAlert.mockResolvedValue(false);
    expect((await reportSiteArrivalDal(atSite, now))._unsafeUnwrap()).toEqual({
      status: "skipped",
      why: "already_prompted",
    });
    expect(mocks.deliver).not.toHaveBeenCalled();
  });

  it("reports a failure", async () => {
    mocks.deliver.mockRejectedValue(new Error("push down"));
    expect(
      (await reportSiteArrivalDal(atSite, now))._unsafeUnwrapErr(),
    ).toEqual({ reason: "Error handling site arrival." });
  });
});
