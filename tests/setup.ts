import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, vi } from "vitest";

// next/link expects a mounted Next router; a plain anchor is enough for tests.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: Record<string, unknown>) =>
    createElement("a", { href, ...rest }, children as never),
}));

process.env.TZ = "UTC";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
