import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

process.env.TZ = "UTC";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
