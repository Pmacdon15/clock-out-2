import { startOfDay } from "date-fns";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  protect: vi.fn(),
  loadOrgMembers: vi.fn(),
  claimShiftRequest: vi.fn(),
  createShiftRequest: vi.fn(),
  dbGetScheduledShifts: vi.fn(),
  cancelShiftRequest: vi.fn(),
  reviewShiftRequest: vi.fn(),
  dbGetShiftRequest: vi.fn(),
  dbListShiftRequests: vi.fn(),
}));

vi.mock("next/server", () => ({ connection: () => Promise.resolve() }));
vi.mock("@clerk/nextjs/server", () => ({ auth: { protect: m.protect } }));
vi.mock("@/lib/alerts-runner", () => ({ loadOrgMembers: m.loadOrgMembers }));
vi.mock("@/lib/db", () => ({ dbGetScheduledShifts: m.dbGetScheduledShifts }));
vi.mock("@/lib/shift-requests", () => ({
  claimShiftRequest: m.claimShiftRequest,
  createShiftRequest: m.createShiftRequest,
  cancelShiftRequest: m.cancelShiftRequest,
  reviewShiftRequest: m.reviewShiftRequest,
}));
vi.mock("@/lib/shift-requests-db", () => ({
  ACTIVE_SHIFT_REQUEST_STATUSES: ["open", "pending_approval"],
  dbGetShiftRequest: m.dbGetShiftRequest,
  dbListShiftRequests: m.dbListShiftRequests,
}));

import {
  approveShiftRequestDal,
  cancelShiftRequestDal,
  claimShiftRequestDal,
  createShiftRequestDal,
  denyShiftRequestDal,
  getShiftRequestsView,
  TRADEABLE_SHIFT_DAYS,
} from "@/lib/shift-requests-dal";

function signIn(
  over: Partial<{
    userId: string | null;
    orgId: string | null;
    orgRole: string;
    scheduling: boolean;
  }> = {},
) {
  const { scheduling = true, ...rest } = over;
  m.protect.mockResolvedValue({
    userId: "amy",
    orgId: "o1",
    orgRole: "org:member",
    has: () => scheduling,
    ...rest,
  });
}

const amy = { userId: "amy", orgId: "o1", isAdmin: false };

beforeEach(() => {
  signIn();
  m.dbGetScheduledShifts.mockResolvedValue([]);
  m.dbGetShiftRequest.mockResolvedValue({ id: 7, shift_start: "s" });
});

describe("getShiftRequestsView", () => {
  it("lists live requests with everyone's names", async () => {
    m.dbListShiftRequests.mockResolvedValueOnce([{ id: 7 }]);
    m.loadOrgMembers.mockResolvedValueOnce([{ userId: "ben", name: "Ben" }]);
    signIn({ orgRole: "org:admin" });
    await expect(getShiftRequestsView()).resolves.toEqual({
      ok: true,
      value: {
        requests: [{ id: 7 }],
        shifts: [],
        names: { ben: "Ben" },
        userId: "amy",
        isAdmin: true,
      },
    });
    expect(m.dbListShiftRequests).toHaveBeenCalledWith(
      "o1",
      ["open", "pending_approval"],
      expect.any(Date),
    );
  });

  it("offers upcoming shifts with no live request, without their notes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-08T12:00:00Z"));
    const shift = (
      id: number,
      user_id: string,
      start = "2026-11-10T09:00:00Z",
    ) => ({
      id,
      org_id: "o1",
      user_id,
      shift_start: new Date(start),
      shift_end: new Date("2026-11-10T17:00:00Z"),
      note: "secret",
      created_by: "boss",
    });
    m.dbListShiftRequests.mockResolvedValueOnce([
      { id: 7, shift_id: 1, swap_shift_id: 2 },
      { id: 8, shift_id: 5, swap_shift_id: null },
    ]);
    m.loadOrgMembers.mockResolvedValueOnce([]);
    m.dbGetScheduledShifts.mockResolvedValueOnce([
      shift(1, "amy"),
      shift(2, "ben"),
      shift(3, "amy"),
      shift(4, "ben"),
      shift(5, "ben"),
      // Earlier today, so already started: not offered.
      shift(6, "amy", "2026-11-08T08:00:00Z"),
    ]);
    const result = await getShiftRequestsView();
    expect(result.ok && result.value.shifts).toEqual([
      {
        id: 3,
        user_id: "amy",
        shift_start: new Date("2026-11-10T09:00:00Z"),
        shift_end: new Date("2026-11-10T17:00:00Z"),
      },
      {
        id: 4,
        user_id: "ben",
        shift_start: new Date("2026-11-10T09:00:00Z"),
        shift_end: new Date("2026-11-10T17:00:00Z"),
      },
    ]);
    const [org, user, start, end] = m.dbGetScheduledShifts.mock.calls[0];
    expect([org, user]).toEqual(["o1", null]);
    // Whole days, so the cached query's key doesn't change every request.
    expect(start).toEqual(startOfDay(new Date("2026-11-08T12:00:00Z")));
    expect((end as Date).getTime() - (start as Date).getTime()).toBe(
      (TRADEABLE_SHIFT_DAYS + 1) * 24 * 60 * 60 * 1000,
    );
    vi.useRealTimers();
  });

  it("needs a signed-in member of an org on a plan with Scheduling", async () => {
    signIn({ orgId: null });
    expect(await getShiftRequestsView()).toEqual({
      ok: false,
      error: { reason: "Unauthorized" },
    });
    signIn({ scheduling: false });
    expect(await getShiftRequestsView()).toMatchObject({
      ok: false,
      error: { reason: expect.stringMatching(/paid plans/) },
    });
  });

  it("reports a failed read", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    m.dbListShiftRequests.mockRejectedValueOnce(new Error("db"));
    m.loadOrgMembers.mockResolvedValueOnce([]);
    expect(await getShiftRequestsView()).toEqual({
      ok: false,
      error: { reason: "Error fetching shift requests" },
    });
    error.mockRestore();
  });
});

describe("changes", () => {
  it("creates a request as the signed-in member", async () => {
    const input = { type: "offer" as const, shiftId: 3 };
    m.createShiftRequest.mockResolvedValueOnce({ ok: true, value: { id: 7 } });
    await expect(createShiftRequestDal(input)).resolves.toEqual({
      ok: true,
      value: { id: 7 },
      detail: { id: 7, shift_start: "s" },
      actorId: "amy",
    });
    expect(m.createShiftRequest).toHaveBeenCalledWith(amy, input);

    m.createShiftRequest.mockResolvedValueOnce({
      ok: false,
      status: "own_shift",
      reason: "That's already your shift.",
    });
    await expect(createShiftRequestDal(input)).resolves.toEqual({
      ok: false,
      reason: "That's already your shift.",
    });
  });

  it("claims and cancels as the signed-in member", async () => {
    m.claimShiftRequest.mockResolvedValueOnce({ ok: true, value: { id: 7 } });
    await expect(claimShiftRequestDal(7)).resolves.toEqual({
      ok: true,
      value: { id: 7 },
      detail: { id: 7, shift_start: "s" },
      actorId: "amy",
    });
    expect(m.claimShiftRequest).toHaveBeenCalledWith(amy, 7);
    expect(m.dbGetShiftRequest).toHaveBeenCalledWith(7, "o1");

    m.cancelShiftRequest.mockResolvedValueOnce({
      ok: false,
      status: "forbidden",
      reason: "No",
    });
    await expect(cancelShiftRequestDal(7)).resolves.toEqual({
      ok: false,
      reason: "No",
    });
  });

  it("approves and denies", async () => {
    signIn({ orgRole: "org:admin" });
    const value = { request: { id: 7 }, shifts: [], previous: [] };
    m.reviewShiftRequest.mockResolvedValueOnce({
      ok: true,
      decision: "approved",
      value,
    });
    await expect(approveShiftRequestDal(7)).resolves.toMatchObject({
      ok: true,
      value,
    });
    expect(m.reviewShiftRequest).toHaveBeenCalledWith(
      { ...amy, isAdmin: true },
      7,
      "approved",
    );
    m.reviewShiftRequest.mockResolvedValueOnce({
      ok: true,
      decision: "denied",
      value: { id: 7 },
    });
    await expect(denyShiftRequestDal(7)).resolves.toMatchObject({
      ok: true,
      value: { id: 7 },
    });
    for (const dal of [approveShiftRequestDal, denyShiftRequestDal]) {
      m.reviewShiftRequest.mockResolvedValueOnce({
        ok: false,
        status: "forbidden",
        reason: "Admins only",
      });
      await expect(dal(7)).resolves.toEqual({
        ok: false,
        reason: "Admins only",
      });
    }
  });

  it("refuses without access and reports errors", async () => {
    signIn({ scheduling: false });
    expect(await claimShiftRequestDal(7)).toMatchObject({ ok: false });
    expect(m.claimShiftRequest).not.toHaveBeenCalled();

    signIn();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    m.claimShiftRequest.mockRejectedValueOnce(new Error("db"));
    expect(await claimShiftRequestDal(7)).toEqual({
      ok: false,
      reason: "Failed to claim the shift",
    });
    error.mockRestore();
  });
});
