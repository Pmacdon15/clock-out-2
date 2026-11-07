import { afterEach, describe, expect, it, vi } from "vitest";
import {
  googleShiftEventId,
  writeGoogleCalendarEvent,
} from "@/lib/google-calendar";

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
