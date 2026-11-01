/*
 * Run after `vitest --merge-reports --coverage` in CI. Each parallel test job
 * only reports coverage for the files it loaded, so a source file that no test
 * imports at all would be missing from the merged report instead of showing
 * 0%. This fails the build for any such file, as a single full run would.
 */
import { existsSync, globSync, readFileSync } from "node:fs";
import path from "node:path";
import config from "../vitest.config.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const REPORT = path.join(ROOT, "coverage/coverage-final.json");

const coverage = config.test?.coverage as {
  include?: string[];
  exclude?: string[];
};
const include = coverage.include ?? [];
const exclude = coverage.exclude ?? [];

if (!existsSync(REPORT)) {
  console.error(
    "coverage/coverage-final.json not found; run the merge with --coverage.reporter=json.",
  );
  process.exit(1);
}

const reported = new Set(
  Object.keys(JSON.parse(readFileSync(REPORT, "utf8"))).map((file) =>
    path.relative(ROOT, file),
  ),
);

const missing = globSync(include, { cwd: ROOT })
  .filter((file) => !exclude.some((pattern) => path.matchesGlob(file, pattern)))
  .filter((file) => !reported.has(file))
  .sort();

if (missing.length > 0) {
  console.error("No test loads these files, so they have 0% coverage:");
  for (const file of missing) console.error(`  ${file}`);
  console.error(
    "Add tests for them, or add them to coverage.exclude in vitest.config.mts if they hold no runtime code.",
  );
  process.exit(1);
}

console.log(
  `Every covered source file is loaded by a test (${reported.size} files).`,
);
