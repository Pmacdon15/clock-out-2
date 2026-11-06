import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  protect: vi.fn(),
  has: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: { protect: mocks.protect } }));

import { getSession, hasFeature, isAdmin } from "@/lib/session";

beforeEach(() => {
  mocks.protect.mockResolvedValue({ userId: "user_1", has: mocks.has });
});

describe("session", () => {
  it("reads the protected session", async () => {
    await expect(getSession()).resolves.toMatchObject({ userId: "user_1" });
    expect(mocks.protect).toHaveBeenCalled();
  });

  it("checks the admin role", async () => {
    mocks.has.mockReturnValue(true);
    await expect(isAdmin()).resolves.toBe(true);
    expect(mocks.has).toHaveBeenCalledWith({ role: "org:admin" });
  });

  it("checks a plan feature", async () => {
    mocks.has.mockReturnValue(false);
    await expect(hasFeature("scheduling")).resolves.toBe(false);
    expect(mocks.has).toHaveBeenCalledWith({ feature: "scheduling" });
  });
});
