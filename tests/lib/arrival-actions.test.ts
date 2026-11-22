// @vitest-environment node
import { err, ok } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ reportSiteArrivalDal: vi.fn() }));
vi.mock("@/lib/arrival-dal", () => ({
  reportSiteArrivalDal: mocks.reportSiteArrivalDal,
}));

import { reportSiteArrivalAction } from "@/lib/arrival-actions";

const point = { latitude: 45, longitude: -75, accuracy: 10 };

describe("reportSiteArrivalAction", () => {
  it("passes the coordinates on and returns the outcome", async () => {
    const outcome = { status: "prompted", siteName: "Site A", pushed: 1 };
    mocks.reportSiteArrivalDal.mockResolvedValueOnce(ok(outcome));
    await expect(reportSiteArrivalAction(point)).resolves.toEqual({
      success: true,
      data: outcome,
    });
    expect(mocks.reportSiteArrivalDal).toHaveBeenCalledWith(point);
  });

  it("returns the failure reason", async () => {
    mocks.reportSiteArrivalDal.mockResolvedValueOnce(err({ reason: "nope" }));
    await expect(reportSiteArrivalAction(point)).resolves.toEqual({
      success: false,
      error: "nope",
    });
  });
});
