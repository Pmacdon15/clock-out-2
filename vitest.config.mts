import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Run every test in UTC so date formatting is deterministic on any machine.
process.env.TZ = "UTC";

// CI runs each project as its own job in parallel (`COVERAGE_SHARD=1`) and a
// final job merges their blob reports. A shard reports only the files it
// loaded and skips the thresholds; the merge adds never-loaded files and
// enforces 100%. See .github/workflows/tests.yml.
const shard = Boolean(process.env.COVERAGE_SHARD);

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    clearMocks: true,
    unstubEnvs: true,
    coverage: {
      provider: "v8",
      include: shard ? undefined : ["src/**/*.{ts,tsx}"],
      exclude: [
        "tests/**",
        "src/lib/types.ts",
        "src/mcp/**",
        "src/app/api/mcp/**",
        "src/app/.well-known/**",
      ],
      reporter: ["text", "json-summary", "html"],
      reportOnFailure: true,
      thresholds: shard
        ? undefined
        : { lines: 100, functions: 100, branches: 100, statements: 100 },
    },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: [
            "tests/*.test.{ts,tsx}",
            "tests/lib/**/*.test.{ts,tsx}",
            "tests/hooks/**/*.test.{ts,tsx}",
            "tests/unit/**/*.test.{ts,tsx}",
          ],
        },
      },
      {
        extends: true,
        test: {
          name: "components",
          include: ["tests/components/**/*.test.{ts,tsx}"],
        },
      },
      {
        extends: true,
        test: {
          name: "app",
          include: ["tests/app/**/*.test.{ts,tsx}"],
        },
      },
      {
        // Reads `.next/` after `next build`; see tests/build/static-shell.test.ts.
        extends: true,
        test: {
          name: "build",
          environment: "node",
          setupFiles: [],
          include: ["tests/build/**/*.test.ts"],
        },
      },
    ],
  },
});
