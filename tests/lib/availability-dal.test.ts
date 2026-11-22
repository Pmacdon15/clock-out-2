import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  protect: vi.fn(),
  dbListAvailability: vi.fn(),
  dbAddAvailability: vi.fn(),
  dbDeleteAvailability: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: { protect: m.protect } }));
vi.mock("@/lib/availability-db", () => ({
  dbListAvailability: m.dbListAvailability,
  dbAddAvailability: m.dbAddAvailability,
  dbDeleteAvailability: m.dbDeleteAvailability,
}));

import {
  addAvailabilityDal,
  deleteAvailabilityDal,
  getAvailabilityView,
} from "@/lib/availability-dal";
import { SCHEDULING_UPGRADE_REASON } from "@/lib/plan-features";

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

const input = {
  kind: "unavailable" as const,
  weekdays: [3, 1, 3],
  startMinute: 540,
  endMinute: 1020,
  timezone: "UTC",
  note: "  Classes ",
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  signIn();
});

describe("getAvailabilityView", () => {
  it("refuses without an org or the scheduling feature", async () => {
    signIn({ orgId: null });
    await expect(getAvailabilityView()).resolves.toEqual({
      ok: false,
      error: { reason: "Unauthorized" },
    });
    signIn({ scheduling: false });
    await expect(getAvailabilityView()).resolves.toEqual({
      ok: false,
      error: { reason: SCHEDULING_UPGRADE_REASON },
    });
  });

  it("lists a member's own windows", async () => {
    m.dbListAvailability.mockResolvedValue([{ id: 1 }]);
    await expect(getAvailabilityView()).resolves.toEqual({
      ok: true,
      value: { windows: [{ id: 1 }], userId: "amy", isAdmin: false },
    });
    expect(m.dbListAvailability).toHaveBeenCalledWith("o1", "amy");
  });

  it("lists everyone's for an admin", async () => {
    signIn({ orgRole: "org:admin" });
    m.dbListAvailability.mockResolvedValue([]);
    await expect(getAvailabilityView()).resolves.toMatchObject({
      ok: true,
      value: { isAdmin: true },
    });
    expect(m.dbListAvailability).toHaveBeenCalledWith("o1", null);
  });

  it("reports a failed read", async () => {
    m.dbListAvailability.mockRejectedValue(new Error("down"));
    await expect(getAvailabilityView()).resolves.toEqual({
      ok: false,
      error: { reason: "Error fetching availability" },
    });
  });
});

describe("addAvailabilityDal", () => {
  it("refuses when signed out of an org", async () => {
    signIn({ userId: null });
    await expect(addAvailabilityDal(input)).resolves.toEqual({
      ok: false,
      reason: "Unauthorized",
    });
  });

  it("refuses invalid input", async () => {
    await expect(
      addAvailabilityDal({ ...input, weekdays: [] }),
    ).resolves.toEqual({ ok: false, reason: "Choose at least one day" });
    expect(m.dbAddAvailability).not.toHaveBeenCalled();
  });

  it("saves the member's windows, one per distinct weekday", async () => {
    m.dbAddAvailability.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    await expect(addAvailabilityDal(input)).resolves.toEqual({
      ok: true,
      value: [{ id: 1 }, { id: 2 }],
    });
    expect(m.dbAddAvailability).toHaveBeenCalledWith({
      orgId: "o1",
      userId: "amy",
      kind: "unavailable",
      weekdays: [1, 3],
      startMinute: 540,
      endMinute: 1020,
      timezone: "UTC",
      note: "Classes",
      max: 50,
    });
  });

  it("stores no note when it's blank or missing", async () => {
    m.dbAddAvailability.mockResolvedValue([{ id: 1 }]);
    await addAvailabilityDal({ ...input, note: "  " });
    expect(m.dbAddAvailability.mock.calls[0][0].note).toBeNull();
    await addAvailabilityDal({ ...input, note: undefined });
    expect(m.dbAddAvailability.mock.calls[1][0].note).toBeNull();
  });

  it("says so when the member is at the limit", async () => {
    m.dbAddAvailability.mockResolvedValue(undefined);
    await expect(addAvailabilityDal(input)).resolves.toEqual({
      ok: false,
      reason: "You can keep up to 50 availability times. Remove some first.",
    });
  });

  it("reports a failed save", async () => {
    m.dbAddAvailability.mockRejectedValue(new Error("down"));
    await expect(addAvailabilityDal(input)).resolves.toEqual({
      ok: false,
      reason: "Failed to save availability",
    });
  });
});

describe("deleteAvailabilityDal", () => {
  it("refuses without the scheduling feature", async () => {
    signIn({ scheduling: false });
    await expect(deleteAvailabilityDal(1)).resolves.toEqual({
      ok: false,
      reason: SCHEDULING_UPGRADE_REASON,
    });
  });

  it("refuses a bad id", async () => {
    await expect(deleteAvailabilityDal(1.5)).resolves.toEqual({
      ok: false,
      reason: "Not found",
    });
  });

  it("removes only the member's own window", async () => {
    m.dbDeleteAvailability.mockResolvedValue({ id: 4 });
    await expect(deleteAvailabilityDal(4)).resolves.toEqual({
      ok: true,
      value: { id: 4 },
    });
    expect(m.dbDeleteAvailability).toHaveBeenCalledWith(4, "o1", "amy");
  });

  it("lets an admin remove anyone's", async () => {
    signIn({ orgRole: "org:admin" });
    m.dbDeleteAvailability.mockResolvedValue({ id: 4 });
    await deleteAvailabilityDal(4);
    expect(m.dbDeleteAvailability).toHaveBeenCalledWith(4, "o1", null);
  });

  it("reports a missing window or a failure", async () => {
    m.dbDeleteAvailability.mockResolvedValue(undefined);
    await expect(deleteAvailabilityDal(4)).resolves.toEqual({
      ok: false,
      reason: "Not found",
    });
    m.dbDeleteAvailability.mockRejectedValue(new Error("down"));
    await expect(deleteAvailabilityDal(4)).resolves.toEqual({
      ok: false,
      reason: "Failed to remove availability",
    });
  });
});
