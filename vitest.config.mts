import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Run every test in UTC so date formatting is deterministic on any machine.
process.env.TZ = "UTC";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    clearMocks: true,
    unstubEnvs: true,
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/lib/types.ts"],
      reporter: ["text", "json-summary", "html"],
      reportOnFailure: true,
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
});
