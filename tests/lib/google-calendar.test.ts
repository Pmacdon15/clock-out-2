import { afterEach, describe, expect, it, vi } from "vitest";

const clerk = vi.hoisted(() => ({
  getToken: vi.fn(),
  getOrganization: vi.fn(async () => ({ name: "Acme" })),
}));
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: vi.fn(async () => ({
    users: { getUserOauthAccessToken: clerk.getToken },
    organizations: { getOrganization: clerk.getOrganization },
  })),
}));

import {
  deleteGoogleCalendarEvent,
  googleCalendarToken,
  googleShiftEventId,
  mirrorShiftToGoogleCalendar,
  writeGoogleCalendarEvent,
} from "@/lib/google-calendar";
import { GOOGLE_CALENDAR_SCOPE } from "@/lib/google-calendar-scope";

const event = {
  uid: "u",
  title: "Shift · Clock Out",
  description: "Scheduled in Clock Out.",
  start: new Date("2026-01-05T09:00:00Z"),
  end: new Date("2026-01-05T17:00:00Z"),
};

const res = (status: number, body = "") => new Response(body, { status });

afterEach(() => vi.unstubAllGlobals());

function stubFetch(...responses: Response[]) {
  const fetch = vi.fn();
  for (const r of responses) fetch.mockResolvedValueOnce(r);
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("googleShiftEventId", () => {
  it("is stable, distinct and only uses Google's allowed characters", () => {
    const a = googleShiftEventId({ id: 1, org_id: "org_1" });
    expect(a).toBe(googleShiftEventId({ id: 1, org_id: "org_1" }));
    expect(a).not.toBe(googleShiftEventId({ id: 2, org_id: "org_1" }));
    expect(a).toMatch(/^[a-v0-9]{5,1024}$/);
  });
});

describe("writeGoogleCalendarEvent", () => {
  it("creates the event on the primary calendar", async () => {
    const fetch = stubFetch(res(200, "{}"));
    expect(await writeGoogleCalendarEvent("tok", event, "abc123")).toEqual({
      ok: true,
      outcome: "added",
    });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    );
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body)).toEqual({
      id: "abc123",
      summary: "Shift · Clock Out",
      description: "Scheduled in Clock Out.",
      start: { dateTime: "2026-01-05T09:00:00.000Z" },
      end: { dateTime: "2026-01-05T17:00:00.000Z" },
      status: "confirmed",
    });
  });

  it("updates the event when it already exists", async () => {
    const fetch = stubFetch(res(409), res(200, "{}"));
    expect(await writeGoogleCalendarEvent("tok", event, "abc123")).toEqual({
      ok: true,
      outcome: "updated",
    });
    expect(fetch.mock.calls[1][0]).toMatch(/\/events\/abc123$/);
    expect(fetch.mock.calls[1][1].method).toBe("PUT");
  });

  it("reports a failed update", async () => {
    stubFetch(res(409), res(500));
    expect(await writeGoogleCalendarEvent("tok", event, "x")).toEqual({
      ok: false,
      failure: "failed",
    });
  });

  it.each([
    [res(401), "reconnect"],
    [res(403, '{"reason":"insufficientPermissions"}'), "reconnect"],
    [res(403, '{"reason":"accessNotConfigured"}'), "api_disabled"],
    [res(403, "SERVICE_DISABLED"), "api_disabled"],
    [res(403, "rateLimitExceeded"), "failed"],
    [res(400), "failed"],
  ])("maps an error response to %#", async (response, failure) => {
    stubFetch(response);
    expect(await writeGoogleCalendarEvent("tok", event, "x")).toEqual({
      ok: false,
      failure,
    });
  });

  it("treats an unreadable 403 body as a plain failure", async () => {
    const broken = res(403);
    vi.spyOn(broken, "text").mockRejectedValue(new Error("boom"));
    stubFetch(broken);
    expect(await writeGoogleCalendarEvent("tok", event, "x")).toEqual({
      ok: false,
      failure: "failed",
    });
  });
});

const shift = {
  id: 7,
  org_id: "org_1",
  user_id: "user_1",
  shift_start: new Date("2026-01-05T09:00:00Z"),
  shift_end: new Date("2026-01-05T17:00:00Z"),
  note: null,
  created_by: "admin_1",
};
const withCalendar = {
  data: [{ token: "tok", scopes: ["email", GOOGLE_CALENDAR_SCOPE] }],
};

describe("googleCalendarToken", () => {
  it("only returns a token that allows calendar access", async () => {
    clerk.getToken.mockResolvedValueOnce(withCalendar);
    await expect(googleCalendarToken("user_1")).resolves.toBe("tok");
    expect(clerk.getToken).toHaveBeenCalledWith("user_1", "google");
    clerk.getToken.mockResolvedValueOnce({
      data: [{ token: "t", scopes: [] }],
    });
    await expect(googleCalendarToken("user_1")).resolves.toBeNull();
    clerk.getToken.mockRejectedValueOnce(new Error("no account"));
    await expect(googleCalendarToken("user_1")).resolves.toBeNull();
  });
});

describe("deleteGoogleCalendarEvent", () => {
  it("treats an event that's already gone as removed", async () => {
    const fetch = stubFetch(res(200), res(410), res(404), res(500));
    expect(await deleteGoogleCalendarEvent("tok", "abc")).toBe(true);
    expect(await deleteGoogleCalendarEvent("tok", "abc")).toBe(true);
    expect(await deleteGoogleCalendarEvent("tok", "abc")).toBe(true);
    expect(await deleteGoogleCalendarEvent("tok", "abc")).toBe(false);
    expect(fetch.mock.calls[0][0]).toBe(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events/abc",
    );
    expect(fetch.mock.calls[0][1].method).toBe("DELETE");
  });
});

describe("mirrorShiftToGoogleCalendar", () => {
  it("leaves members who never allowed calendar access alone", async () => {
    clerk.getToken.mockResolvedValueOnce({ data: [] });
    const fetch = stubFetch();
    await mirrorShiftToGoogleCalendar("added", shift);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("adds or updates the event for a new or moved shift", async () => {
    clerk.getToken.mockResolvedValue(withCalendar);
    const fetch = stubFetch(res(200, "{}"), res(409), res(200, "{}"));
    await mirrorShiftToGoogleCalendar("added", shift);
    await mirrorShiftToGoogleCalendar("changed", shift);
    expect(fetch.mock.calls.map((c) => c[1].method)).toEqual([
      "POST",
      "POST",
      "PUT",
    ]);
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.id).toBe(googleShiftEventId(shift));
    expect(body.summary).toBe("Shift · Acme");
  });

  it("removes the event for a cancelled shift", async () => {
    clerk.getToken.mockResolvedValue(withCalendar);
    const fetch = stubFetch(res(200));
    await mirrorShiftToGoogleCalendar("removed", shift);
    expect(fetch.mock.calls[0][0]).toMatch(
      new RegExp(`/events/${googleShiftEventId(shift)}$`),
    );
  });

  it("logs a write or delete Google refused", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    clerk.getToken.mockResolvedValue(withCalendar);
    stubFetch(res(500), res(500));
    await mirrorShiftToGoogleCalendar("added", shift);
    await mirrorShiftToGoogleCalendar("removed", shift);
    expect(error).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });
});
