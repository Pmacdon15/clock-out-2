import { err, ok } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateTag: vi.fn(),
  createTimeOffRequestDal: vi.fn(),
  reviewTimeOffRequestDal: vi.fn(),
  cancelTimeOffRequestDal: vi.fn(),
  setTimeOffAllowanceDal: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: { protect: vi.fn() } }));
vi.mock("next/cache", () => ({ updateTag: mocks.updateTag }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/schedule-notify", () => ({ notifyScheduleChange: vi.fn() }));
vi.mock("@/lib/geoapify", () => ({}));
vi.mock("@/lib/reports", () => ({}));
vi.mock("@/lib/dal", () => ({
  createTimeOffRequestDal: mocks.createTimeOffRequestDal,
  reviewTimeOffRequestDal: mocks.reviewTimeOffRequestDal,
  cancelTimeOffRequestDal: mocks.cancelTimeOffRequestDal,
  setTimeOffAllowanceDal: mocks.setTimeOffAllowanceDal,
}));

import {
  cancelTimeOffRequestAction,
  createTimeOffRequestAction,
  reviewTimeOffRequestAction,
  setTimeOffAllowanceAction,
} from "@/lib/actions";

const request = { id: 3, org_id: "org_1", user_id: "user_1" };

describe("time off actions", () => {
  it("creates a request and revalidates time off", async () => {
    mocks.createTimeOffRequestDal.mockResolvedValue(ok(request));
    await expect(
      createTimeOffRequestAction("sick", "2026-03-02", "2026-03-02", 8, "Flu"),
    ).resolves.toEqual({ success: true, data: request });
    expect(mocks.createTimeOffRequestDal).toHaveBeenCalledWith(
      "sick",
      "2026-03-02",
      "2026-03-02",
      8,
      "Flu",
    );
    expect(mocks.updateTag).toHaveBeenCalledWith("time-off-org_1");
  });

  it("passes an admin's member and approval through", async () => {
    mocks.createTimeOffRequestDal.mockResolvedValue(ok(request));
    await createTimeOffRequestAction(
      "sick",
      "2026-03-02",
      "2026-03-02",
      8,
      null,
      { memberId: "user_1", approve: true },
    );
    expect(mocks.createTimeOffRequestDal).toHaveBeenCalledWith(
      "sick",
      "2026-03-02",
      "2026-03-02",
      8,
      null,
      { memberId: "user_1", approve: true },
    );
  });

  it("reviews a request", async () => {
    mocks.reviewTimeOffRequestDal.mockResolvedValue(ok(request));
    await expect(reviewTimeOffRequestAction(3, "approved")).resolves.toEqual({
      success: true,
      data: request,
    });
    expect(mocks.reviewTimeOffRequestDal).toHaveBeenCalledWith(3, "approved");
  });

  it("sets a PTO allowance and revalidates time off", async () => {
    const saved = { org_id: "org_1", user_id: "user_1", pto_days: 10 };
    mocks.setTimeOffAllowanceDal.mockResolvedValue(ok(saved));
    await expect(setTimeOffAllowanceAction("user_1", 10)).resolves.toEqual({
      success: true,
      data: saved,
    });
    expect(mocks.setTimeOffAllowanceDal).toHaveBeenCalledWith("user_1", 10);
    expect(mocks.updateTag).toHaveBeenCalledWith("time-off-org_1");
  });

  it("cancels a request", async () => {
    mocks.cancelTimeOffRequestDal.mockResolvedValue(ok(request));
    await expect(cancelTimeOffRequestAction(3)).resolves.toEqual({
      success: true,
      data: request,
    });
  });

  it("returns errors without revalidating", async () => {
    mocks.cancelTimeOffRequestDal.mockResolvedValue(err({ reason: "nope" }));
    await expect(cancelTimeOffRequestAction(3)).resolves.toEqual({
      success: false,
      error: "nope",
    });
    expect(mocks.updateTag).not.toHaveBeenCalled();
  });
});
