// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  refresh: vi.fn(),
  addAvailabilityDal: vi.fn(),
  deleteAvailabilityDal: vi.fn(),
}));

vi.mock("next/cache", () => ({ refresh: m.refresh }));
vi.mock("@/lib/availability-dal", () => ({
  addAvailabilityDal: m.addAvailabilityDal,
  deleteAvailabilityDal: m.deleteAvailabilityDal,
}));

import {
  addAvailabilityAction,
  deleteAvailabilityAction,
} from "@/lib/availability-actions";

const input = {
  kind: "available" as const,
  weekdays: [1],
  startMinute: 540,
  endMinute: 1020,
  timezone: "UTC",
};

beforeEach(() => {
  m.refresh.mockReset();
});

describe("availability actions", () => {
  it("saves and refreshes the page", async () => {
    m.addAvailabilityDal.mockResolvedValue({ ok: true, value: [] });
    await expect(addAvailabilityAction(input)).resolves.toEqual({
      success: true,
    });
    expect(m.addAvailabilityDal).toHaveBeenCalledWith(input);
    expect(m.refresh).toHaveBeenCalled();
  });

  it("passes on why it couldn't, without refreshing", async () => {
    m.deleteAvailabilityDal.mockResolvedValue({ ok: false, reason: "Nope" });
    await expect(deleteAvailabilityAction(2)).resolves.toEqual({
      success: false,
      error: "Nope",
    });
    expect(m.deleteAvailabilityDal).toHaveBeenCalledWith(2);
    expect(m.refresh).not.toHaveBeenCalled();
  });
});
