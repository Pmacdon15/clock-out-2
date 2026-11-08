// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  updateTag: vi.fn(),
  refresh: vi.fn(),
  after: vi.fn((fn: () => unknown) => fn()),
  notifyShiftRequest: vi.fn(),
  mirrorReassignedShifts: vi.fn(),
  claimShiftRequestDal: vi.fn(),
  createShiftRequestDal: vi.fn(),
  cancelShiftRequestDal: vi.fn(),
  approveShiftRequestDal: vi.fn(),
  denyShiftRequestDal: vi.fn(),
}));

vi.mock("next/cache", () => ({
  updateTag: m.updateTag,
  refresh: m.refresh,
}));
vi.mock("next/server", () => ({ after: m.after }));
vi.mock("@/lib/shift-request-notify", () => ({
  notifyShiftRequest: m.notifyShiftRequest,
  mirrorReassignedShifts: m.mirrorReassignedShifts,
}));
vi.mock("@/lib/shift-requests-dal", () => ({
  claimShiftRequestDal: m.claimShiftRequestDal,
  createShiftRequestDal: m.createShiftRequestDal,
  cancelShiftRequestDal: m.cancelShiftRequestDal,
  approveShiftRequestDal: m.approveShiftRequestDal,
  denyShiftRequestDal: m.denyShiftRequestDal,
}));

import {
  approveShiftRequestAction,
  cancelShiftRequestAction,
  claimShiftRequestAction,
  createShiftRequestAction,
  denyShiftRequestAction,
} from "@/lib/shift-request-actions";

const request = { id: 7, org_id: "o1" };
const detail = { ...request, shift_start: "a", shift_end: "b" };
const done = <T>(value: T) => ({
  ok: true,
  value,
  detail,
  actorId: "amy",
});

beforeEach(() => {
  vi.clearAllMocks();
  m.after.mockImplementation((fn: () => unknown) => fn());
});

describe("shift request actions", () => {
  it.each([
    ["claimed", claimShiftRequestAction, m.claimShiftRequestDal],
    ["cancelled", cancelShiftRequestAction, m.cancelShiftRequestDal],
    ["denied", denyShiftRequestAction, m.denyShiftRequestDal],
  ] as const)("notifies after a request is %s", async (event, action, dal) => {
    dal.mockResolvedValueOnce(done(request));
    await expect(action(7, "UTC")).resolves.toEqual({ success: true });
    expect(dal).toHaveBeenCalledWith(7);
    expect(m.refresh).toHaveBeenCalled();
    expect(m.notifyShiftRequest).toHaveBeenCalledWith(
      event,
      request,
      detail,
      "amy",
      "UTC",
    );
  });

  it("approves, refreshes the schedule and moves calendar events", async () => {
    const previous = [{ id: 1, user_id: "amy" }];
    const shifts = [{ id: 1, user_id: "ben" }];
    m.approveShiftRequestDal.mockResolvedValueOnce(
      done({ request, shifts, previous, superseded: [] }),
    );
    await expect(approveShiftRequestAction(7)).resolves.toEqual({
      success: true,
    });
    expect(m.updateTag).toHaveBeenCalledWith("scheduled-shifts-o1");
    expect(m.mirrorReassignedShifts).toHaveBeenCalledWith(previous, shifts);
    expect(m.notifyShiftRequest).toHaveBeenCalledWith(
      "approved",
      request,
      detail,
      "amy",
      undefined,
    );
  });

  it("passes failures back and tells nobody", async () => {
    m.approveShiftRequestDal.mockResolvedValueOnce({ ok: false, reason: "No" });
    await expect(approveShiftRequestAction(7)).resolves.toEqual({
      success: false,
      error: "No",
    });
    expect(m.updateTag).not.toHaveBeenCalled();
    expect(m.refresh).not.toHaveBeenCalled();
    expect(m.notifyShiftRequest).not.toHaveBeenCalled();
  });

  it("creates a request, refreshes the page and notifies", async () => {
    const input = {
      type: "swap" as const,
      shiftId: 3,
      swapShiftId: 4,
      targetUserId: null,
      note: null,
    };
    m.createShiftRequestDal.mockResolvedValueOnce(done(request));
    await expect(createShiftRequestAction(input, "UTC")).resolves.toEqual({
      success: true,
    });
    expect(m.createShiftRequestDal).toHaveBeenCalledWith(input);
    expect(m.refresh).toHaveBeenCalled();
    expect(m.notifyShiftRequest).toHaveBeenCalledWith(
      "created",
      request,
      detail,
      "amy",
      "UTC",
    );
  });

  it("skips the notice when the request can't be re-read", async () => {
    m.claimShiftRequestDal.mockResolvedValueOnce({
      ...done(request),
      detail: undefined,
    });
    await expect(claimShiftRequestAction(7)).resolves.toEqual({
      success: true,
    });
    expect(m.notifyShiftRequest).not.toHaveBeenCalled();
  });
});
