import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScheduledShift, ShiftRequest } from "@/lib/types";

const m = vi.hoisted(() => ({
  dbGetScheduledShiftById: vi.fn(),
  dbGetApprovedTimeOffForPeriod: vi.fn(async () => [] as unknown[]),
  dbApproveShiftRequest: vi.fn(),
  dbCancelShiftRequest: vi.fn(),
  dbClaimShiftRequest: vi.fn(),
  dbCreateShiftRequest: vi.fn(),
  dbDenyShiftRequest: vi.fn(),
  dbGetOverlappingScheduledShifts: vi.fn(async () => [] as unknown[]),
  dbGetShiftRequest: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  dbGetScheduledShiftById: m.dbGetScheduledShiftById,
  dbGetApprovedTimeOffForPeriod: m.dbGetApprovedTimeOffForPeriod,
}));
vi.mock("@/lib/shift-requests-db", () => ({
  dbApproveShiftRequest: m.dbApproveShiftRequest,
  dbCancelShiftRequest: m.dbCancelShiftRequest,
  dbClaimShiftRequest: m.dbClaimShiftRequest,
  dbCreateShiftRequest: m.dbCreateShiftRequest,
  dbDenyShiftRequest: m.dbDenyShiftRequest,
  dbGetOverlappingScheduledShifts: m.dbGetOverlappingScheduledShifts,
  dbGetShiftRequest: m.dbGetShiftRequest,
}));

import {
  canCancelShiftRequest,
  canClaimShiftRequest,
  cancelShiftRequest,
  claimShiftRequest,
  createShiftRequest,
  groupShiftRequestsFor,
  reviewShiftRequest,
  shiftConflict,
  shiftRequestParties,
} from "@/lib/shift-requests";

const NOW = new Date("2030-01-01T00:00:00Z");
const amy = { userId: "amy", orgId: "o1", isAdmin: false };
const ben = { userId: "ben", orgId: "o1", isAdmin: false };
const cat = { userId: "cat", orgId: "o1", isAdmin: false };
const mgr = { userId: "mgr", orgId: "o1", isAdmin: true };

const shift = (
  id: number,
  userId: string,
  start = "2030-01-05T09:00:00Z",
  end = "2030-01-05T17:00:00Z",
): ScheduledShift => ({
  id,
  org_id: "o1",
  user_id: userId,
  shift_start: new Date(start),
  shift_end: new Date(end),
  note: null,
  created_by: "mgr",
});

const SHIFTS: Record<number, ScheduledShift> = {
  1: shift(1, "amy"),
  2: shift(2, "ben", "2030-01-06T09:00:00Z", "2030-01-06T17:00:00Z"),
  5: shift(5, "amy", "2029-01-01T09:00:00Z", "2029-01-01T17:00:00Z"),
  6: shift(6, "ben", "2029-01-01T09:00:00Z", "2029-01-01T17:00:00Z"),
};

const request = (over: Partial<ShiftRequest> = {}): ShiftRequest => ({
  id: 7,
  org_id: "o1",
  request_type: "offer",
  shift_id: 1,
  swap_shift_id: null,
  requested_by: "amy",
  target_user_id: null,
  claimed_by: null,
  note: null,
  status: "open",
  claimed_at: null,
  reviewed_by: null,
  reviewed_at: null,
  review_note: null,
  cancelled_by: null,
  ...over,
});

beforeEach(() => {
  m.dbGetScheduledShiftById.mockImplementation(
    async (id: number) => SHIFTS[id],
  );
  m.dbGetOverlappingScheduledShifts.mockResolvedValue([]);
  m.dbGetApprovedTimeOffForPeriod.mockResolvedValue([]);
});

describe("pure helpers", () => {
  it("works out who gives and who takes", () => {
    expect(shiftRequestParties(request())).toEqual({
      giver: "amy",
      taker: null,
    });
    expect(
      shiftRequestParties(
        request({
          request_type: "pickup",
          requested_by: "ben",
          target_user_id: "amy",
          claimed_by: "ben",
        }),
      ),
    ).toEqual({ giver: "amy", taker: "ben" });
  });

  it("decides who can claim", () => {
    expect(canClaimShiftRequest(request(), "ben")).toBe(true);
    expect(canClaimShiftRequest(request(), "amy")).toBe(false);
    expect(
      canClaimShiftRequest(request({ target_user_id: "ben" }), "cat"),
    ).toBe(false);
    expect(
      canClaimShiftRequest(request({ target_user_id: "ben" }), "ben"),
    ).toBe(true);
    expect(canClaimShiftRequest(request({ status: "approved" }), "ben")).toBe(
      false,
    );
    const swap = request({ request_type: "swap", target_user_id: "ben" });
    expect(canClaimShiftRequest(swap, "ben")).toBe(true);
    expect(canClaimShiftRequest(swap, "cat")).toBe(false);
  });

  it("decides who can cancel", () => {
    expect(canCancelShiftRequest(request(), "amy", false)).toBe(true);
    expect(canCancelShiftRequest(request(), "ben", false)).toBe(false);
    expect(canCancelShiftRequest(request(), "mgr", true)).toBe(true);
    expect(
      canCancelShiftRequest(request({ status: "denied" }), "mgr", true),
    ).toBe(false);
    const swap = request({ request_type: "swap", target_user_id: "ben" });
    expect(canCancelShiftRequest(swap, "ben", false)).toBe(true);
    expect(
      canCancelShiftRequest(
        { ...swap, status: "pending_approval" },
        "ben",
        false,
      ),
    ).toBe(false);
    expect(
      canCancelShiftRequest(
        request({ status: "pending_approval" }),
        "amy",
        false,
      ),
    ).toBe(true);
  });

  it("groups requests for one member", () => {
    const offer = request({ id: 1 });
    const swap = request({
      id: 2,
      request_type: "swap",
      requested_by: "cat",
      target_user_id: "ben",
    });
    const mine = request({ id: 3, requested_by: "ben" });
    const claimed = request({
      id: 4,
      status: "pending_approval",
      claimed_by: "ben",
    });
    const other = request({
      id: 5,
      status: "pending_approval",
      claimed_by: "cat",
    });
    expect(
      groupShiftRequestsFor([offer, swap, mine, claimed, other], "ben"),
    ).toEqual({
      available: [offer],
      awaitingYou: [swap],
      yours: [mine, claimed],
    });
  });
});

describe("shiftConflict", () => {
  it("finds an overlapping shift, then time off", async () => {
    m.dbGetOverlappingScheduledShifts.mockResolvedValueOnce([SHIFTS[2]]);
    expect(await shiftConflict("o1", "ben", SHIFTS[1], [3])).toMatchObject({
      status: "schedule_conflict",
    });
    expect(m.dbGetOverlappingScheduledShifts).toHaveBeenCalledWith(
      "o1",
      "ben",
      SHIFTS[1].shift_start,
      SHIFTS[1].shift_end,
      [3],
    );
    m.dbGetApprovedTimeOffForPeriod.mockResolvedValueOnce([
      { start_date: "2030-01-05", end_date: "2030-01-05" },
    ]);
    expect(await shiftConflict("o1", "ben", SHIFTS[1], [])).toMatchObject({
      status: "time_off_conflict",
    });
    expect(m.dbGetApprovedTimeOffForPeriod).toHaveBeenLastCalledWith(
      "ben",
      "o1",
      "2030-01-05",
      "2030-01-05",
    );
    expect(await shiftConflict("o1", "ben", SHIFTS[1], [])).toBeNull();
  });
});

describe("createShiftRequest", () => {
  const create = (
    actor: typeof amy,
    input: Parameters<typeof createShiftRequest>[1],
  ) => createShiftRequest(actor, input, NOW);

  it("validates the input", async () => {
    expect(
      await create(amy, { type: "offer", shiftId: 1, note: "x".repeat(501) }),
    ).toMatchObject({ status: "invalid_input" });
    expect(await create(amy, { type: "swap", shiftId: 1 })).toMatchObject({
      status: "invalid_input",
      reason: expect.stringMatching(/coworker's shift/),
    });
    expect(
      await create(amy, { type: "offer", shiftId: 1, swapShiftId: 2 }),
    ).toMatchObject({ status: "invalid_input" });
    expect(
      await create(amy, { type: "pickup", shiftId: 2, targetUserId: "cat" }),
    ).toMatchObject({ status: "invalid_input" });
  });

  it("checks the shifts", async () => {
    expect(await create(amy, { type: "offer", shiftId: 99 })).toMatchObject({
      status: "not_found",
    });
    expect(await create(amy, { type: "offer", shiftId: 5 })).toMatchObject({
      status: "shift_started",
    });
    expect(await create(amy, { type: "pickup", shiftId: 1 })).toMatchObject({
      status: "own_shift",
    });
    expect(await create(amy, { type: "offer", shiftId: 2 })).toMatchObject({
      status: "forbidden",
    });
    expect(
      await create(amy, { type: "swap", shiftId: 1, swapShiftId: 99 }),
    ).toMatchObject({ status: "not_found" });
    expect(
      await create(amy, { type: "swap", shiftId: 1, swapShiftId: 5 }),
    ).toMatchObject({ status: "own_shift" });
    expect(
      await create(amy, { type: "swap", shiftId: 1, swapShiftId: 6 }),
    ).toMatchObject({ status: "shift_started" });
    expect(
      await create(amy, { type: "offer", shiftId: 1, targetUserId: "amy" }),
    ).toMatchObject({ status: "own_shift" });
  });

  it("posts an offer, optionally to one coworker", async () => {
    m.dbCreateShiftRequest.mockResolvedValueOnce(request());
    expect(
      await create(amy, {
        type: "offer",
        shiftId: 1,
        targetUserId: "ben",
        note: "  hi ",
      }),
    ).toEqual({ ok: true, value: request() });
    expect(m.dbCreateShiftRequest).toHaveBeenCalledWith({
      orgId: "o1",
      type: "offer",
      shiftId: 1,
      swapShiftId: null,
      requestedBy: "amy",
      targetUserId: "ben",
      claimedBy: null,
      note: "hi",
    });
    // Nobody is taking it yet, so there's nothing to check.
    expect(m.dbGetOverlappingScheduledShifts).not.toHaveBeenCalled();
  });

  it("asks for a pickup and checks the taker is free", async () => {
    m.dbCreateShiftRequest.mockResolvedValueOnce(request());
    await create(ben, { type: "pickup", shiftId: 1 });
    expect(m.dbCreateShiftRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedBy: "ben",
        targetUserId: "amy",
        claimedBy: "ben",
      }),
    );
    m.dbGetOverlappingScheduledShifts.mockResolvedValueOnce([SHIFTS[2]]);
    expect(await create(ben, { type: "pickup", shiftId: 1 })).toMatchObject({
      status: "schedule_conflict",
    });
  });

  it("asks for a swap and checks both directions", async () => {
    m.dbCreateShiftRequest.mockResolvedValueOnce(request());
    await create(amy, { type: "swap", shiftId: 1, swapShiftId: 2 });
    expect(m.dbCreateShiftRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        swapShiftId: 2,
        targetUserId: "ben",
        claimedBy: "ben",
      }),
    );
    expect(m.dbGetOverlappingScheduledShifts.mock.calls).toEqual([
      ["o1", "ben", SHIFTS[1].shift_start, SHIFTS[1].shift_end, [2]],
      ["o1", "amy", SHIFTS[2].shift_start, SHIFTS[2].shift_end, [1]],
    ]);
  });

  it("refuses a shift that is already in a live request", async () => {
    m.dbCreateShiftRequest.mockResolvedValueOnce(undefined);
    expect(await create(amy, { type: "offer", shiftId: 1 })).toMatchObject({
      status: "already_requested",
    });
  });

  it("defaults to the current time", async () => {
    m.dbCreateShiftRequest.mockResolvedValueOnce(request());
    // Shift 1 is in 2030: still ahead of the real clock.
    expect(
      await createShiftRequest(amy, { type: "offer", shiftId: 1 }),
    ).toEqual({ ok: true, value: request() });
  });
});

describe("claimShiftRequest", () => {
  const claim = (actor: typeof amy, id = 7) =>
    claimShiftRequest(actor, id, NOW);

  it("refuses missing, closed, own and someone else's requests", async () => {
    m.dbGetShiftRequest.mockResolvedValueOnce(undefined);
    expect(await claim(ben)).toMatchObject({ status: "not_found" });
    m.dbGetShiftRequest.mockResolvedValueOnce(request({ status: "approved" }));
    expect(await claim(ben)).toMatchObject({
      status: "not_open",
      reason: expect.stringMatching(/approved, not open/),
    });
    m.dbGetShiftRequest.mockResolvedValueOnce(request());
    expect(await claim(amy)).toMatchObject({ status: "own_shift" });
    m.dbGetShiftRequest.mockResolvedValueOnce(
      request({ target_user_id: "cat" }),
    );
    expect(await claim(ben)).toMatchObject({
      status: "forbidden",
      reason: expect.stringMatching(/offered to someone else/),
    });
    m.dbGetShiftRequest.mockResolvedValueOnce(
      request({
        request_type: "swap",
        swap_shift_id: 2,
        target_user_id: "ben",
      }),
    );
    expect(await claim(cat)).toMatchObject({
      status: "forbidden",
      reason: expect.stringMatching(/Only the coworker/),
    });
  });

  it("refuses when the shifts are gone or started", async () => {
    m.dbGetShiftRequest.mockResolvedValueOnce(request({ shift_id: 99 }));
    expect(await claim(ben)).toMatchObject({ status: "not_found" });
    m.dbGetShiftRequest.mockResolvedValueOnce(
      request({
        request_type: "swap",
        swap_shift_id: 99,
        target_user_id: "ben",
      }),
    );
    expect(await claim(ben)).toMatchObject({ status: "not_found" });
    m.dbGetShiftRequest.mockResolvedValueOnce(request({ shift_id: 5 }));
    expect(await claim(ben)).toMatchObject({ status: "shift_started" });
    m.dbGetShiftRequest.mockResolvedValueOnce(
      request({
        request_type: "swap",
        swap_shift_id: 6,
        target_user_id: "ben",
      }),
    );
    expect(await claim(ben)).toMatchObject({ status: "shift_started" });
  });

  it("claims an offer for the caller", async () => {
    m.dbGetShiftRequest.mockResolvedValueOnce(request());
    m.dbClaimShiftRequest.mockResolvedValueOnce(
      request({ status: "pending_approval", claimed_by: "ben" }),
    );
    expect(await claim(ben)).toMatchObject({
      ok: true,
      value: { status: "pending_approval" },
    });
    expect(m.dbClaimShiftRequest).toHaveBeenCalledWith(7, "o1", "ben");
  });

  it("accepts a swap, checking both people are free", async () => {
    m.dbGetShiftRequest.mockResolvedValueOnce(
      request({
        request_type: "swap",
        swap_shift_id: 2,
        target_user_id: "ben",
        claimed_by: "ben",
      }),
    );
    m.dbClaimShiftRequest.mockResolvedValueOnce(request());
    await claim(ben);
    expect(m.dbClaimShiftRequest).toHaveBeenCalledWith(7, "o1", null);
    expect(m.dbGetOverlappingScheduledShifts).toHaveBeenCalledTimes(2);
  });

  it("refuses a busy coworker or a request that closed meanwhile", async () => {
    m.dbGetShiftRequest.mockResolvedValue(request());
    m.dbGetOverlappingScheduledShifts.mockResolvedValueOnce([SHIFTS[2]]);
    expect(await claim(ben)).toMatchObject({ status: "schedule_conflict" });
    m.dbClaimShiftRequest.mockResolvedValueOnce(undefined);
    expect(await claim(ben)).toMatchObject({ status: "not_open" });
    m.dbGetShiftRequest.mockReset();
  });

  it("defaults to the current time", async () => {
    m.dbGetShiftRequest.mockResolvedValueOnce(request());
    m.dbClaimShiftRequest.mockResolvedValueOnce(request());
    expect((await claimShiftRequest(ben, 7)).ok).toBe(true);
  });
});

describe("cancelShiftRequest", () => {
  it("cancels for the requester, and refuses others", async () => {
    m.dbGetShiftRequest.mockResolvedValueOnce(undefined);
    expect(await cancelShiftRequest(amy, 7)).toMatchObject({
      status: "not_found",
    });
    m.dbGetShiftRequest.mockResolvedValueOnce(request({ status: "denied" }));
    expect(await cancelShiftRequest(amy, 7)).toMatchObject({
      status: "not_open",
      reason: expect.stringMatching(/already denied/),
    });
    m.dbGetShiftRequest.mockResolvedValueOnce(request());
    expect(await cancelShiftRequest(ben, 7)).toMatchObject({
      status: "forbidden",
    });
    m.dbGetShiftRequest.mockResolvedValueOnce(request());
    m.dbCancelShiftRequest.mockResolvedValueOnce(
      request({ status: "cancelled" }),
    );
    expect(await cancelShiftRequest(amy, 7)).toMatchObject({ ok: true });
    expect(m.dbCancelShiftRequest).toHaveBeenCalledWith(7, "o1", "amy");
    m.dbGetShiftRequest.mockResolvedValueOnce(request());
    m.dbCancelShiftRequest.mockResolvedValueOnce(undefined);
    expect(await cancelShiftRequest(mgr, 7)).toMatchObject({
      status: "not_open",
    });
  });
});

describe("reviewShiftRequest", () => {
  const pending = request({ status: "pending_approval", claimed_by: "ben" });
  const review = (
    actor: typeof amy,
    decision: "approved" | "denied",
    note?: string,
  ) => reviewShiftRequest(actor, 7, decision, note, NOW);

  it("is for admins only", async () => {
    expect(await review(amy, "approved")).toMatchObject({
      status: "forbidden",
    });
    expect(m.dbGetShiftRequest).not.toHaveBeenCalled();
  });

  it("checks the note and the request", async () => {
    expect(await review(mgr, "denied", "x".repeat(501))).toMatchObject({
      status: "invalid_input",
    });
    m.dbGetShiftRequest.mockResolvedValueOnce(undefined);
    expect(await review(mgr, "denied")).toMatchObject({ status: "not_found" });
    m.dbGetShiftRequest.mockResolvedValueOnce(request());
    expect(await review(mgr, "denied")).toMatchObject({
      status: "not_pending",
    });
  });

  it("denies", async () => {
    m.dbGetShiftRequest.mockResolvedValueOnce(pending);
    m.dbDenyShiftRequest.mockResolvedValueOnce({
      ...pending,
      status: "denied",
    });
    expect(await review(mgr, "denied", " no ")).toMatchObject({
      ok: true,
      decision: "denied",
    });
    expect(m.dbDenyShiftRequest).toHaveBeenCalledWith(7, "o1", "mgr", "no");
    m.dbGetShiftRequest.mockResolvedValueOnce(pending);
    m.dbDenyShiftRequest.mockResolvedValueOnce(undefined);
    expect(await review(mgr, "denied")).toMatchObject({
      status: "not_pending",
    });
  });

  it("re-checks the shifts before approving", async () => {
    m.dbGetShiftRequest.mockResolvedValueOnce({ ...pending, shift_id: 99 });
    expect(await review(mgr, "approved")).toMatchObject({
      status: "not_found",
    });
    m.dbGetShiftRequest.mockResolvedValueOnce({
      ...pending,
      request_type: "swap",
      swap_shift_id: 99,
    });
    expect(await review(mgr, "approved")).toMatchObject({
      status: "not_found",
    });
    m.dbGetShiftRequest.mockResolvedValueOnce({ ...pending, shift_id: 5 });
    expect(await review(mgr, "approved")).toMatchObject({
      status: "shift_started",
    });
    m.dbGetShiftRequest.mockResolvedValueOnce({
      ...pending,
      request_type: "swap",
      swap_shift_id: 6,
    });
    expect(await review(mgr, "approved")).toMatchObject({
      status: "shift_started",
    });
    m.dbGetShiftRequest.mockResolvedValueOnce(pending);
    m.dbGetApprovedTimeOffForPeriod.mockResolvedValueOnce([
      { start_date: "2030-01-05", end_date: "2030-01-05" },
    ]);
    expect(await review(mgr, "approved")).toMatchObject({
      status: "time_off_conflict",
    });
  });

  it("approves, reporting the shifts before and after", async () => {
    m.dbGetShiftRequest.mockResolvedValueOnce(pending);
    const moved = { ...SHIFTS[1], user_id: "ben" };
    m.dbApproveShiftRequest.mockResolvedValueOnce({
      request: { ...pending, status: "approved" },
      shifts: [moved],
      superseded: [],
    });
    expect(await review(mgr, "approved")).toEqual({
      ok: true,
      decision: "approved",
      value: {
        request: { ...pending, status: "approved" },
        shifts: [moved],
        previous: [SHIFTS[1]],
        superseded: [],
      },
    });
    expect(m.dbApproveShiftRequest).toHaveBeenCalledWith(7, "o1", "mgr", null);
  });

  it("approves a swap with both shifts", async () => {
    const swap = {
      ...pending,
      request_type: "swap" as const,
      swap_shift_id: 2,
      target_user_id: "ben",
    };
    m.dbGetShiftRequest.mockResolvedValueOnce(swap);
    m.dbApproveShiftRequest.mockResolvedValueOnce({
      request: swap,
      shifts: [],
      superseded: [],
    });
    const result = await review(mgr, "approved");
    expect(
      result.ok && result.decision === "approved" && result.value.previous,
    ).toEqual([SHIFTS[1], SHIFTS[2]]);
  });

  it("reports a shift that changed hands", async () => {
    m.dbGetShiftRequest.mockResolvedValueOnce(pending);
    m.dbApproveShiftRequest.mockResolvedValueOnce(undefined);
    expect(await review(mgr, "approved")).toMatchObject({
      status: "shift_changed",
    });
  });

  it("defaults to the current time", async () => {
    m.dbGetShiftRequest.mockResolvedValueOnce(pending);
    m.dbDenyShiftRequest.mockResolvedValueOnce(pending);
    expect((await reviewShiftRequest(mgr, 7, "denied")).ok).toBe(true);
  });
});
