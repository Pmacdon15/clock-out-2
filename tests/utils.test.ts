import { describe, expect, test } from "bun:test";
import { cn, parseParams } from "@/lib/utils";

describe("parseParams", () => {
  test("returns a plain string unchanged", () => {
    expect(parseParams("week")).toBe("week");
  });

  test("returns the first value of an array", () => {
    expect(parseParams(["2026", "2025"])).toBe("2026");
  });

  test("returns undefined for an empty array", () => {
    expect(parseParams([])).toBeUndefined();
  });

  test("returns undefined when missing", () => {
    expect(parseParams(undefined)).toBeUndefined();
  });

  test("keeps an empty string", () => {
    expect(parseParams("")).toBe("");
  });
});

describe("cn", () => {
  test("joins class names and skips falsy values", () => {
    expect(cn("a", false && "b", undefined, "c")).toBe("a c");
  });

  test("later Tailwind classes win conflicts", () => {
    expect(cn("px-2 py-1", "px-4")).toBe("py-1 px-4");
  });
});
