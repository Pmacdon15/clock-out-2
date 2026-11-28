import { act, renderHook } from "@testing-library/react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStoredToggle } from "@/hooks/useStoredToggle";

function Probe() {
  const [on] = useStoredToggle("k5", true);
  return createElement("span", null, on ? "on" : "off");
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useStoredToggle", () => {
  it("starts at the fallback and remembers a change", () => {
    const { result } = renderHook(() => useStoredToggle("k1", true));
    expect(result.current[0]).toBe(true);
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
    expect(window.localStorage.getItem("k1")).toBe("0");
  });

  it("renders the fallback on the server", () => {
    window.localStorage.setItem("k5", "0");
    expect(renderToString(createElement(Probe))).toContain("on");
  });

  it("reads a saved choice", () => {
    window.localStorage.setItem("k2", "1");
    const { result } = renderHook(() => useStoredToggle("k2", false));
    expect(result.current[0]).toBe(true);
  });

  it("follows a change made in another tab", () => {
    const { result } = renderHook(() => useStoredToggle("k3", true));
    act(() => {
      window.localStorage.setItem("k3", "0");
      window.dispatchEvent(new StorageEvent("storage", { key: "k3" }));
    });
    expect(result.current[0]).toBe(false);
  });

  it("still toggles for this page when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { result, unmount } = renderHook(() => useStoredToggle("k4", true));
    expect(result.current[0]).toBe(true);
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
    unmount();
  });
});
