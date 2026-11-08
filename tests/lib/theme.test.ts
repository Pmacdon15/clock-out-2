import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyTheme, THEME_INIT_SCRIPT, THEME_STORAGE_KEY } from "@/lib/theme";

const root = document.documentElement;

function resetRoot() {
  root.classList.remove("dark");
  root.style.colorScheme = "";
  localStorage.clear();
}

describe("applyTheme", () => {
  beforeEach(resetRoot);
  afterEach(() => {
    vi.restoreAllMocks();
    resetRoot();
  });

  it("switches to dark mode and saves the choice", () => {
    applyTheme("dark");
    expect(root.classList.contains("dark")).toBe(true);
    expect(root.style.colorScheme).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("switches back to light mode and saves the choice", () => {
    applyTheme("dark");
    applyTheme("light");
    expect(root.classList.contains("dark")).toBe(false);
    expect(root.style.colorScheme).toBe("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("still applies the theme when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    applyTheme("dark");
    expect(root.classList.contains("dark")).toBe(true);
  });
});

describe("THEME_INIT_SCRIPT", () => {
  let systemDark: boolean;
  let onSystemChange: (() => void) | undefined;

  beforeEach(() => {
    resetRoot();
    systemDark = false;
    onSystemChange = undefined;
    vi.stubGlobal("matchMedia", (query: string) => ({
      media: query,
      get matches() {
        return systemDark;
      },
      addEventListener: (_: string, cb: () => void) => {
        onSystemChange = cb;
      },
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetRoot();
  });

  // biome-ignore lint/security/noGlobalEval: runs the exact inline script the layout ships
  const run = () => (0, eval)(THEME_INIT_SCRIPT);

  it("follows the system setting when nothing is saved", () => {
    systemDark = true;
    run();
    expect(root.classList.contains("dark")).toBe(true);
    expect(root.style.colorScheme).toBe("dark");
  });

  it("keeps following live system changes when nothing is saved", () => {
    run();
    expect(root.classList.contains("dark")).toBe(false);
    systemDark = true;
    onSystemChange?.();
    expect(root.classList.contains("dark")).toBe(true);
  });

  it("prefers the saved choice over the system setting", () => {
    systemDark = true;
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    run();
    expect(root.classList.contains("dark")).toBe(false);
    onSystemChange?.();
    expect(root.classList.contains("dark")).toBe(false);
  });

  it("ignores an unrecognised saved value", () => {
    systemDark = true;
    localStorage.setItem(THEME_STORAGE_KEY, "purple");
    run();
    expect(root.classList.contains("dark")).toBe(true);
  });

  it("falls back to the system setting when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    systemDark = true;
    run();
    expect(root.classList.contains("dark")).toBe(true);
  });
});
