import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  protect: vi.fn(),
  getUserOauthAccessToken: vi.fn(),
  getUser: vi.fn(),
  getOrganization: vi.fn(async () => ({ name: "Acme" })),
  dbGetScheduledShiftById: vi.fn(),
  write: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: { protect: mocks.protect },
  clerkClient: vi.fn(async () => ({
    users: {
      getUserOauthAccessToken: mocks.getUserOauthAccessToken,
      getUser: mocks.getUser,
    },
    organizations: { getOrganization: mocks.getOrganization },
  })),
}));
vi.mock("@/lib/db", () => ({
  dbGetScheduledShiftById: mocks.dbGetScheduledShiftById,
}));
vi.mock("@/lib/google-calendar", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/google-calendar")>()),
  googleShiftEventId: (s: { id: number }) => `id${s.id}`,
  writeGoogleCalendarEvent: mocks.write,
}));

import { addShiftsToGoogleCalendarAction } from "@/lib/google-calendar-actions";
import { GOOGLE_CALENDAR_SCOPE } from "@/lib/google-calendar-scope";
import { SCHEDULING_UPGRADE_REASON } from "@/lib/plan-features";

const shift = (id: number, user_id = "user_1") => ({
  id,
  org_id: "org_1",
  user_id,
  shift_start: new Date("2026-01-05T09:00:00Z"),
  shift_end: new Date("2026-01-05T17:00:00Z"),
  note: null,
  created_by: "admin",
});

function session({
  role = "org:member",
  scheduling = true,
  userId = "user_1" as string | null,
} = {}) {
  mocks.protect.mockResolvedValue({
    userId,
    orgId: "org_1",
    orgRole: role,
    has: () => scheduling,
  });
}

const calendarToken = {
  data: [
    { token: "basic", scopes: ["openid"] },
    { token: "cal", scopes: ["openid", GOOGLE_CALENDAR_SCOPE] },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  session();
  mocks.dbGetScheduledShiftById.mockImplementation(async (id: number) =>
    id === 404 ? undefined : shift(id, id >= 100 ? "user_2" : "user_1"),
  );
  mocks.getUserOauthAccessToken.mockResolvedValue(calendarToken);
  mocks.write.mockResolvedValue({ ok: true, outcome: "added" });
});

describe("addShiftsToGoogleCalendarAction", () => {
  it("rejects a signed-out request", async () => {
    session({ userId: null });
    expect(await addShiftsToGoogleCalendarAction([1])).toEqual({
      status: "error",
      error: "Unauthorized",
    });
  });

  it("needs Scheduling", async () => {
    session({ scheduling: false });
    expect(await addShiftsToGoogleCalendarAction([1])).toEqual({
      status: "error",
      error: SCHEDULING_UPGRADE_REASON,
    });
  });

  it.each([[[]], [[1.5]], [Array.from({ length: 61 }, (_, i) => i + 1)]])(
    "rejects a bad list of shifts",
    async (ids) => {
      expect(await addShiftsToGoogleCalendarAction(ids)).toEqual({
        status: "error",
        error: "Pick between 1 and 60 shifts",
      });
    },
  );

  it("only lets members add their own shifts", async () => {
    expect(await addShiftsToGoogleCalendarAction([100, 404])).toEqual({
      status: "error",
      error: "Shift not found",
    });
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("asks to connect without a calendar token", async () => {
    mocks.getUserOauthAccessToken.mockResolvedValue({
      data: [{ token: "basic", scopes: ["openid"] }, { token: "none" }],
    });
    expect(await addShiftsToGoogleCalendarAction([1])).toEqual({
      status: "connect",
    });
  });

  it("asks to connect when Clerk has no Google account", async () => {
    mocks.getUserOauthAccessToken.mockRejectedValue(new Error("404"));
    expect(await addShiftsToGoogleCalendarAction([1])).toEqual({
      status: "connect",
    });
  });

  it("adds and updates the member's shifts, once each", async () => {
    mocks.write
      .mockResolvedValueOnce({ ok: true, outcome: "added" })
      .mockResolvedValueOnce({ ok: true, outcome: "updated" });
    expect(await addShiftsToGoogleCalendarAction([1, 2, 2])).toEqual({
      status: "ok",
      added: 1,
      updated: 1,
    });
    expect(mocks.write).toHaveBeenCalledTimes(2);
    const [token, event, id] = mocks.write.mock.calls[0];
    expect(token).toBe("cal");
    expect(event.title).toBe("Shift · Acme");
    expect(id).toBe("id1");
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("titles another member's shift with their name for admins", async () => {
    session({ role: "org:admin" });
    mocks.getUser.mockImplementation(async (id: string) =>
      id === "user_2" ? { firstName: "Alex", lastName: null } : null,
    );
    mocks.dbGetScheduledShiftById.mockImplementation(async (id: number) =>
      shift(id, id === 103 ? "user_3" : "user_2"),
    );
    await addShiftsToGoogleCalendarAction([101, 102, 103]);
    const titles = mocks.write.mock.calls.map(([, event]) => event.title);
    expect(titles).toEqual([
      "Alex: Shift · Acme",
      "Alex: Shift · Acme",
      "Shift · Acme",
    ]);
    expect(mocks.getUser).toHaveBeenCalledTimes(2);
  });

  it("handles a failed name lookup", async () => {
    session({ role: "org:admin" });
    mocks.getUser.mockRejectedValue(new Error("gone"));
    await addShiftsToGoogleCalendarAction([100]);
    expect(mocks.write.mock.calls[0][1].title).toBe("Shift · Acme");
  });

  it("asks to reconnect when Google rejects the token", async () => {
    mocks.write.mockResolvedValue({ ok: false, failure: "reconnect" });
    expect(await addShiftsToGoogleCalendarAction([1])).toEqual({
      status: "connect",
    });
  });

  it("explains a Calendar API that isn't turned on", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.write.mockResolvedValue({ ok: false, failure: "api_disabled" });
    const res = await addShiftsToGoogleCalendarAction([1]);
    expect(res).toMatchObject({ status: "error", failure: "api_disabled" });
  });

  it("reports a write that throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.write.mockRejectedValue(new Error("network"));
    expect(await addShiftsToGoogleCalendarAction([1])).toEqual({
      status: "error",
      error: "Google Calendar didn't accept the shift. Try again.",
      failure: "failed",
    });
  });

  it("falls back to Clock Out when the org name can't be read", async () => {
    session();
    mocks.dbGetScheduledShiftById.mockResolvedValue(shift(1));
    mocks.getUserOauthAccessToken.mockResolvedValue({
      data: [{ token: "tok", scopes: [GOOGLE_CALENDAR_SCOPE] }],
    });
    mocks.write.mockResolvedValue({ ok: true, outcome: "added" });
    mocks.getOrganization.mockRejectedValueOnce(new Error("clerk down"));
    await addShiftsToGoogleCalendarAction([1]);
    expect(mocks.write.mock.calls.at(-1)?.[1].title).toBe("Shift · Clock Out");
    expect(mocks.getOrganization).toHaveBeenCalledWith({
      organizationId: "org_1",
    });
  });
});
