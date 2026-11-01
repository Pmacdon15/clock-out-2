import { err, ok } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateTag: vi.fn(),
  createTimeOffRequestDal: vi.fn(),
  reviewTimeOffRequestDal: vi.fn(),
  cancelTimeOffRequestDal: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: { protect: vi.fn() } }));
vi.mock("next/cache", () => ({ updateTag: mocks.updateTag }));
vi.mock("@/lib/geoapify", () => ({}));
vi.mock("@/lib/reports", () => ({}));
vi.mock("@/lib/dal", () => ({
  createTimeOffRequestDal: mocks.createTimeOffRequestDal,
  reviewTimeOffRequestDal: mocks.reviewTimeOffRequestDal,
  cancelTimeOffRequestDal: mocks.cancelTimeOffRequestDal,
}));

import {
  cancelTimeOffRequestAction,
  createTimeOffRequestAction,
  reviewTimeOffRequestAction,
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

  it("reviews a request", async () => {
    mocks.reviewTimeOffRequestDal.mockResolvedValue(ok(request));
    await expect(reviewTimeOffRequestAction(3, "approved")).resolves.toEqual({
      success: true,
      data: request,
    });
    expect(mocks.reviewTimeOffRequestDal).toHaveBeenCalledWith(3, "approved");
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
