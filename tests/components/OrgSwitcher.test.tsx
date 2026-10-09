import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolved } from "../utils";

const clerk = vi.hoisted(() => ({
  value: {} as {
    setActive?: ReturnType<typeof vi.fn>;
    organization?: { id: string } | null;
  },
}));

vi.mock("@clerk/nextjs", () => ({ useClerk: () => clerk.value }));

import { useOrgSwitcher } from "@/components/OrgSwitcher";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("useOrgSwitcher", () => {
  it("switches to the requested org when it is not active", () => {
    const setActive = vi.fn(async () => {});
    clerk.value = { setActive, organization: { id: "org_old" } };
    const { result } = renderHook(() =>
      useOrgSwitcher(resolved<string | undefined>("org_new")),
    );
    expect(setActive).toHaveBeenCalledWith({ organization: "org_new" });
    expect(result.current).toEqual({
      orgId: "org_new",
      currentOrgId: "org_old",
      isSwitched: false,
    });
  });

  it("switches when no org is active yet", () => {
    const setActive = vi.fn(async () => {});
    clerk.value = { setActive, organization: null };
    const { result } = renderHook(() =>
      useOrgSwitcher(resolved<string | undefined>("org_1")),
    );
    expect(setActive).toHaveBeenCalled();
    expect(result.current.currentOrgId).toBeUndefined();
  });

  it("logs a warning when switching fails", async () => {
    const setActive = vi.fn(async () => {
      throw new Error("nope");
    });
    clerk.value = { setActive, organization: { id: "org_old" } };
    renderHook(() => useOrgSwitcher(resolved<string | undefined>("org_new")));
    await waitFor(() =>
      expect(console.warn).toHaveBeenCalledWith(
        "[Org Switcher] Failed to set active organization",
        expect.any(Error),
      ),
    );
  });

  it("does nothing when the org is already active", () => {
    const setActive = vi.fn(async () => {});
    clerk.value = { setActive, organization: { id: "org_1" } };
    const { result } = renderHook(() =>
      useOrgSwitcher(resolved<string | undefined>("org_1")),
    );
    expect(setActive).not.toHaveBeenCalled();
    expect(result.current.isSwitched).toBe(true);
  });

  it.each([
    ["no org id", undefined],
    ["an empty org id", ""],
  ])("does nothing with %s", (_label, orgId) => {
    const setActive = vi.fn(async () => {});
    clerk.value = { setActive, organization: { id: "org_1" } };
    renderHook(() => useOrgSwitcher(resolved<string | undefined>(orgId)));
    expect(setActive).not.toHaveBeenCalled();
  });

  it("does nothing before Clerk is ready", () => {
    clerk.value = { organization: undefined };
    const { result } = renderHook(() =>
      useOrgSwitcher(resolved<string | undefined>("org_1")),
    );
    expect(result.current.orgId).toBe("org_1");
  });
});
