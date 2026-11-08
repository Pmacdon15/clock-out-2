import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  protect: vi.fn(),
  loadOrgMembers: vi.fn(),
  claimShiftRequest: vi.fn(),
  cancelShiftRequest: vi.fn(),
  reviewShiftRequest: vi.fn(),
  dbGetShiftRequest: vi.fn(),
  dbListShiftRequests: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: { protect: m.protect } }));
vi.mock("@/lib/alerts-runner", () => ({ loadOrgMembers: m.loadOrgMembers }));
vi.mock("@/lib/shift-requests", () => ({
  claimShiftRequest: m.claimShiftRequest,
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
  denyShiftRequestDal,
  getShiftRequestsView,
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
