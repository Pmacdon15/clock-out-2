import { beforeEach, describe, expect, it, vi } from "vitest";

const resetCalendarFeedPath = vi.hoisted(() => vi.fn());
vi.mock("@/lib/dal", () => ({ resetCalendarFeedPath }));

import { resetCalendarFeedAction } from "@/lib/calendar-feed-actions";

describe("resetCalendarFeedAction", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("returns the new feed path", async () => {
    resetCalendarFeedPath.mockResolvedValueOnce("/api/calendar/new.ics");
    await expect(resetCalendarFeedAction()).resolves.toEqual({
      status: "ok",
      path: "/api/calendar/new.ics",
    });
  });

  it("reports when feeds aren't available", async () => {
    resetCalendarFeedPath.mockResolvedValueOnce(null);
    await expect(resetCalendarFeedAction()).resolves.toMatchObject({
      status: "error",
    });
  });

  it("reports a failed reset", async () => {
    resetCalendarFeedPath.mockRejectedValueOnce(new Error("clerk down"));
    await expect(resetCalendarFeedAction()).resolves.toEqual({
      status: "error",
      error: "Couldn't reset the calendar link. Try again.",
    });
  });
});
