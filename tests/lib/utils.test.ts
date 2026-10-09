import { describe, expect, it } from "vitest";
import { cn, parseParams } from "@/lib/utils";

describe("cn", () => {
  it("joins class names and drops falsy values", () => {
    expect(cn("a", false, undefined, "b")).toBe("a b");
  });

  it("lets later tailwind classes win over conflicting earlier ones", () => {
    expect(cn("px-2 py-1", "px-4")).toBe("py-1 px-4");
  });
});

describe("parseParams", () => {
  it("returns the first value of an array", () => {
    expect(parseParams(["first", "second"])).toBe("first");
  });

  it("returns a plain string as-is", () => {
    expect(parseParams("value")).toBe("value");
  });

  it("returns undefined when nothing is passed", () => {
    expect(parseParams(undefined)).toBeUndefined();
  });
});
