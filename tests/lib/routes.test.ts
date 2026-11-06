import { describe, expect, it } from "vitest";
import {
  DASHBOARD_ROUTES,
  legacyTabRedirect,
  SIGNED_IN_ROUTES,
} from "@/lib/routes";

const redirect = (path: string) =>
  legacyTabRedirect(new URL(`https://clock.test${path}`))?.toString() ?? null;

describe("dashboard routes", () => {
  it("gives every old tab its own page", () => {
    expect(DASHBOARD_ROUTES).toEqual({
      "time-clock": "/",
      view: "/hours",
      notifications: "/notifications",
      schedule: "/schedule",
      "time-off": "/time-off",
      settings: "/settings",
    });
  });

  it("lists every page but the time clock as signed-in only", () => {
    expect(SIGNED_IN_ROUTES).toEqual([
      "/hours",
      "/notifications",
      "/schedule",
      "/time-off",
      "/settings",
    ]);
  });
});

describe("legacyTabRedirect", () => {
  it("sends old tab links to their page and keeps the other params", () => {
    expect(redirect("/?defaultTab=view&timeframe=week&userId=u1")).toBe(
      "https://clock.test/hours?timeframe=week&userId=u1",
    );
    expect(redirect("/?defaultTab=notifications")).toBe(
      "https://clock.test/notifications",
    );
    expect(redirect("/?defaultTab=time-clock&orgId=org_1")).toBe(
      "https://clock.test/?orgId=org_1",
    );
  });

  it("sends an unknown tab to the time clock", () => {
    expect(redirect("/?defaultTab=nope")).toBe("https://clock.test/");
  });

  it("leaves every other URL alone", () => {
    expect(redirect("/")).toBeNull();
    expect(redirect("/?timeframe=week")).toBeNull();
    expect(redirect("/hours?defaultTab=view")).toBeNull();
  });
});
