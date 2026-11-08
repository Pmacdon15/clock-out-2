import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getToken: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: vi.fn(async () => ({
    users: { getUserOauthAccessToken: mocks.getToken },
  })),
}));

import {
  GOOGLE_CALENDAR_SCOPE,
  GoogleCalendarError,
  getGoogleCalendarAccess,
  googleEventBody,
  googleEventId,
  mirrorShiftChange,
  syncShiftsToGoogleCalendar,
  upsertShiftEvent,
} from "@/lib/google-calendar";
import type { ScheduledShift } from "@/lib/types";

const shift: ScheduledShift = {
  id: 7,
  org_id: "org_1",
  user_id: "user_1",
  shift_start: new Date("2026-01-05T09:00:00Z"),
  shift_end: new Date("2026-01-05T17:00:00Z"),
  note: null,
  created_by: "admin_1",
};

type Call = { method: string; url: string; body?: Record<string, unknown> };
let calls: Call[];
let respond: (call: Call) => Response;

beforeEach(() => {
  calls = [];
  respond = () => new Response("{}", { status: 200 });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const call = {
        method: init.method as string,
        url,
        body: init.body ? JSON.parse(init.body as string) : undefined,
      };
      calls.push(call);
      return respond(call);
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const token = (scopes: string[]) => ({ data: [{ token: "tok", scopes }] });

describe("getGoogleCalendarAccess", () => {
  it("returns the token when calendar access was allowed", async () => {
    mocks.getToken.mockResolvedValue(token(["email", GOOGLE_CALENDAR_SCOPE]));
    await expect(getGoogleCalendarAccess("user_1")).resolves.toEqual({
      status: "ok",
      token: "tok",
    });
    expect(mocks.getToken).toHaveBeenCalledWith("user_1", "google");
  });

  it("tells apart no Google account and no calendar permission", async () => {
    mocks.getToken.mockResolvedValue({ data: [] });
    expect((await getGoogleCalendarAccess("u")).status).toBe("not_connected");
    mocks.getToken.mockRejectedValue(new Error("no account"));
    expect((await getGoogleCalendarAccess("u")).status).toBe("not_connected");
    mocks.getToken.mockResolvedValue(token(["email"]));
    expect((await getGoogleCalendarAccess("u")).status).toBe("missing_scope");
  });
});

describe("events", () => {
  it("uses a Google-safe id that's stable per shift", () => {
    const id = googleEventId(shift);
    expect(id).toMatch(/^[a-v0-9]{5,1024}$/);
    expect(id).toBe(googleEventId({ ...shift }));
    expect(id).not.toBe(googleEventId({ ...shift, id: 8 }));
    expect(id).not.toBe(googleEventId({ ...shift, org_id: "org_2" }));
  });

  it("builds the event with the shift's times and our private tags", () => {
    expect(googleEventBody(shift)).toMatchObject({
      id: googleEventId(shift),
      summary: "Shift · Clock Out",
      start: { dateTime: "2026-01-05T09:00:00.000Z" },
      end: { dateTime: "2026-01-05T17:00:00.000Z" },
      extendedProperties: {
        private: { clockoutScope: "org_1:user_1", clockoutShift: "7" },
      },
    });
  });

  it("adds a new event, or updates one that already exists", async () => {
    await expect(upsertShiftEvent("tok", shift)).resolves.toBe("added");
    expect(calls[0].method).toBe("POST");

    respond = (call) =>
      new Response("", { status: call.method === "POST" ? 409 : 200 });
    await expect(upsertShiftEvent("tok", shift)).resolves.toBe("updated");
    expect(calls.at(-1)?.method).toBe("PUT");
    expect(calls.at(-1)?.url).toMatch(new RegExp(`/${googleEventId(shift)}$`));
  });

  it("reports Google errors and whether to reconnect", async () => {
    respond = () => new Response("nope", { status: 401 });
    const error = await upsertShiftEvent("tok", shift).catch((e) => e);
    expect(error).toBeInstanceOf(GoogleCalendarError);
    expect(error.needsReconnect).toBe(true);
    expect(new GoogleCalendarError(500, "x").needsReconnect).toBe(false);
  });
});

describe("syncShiftsToGoogleCalendar", () => {
  it("adds and updates shifts and removes cancelled ones", async () => {
    const kept = { ...shift, id: 8 };
    let page = 0;
    respond = (call) => {
      if (call.method === "GET") {
        page++;
        return Response.json(
          page === 1
            ? {
                items: [{ id: googleEventId(kept) }, { id: "clockoutgone" }],
                nextPageToken: "p2",
              }
            : {
                items: [{ id: "clockoutdeleted", status: "cancelled" }],
              },
        );
      }
      if (call.method === "POST" && call.body?.id === googleEventId(kept)) {
        return new Response("", { status: 409 });
      }
      return new Response("{}", { status: 200 });
    };
    const counts = await syncShiftsToGoogleCalendar(
      "tok",
      "org_1",
      "user_1",
      [shift, kept],
      new Date("2026-01-01T00:00:00Z"),
      new Date("2026-02-01T00:00:00Z"),
    );
    expect(counts).toEqual({ added: 1, updated: 1, removed: 1 });
    const list = new URL(calls[0].url);
    expect(list.searchParams.get("privateExtendedProperty")).toBe(
      "clockoutScope=org_1:user_1",
    );
    expect(new URL(calls[1].url).searchParams.get("pageToken")).toBe("p2");
    const deletes = calls.filter((c) => c.method === "DELETE");
    expect(deletes.map((c) => c.url.split("/").pop())).toEqual([
      "clockoutgone",
    ]);
  });
});

describe("mirrorShiftChange", () => {
  it("does nothing for members who haven't turned it on", async () => {
    mocks.getToken.mockResolvedValue({ data: [] });
    await mirrorShiftChange("added", shift);
    expect(calls).toHaveLength(0);
  });

  it("adds, updates or deletes the shift's event", async () => {
    mocks.getToken.mockResolvedValue(token([GOOGLE_CALENDAR_SCOPE]));
    await mirrorShiftChange("added", shift);
    await mirrorShiftChange("changed", shift);
    respond = () => new Response("", { status: 410 });
    await mirrorShiftChange("removed", shift);
    expect(calls.map((c) => c.method)).toEqual(["POST", "POST", "DELETE"]);
  });
});
