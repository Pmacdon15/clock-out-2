import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  protect: vi.fn(),
  getProcessedMembers: vi.fn(),
  dbGetTimeOffRequests: vi.fn(),
  dbCreateTimeOffRequest: vi.fn(),
  dbReviewTimeOffRequest: vi.fn(),
  dbCancelTimeOffRequest: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: { protect: mocks.protect },
  clerkClient: vi.fn(async () => ({
    organizations: { getOrganizationMembershipList: vi.fn() },
  })),
}));
vi.mock("@/lib/clerk-pagination", () => ({
  fetchAllPages: vi.fn(async () => []),
}));
vi.mock("@/lib/utils-clerk", () => ({
  getProcessedMembers: mocks.getProcessedMembers,
}));
vi.mock("@/lib/geoapify", () => ({ reverseGeocode: vi.fn() }));
vi.mock("@/lib/db", () => ({
  dbGetTimeOffRequests: mocks.dbGetTimeOffRequests,
  dbCreateTimeOffRequest: mocks.dbCreateTimeOffRequest,
  dbReviewTimeOffRequest: mocks.dbReviewTimeOffRequest,
  dbCancelTimeOffRequest: mocks.dbCancelTimeOffRequest,
}));

import {
  cancelTimeOffRequestDal,
  createTimeOffRequestDal,
  getTimeOffRequests,
  reviewTimeOffRequestDal,
} from "@/lib/dal";

const member = { userId: "user_1", orgId: "org_1", orgRole: "org:member" };
const admin = { userId: "admin_1", orgId: "org_1", orgRole: "org:admin" };
const noUser = { userId: null, orgId: "org_1", orgRole: "org:admin" };
const noOrg = { userId: "admin_1", orgId: null, orgRole: "org:admin" };

const request = { id: 3, org_id: "org_1", user_id: "user_1" };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-01T12:00:00Z"));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("getTimeOffRequests", () => {
  it.each([
    ["no user", noUser],
    ["no org", noOrg],
  ])("rejects %s", async (_label, session) => {
    mocks.protect.mockResolvedValue(session);
    await expect(getTimeOffRequests()).resolves.toEqual({
      ok: false,
      error: { reason: "Unauthorized or no organization selected" },
    });
  });

  it("gives admins every member's requests", async () => {
    mocks.protect.mockResolvedValue(admin);
    mocks.dbGetTimeOffRequests.mockResolvedValue([request]);
    await expect(getTimeOffRequests()).resolves.toEqual({
      ok: true,
      value: [request],
    });
    expect(mocks.dbGetTimeOffRequests).toHaveBeenCalledWith(
      "org_1",
      null,
      "2025-01-25",
    );
  });

  it("gives members their own requests", async () => {
    mocks.protect.mockResolvedValue(member);
    mocks.dbGetTimeOffRequests.mockResolvedValue([]);
    await getTimeOffRequests();
    expect(mocks.dbGetTimeOffRequests.mock.calls[0][1]).toBe("user_1");
  });

  it("reports a failed read", async () => {
    mocks.protect.mockResolvedValue(member);
    mocks.dbGetTimeOffRequests.mockRejectedValue(new Error("db"));
    await expect(getTimeOffRequests()).resolves.toEqual({
      ok: false,
      error: { reason: "Error fetching time off" },
    });
  });
});

describe("createTimeOffRequestDal", () => {
  const create = (note?: string | null) =>
    createTimeOffRequestDal("vacation", "2026-03-02", "2026-03-04", 8, note);

  it.each([
    ["no user", noUser],
    ["no org", noOrg],
  ])("rejects %s", async (_label, session) => {
    mocks.protect.mockResolvedValue(session);
    expect((await create())._unsafeUnwrapErr()).toEqual({
      reason: "Unauthorized",
    });
  });

  it("validates the request", async () => {
    mocks.protect.mockResolvedValue(member);
    expect(
      (
        await createTimeOffRequestDal("vacation", "2026-03-04", "2026-03-02", 8)
      )._unsafeUnwrapErr(),
    ).toEqual({ reason: "End date must be on or after the start date" });
    expect((await create("x".repeat(501)))._unsafeUnwrapErr()).toEqual({
      reason: "Note is too long",
    });
    expect(mocks.dbCreateTimeOffRequest).not.toHaveBeenCalled();
  });

  it("files a pending request for the caller with a trimmed note", async () => {
    mocks.protect.mockResolvedValue(member);
    mocks.dbCreateTimeOffRequest.mockResolvedValue(request);
    expect((await create("  Trip "))._unsafeUnwrap()).toEqual(request);
    expect(mocks.dbCreateTimeOffRequest).toHaveBeenCalledWith(
      "org_1",
      "user_1",
      "vacation",
      "2026-03-02",
      "2026-03-04",
      8,
      "Trip",
      null,
    );
    await create();
    expect(mocks.dbCreateTimeOffRequest.mock.calls[1][6]).toBeNull();
  });

  it.each([
    ["another member", { memberId: "user_2" }],
    ["approved", { approve: true }],
  ])("refuses members filing time off %s", async (_label, options) => {
    mocks.protect.mockResolvedValue(member);
    expect(
      (
        await createTimeOffRequestDal(
          "vacation",
          "2026-03-02",
          "2026-03-02",
          8,
          null,
          options,
        )
      )._unsafeUnwrapErr(),
    ).toEqual({ reason: "Unauthorized" });
    expect(mocks.dbCreateTimeOffRequest).not.toHaveBeenCalled();
  });

  it("lets admins record approved time off for a member", async () => {
    mocks.protect.mockResolvedValue(admin);
    mocks.getProcessedMembers.mockResolvedValue([{ id: "user_1" }]);
    mocks.dbCreateTimeOffRequest.mockResolvedValue(request);
    const res = await createTimeOffRequestDal(
      "sick",
      "2026-03-02",
      "2026-03-02",
      8,
      null,
      { memberId: "user_1", approve: true },
    );
    expect(res._unsafeUnwrap()).toEqual(request);
    expect(mocks.dbCreateTimeOffRequest).toHaveBeenCalledWith(
      "org_1",
      "user_1",
      "sick",
      "2026-03-02",
      "2026-03-02",
      8,
      null,
      "admin_1",
    );
  });

  it("lets admins file their own pending request with a null member", async () => {
    mocks.protect.mockResolvedValue(admin);
    mocks.dbCreateTimeOffRequest.mockResolvedValue(request);
    await createTimeOffRequestDal("sick", "2026-03-02", "2026-03-02", 8, null, {
      memberId: null,
      approve: false,
    });
    expect(mocks.dbCreateTimeOffRequest.mock.calls[0][1]).toBe("admin_1");
    expect(mocks.dbCreateTimeOffRequest.mock.calls[0][7]).toBeNull();
    expect(mocks.getProcessedMembers).not.toHaveBeenCalled();
  });

  it("refuses time off for someone outside the org", async () => {
    mocks.protect.mockResolvedValue(admin);
    mocks.getProcessedMembers.mockResolvedValue([{ id: "user_1" }]);
    expect(
      (
        await createTimeOffRequestDal(
          "sick",
          "2026-03-02",
          "2026-03-02",
          8,
          null,
          { memberId: "user_9" },
        )
      )._unsafeUnwrapErr(),
    ).toEqual({ reason: "Member not found" });
  });

  it("words the overlap for another member", async () => {
    mocks.protect.mockResolvedValue(admin);
    mocks.getProcessedMembers.mockResolvedValue([{ id: "user_1" }]);
    mocks.dbCreateTimeOffRequest.mockResolvedValue(undefined);
    expect(
      (
        await createTimeOffRequestDal(
          "sick",
          "2026-03-02",
          "2026-03-02",
          8,
          null,
          { memberId: "user_1" },
        )
      )._unsafeUnwrapErr(),
    ).toEqual({ reason: "This member already has time off on those dates" });
  });

  it("refuses overlapping time off", async () => {
    mocks.protect.mockResolvedValue(member);
    mocks.dbCreateTimeOffRequest.mockResolvedValue(undefined);
    expect((await create())._unsafeUnwrapErr()).toEqual({
      reason: "You already have time off on those dates",
    });
  });

  it("reports a failed insert", async () => {
    mocks.protect.mockResolvedValue(member);
    mocks.dbCreateTimeOffRequest.mockRejectedValue(new Error("db"));
    expect((await create())._unsafeUnwrapErr()).toEqual({
      reason: "Failed to request time off",
    });
  });
});

describe("reviewTimeOffRequestDal", () => {
  it.each([
    ["no user", noUser],
    ["no org", noOrg],
    ["a non-admin", member],
  ])("rejects %s", async (_label, session) => {
    mocks.protect.mockResolvedValue(session);
    expect(
      (await reviewTimeOffRequestDal(3, "approved"))._unsafeUnwrapErr(),
    ).toEqual({ reason: "Unauthorized" });
    expect(mocks.dbReviewTimeOffRequest).not.toHaveBeenCalled();
  });

  it("rejects an unknown decision", async () => {
    mocks.protect.mockResolvedValue(admin);
    expect(
      (
        await reviewTimeOffRequestDal(3, "maybe" as "approved")
      )._unsafeUnwrapErr(),
    ).toEqual({ reason: "Invalid decision" });
  });

  it("approves or denies as the admin", async () => {
    mocks.protect.mockResolvedValue(admin);
    mocks.dbReviewTimeOffRequest.mockResolvedValue(request);
    expect(
      (await reviewTimeOffRequestDal(3, "denied"))._unsafeUnwrap(),
    ).toEqual(request);
    expect(mocks.dbReviewTimeOffRequest).toHaveBeenCalledWith(
      3,
      "org_1",
      "denied",
      "admin_1",
    );
  });

  it("reports a request that is gone or already reviewed", async () => {
    mocks.protect.mockResolvedValue(admin);
    mocks.dbReviewTimeOffRequest.mockResolvedValue(undefined);
    expect(
      (await reviewTimeOffRequestDal(3, "approved"))._unsafeUnwrapErr(),
    ).toEqual({ reason: "Request not found or already reviewed" });
  });

  it("reports a failed update", async () => {
    mocks.protect.mockResolvedValue(admin);
    mocks.dbReviewTimeOffRequest.mockRejectedValue(new Error("db"));
    expect(
      (await reviewTimeOffRequestDal(3, "approved"))._unsafeUnwrapErr(),
    ).toEqual({ reason: "Failed to review request" });
  });
});

describe("cancelTimeOffRequestDal", () => {
  it.each([
    ["no user", noUser],
    ["no org", noOrg],
  ])("rejects %s", async (_label, session) => {
    mocks.protect.mockResolvedValue(session);
    expect((await cancelTimeOffRequestDal(3))._unsafeUnwrapErr()).toEqual({
      reason: "Unauthorized",
    });
  });

  it("passes the caller and their role to the update", async () => {
    mocks.protect.mockResolvedValue(member);
    mocks.dbCancelTimeOffRequest.mockResolvedValue(request);
    expect((await cancelTimeOffRequestDal(3))._unsafeUnwrap()).toEqual(request);
    expect(mocks.dbCancelTimeOffRequest).toHaveBeenCalledWith(
      3,
      "org_1",
      "user_1",
      false,
    );
    mocks.protect.mockResolvedValue(admin);
    await cancelTimeOffRequestDal(3);
    expect(mocks.dbCancelTimeOffRequest.mock.calls[1][3]).toBe(true);
  });

  it("reports a request that can't be cancelled", async () => {
    mocks.protect.mockResolvedValue(member);
    mocks.dbCancelTimeOffRequest.mockResolvedValue(undefined);
    expect((await cancelTimeOffRequestDal(3))._unsafeUnwrapErr()).toEqual({
      reason: "Request not found or can't be cancelled",
    });
  });

  it("reports a failed update", async () => {
    mocks.protect.mockResolvedValue(member);
    mocks.dbCancelTimeOffRequest.mockRejectedValue(new Error("db"));
    expect((await cancelTimeOffRequestDal(3))._unsafeUnwrapErr()).toEqual({
      reason: "Failed to cancel request",
    });
  });
});
