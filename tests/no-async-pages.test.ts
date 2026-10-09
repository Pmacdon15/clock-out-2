import { describe, expect, test } from "bun:test";
import {
  displayPath,
  findPageFiles,
  findRouteFiles,
  inspectDefaultExport,
  readSource,
} from "./helpers/route-files";

// Pages and other route components in this app must stay synchronous:
// data is passed down as promises and awaited inside <Suspense> boundaries,
// so the shell can render immediately. Files are discovered automatically,
// so any new route under src/app is covered without editing this test.

const routeFiles = findRouteFiles();
const pageFiles = findPageFiles();

describe("route discovery", () => {
  test("finds at least one page under src/app", () => {
    expect(pageFiles.length).toBeGreaterThan(0);
  });

  test("finds the root page", () => {
    expect(pageFiles.map((f) => displayPath(f))).toContain("src/app/page.tsx");
  });
});

describe("route components are not async", () => {
  test.each(routeFiles.map((file) => [displayPath(file), file]))(
    "%s",
    (_label, file) => {
      const info = inspectDefaultExport(readSource(file));

      if (!info.found) {
        throw new Error(
          `${displayPath(file)} has no default export the checker recognises. ` +
            "Export the component with `export default function Name()`.",
        );
      }

      if (info.isAsync) {
        throw new Error(
          `${displayPath(file)} exports an async component${info.name ? ` (${info.name})` : ""}. ` +
            "Keep it synchronous and pass promises to children inside <Suspense> instead of awaiting here.",
        );
      }

      expect(info.isAsync).toBe(false);
    },
  );
});

describe("inspectDefaultExport", () => {
  const asyncCases: Record<string, string> = {
    "async function declaration":
      "export default async function Page() { return null; }",
    "async arrow": "export default async () => null;",
    "async function referenced later":
      "async function Page() { return null; }\nexport default Page;",
    "async const referenced later":
      "const Page = async (props: Props) => null;\nexport default Page;",
    "async export specifier":
      "async function Page() { return null; }\nexport { Page as default };",
  };

  const syncCases: Record<string, string> = {
    "sync function declaration":
      "export default function Page() { return null; }",
    "sync arrow": "export default () => null;",
    "sync function referenced later":
      "function Page() { return null; }\nexport default Page;",
    "sync const referenced later":
      "const Page = (props: Props) => null;\nexport default Page;",
    "async helper alongside sync page":
      "async function load() {}\nexport default function Page() { return null; }",
    "commented-out async page":
      "// export default async function Old() {}\nexport default function Page() { return null; }",
    "use client page": '"use client";\nexport default function Page() { return null; }',
  };

  for (const [name, source] of Object.entries(asyncCases)) {
    test(`flags ${name}`, () => {
      expect(inspectDefaultExport(source)).toMatchObject({
        found: true,
        isAsync: true,
      });
    });
  }

  for (const [name, source] of Object.entries(syncCases)) {
    test(`allows ${name}`, () => {
      expect(inspectDefaultExport(source)).toMatchObject({
        found: true,
        isAsync: false,
      });
    });
  }

  test("reports a missing default export", () => {
    expect(inspectDefaultExport("export const x = 1;")).toEqual({
      found: false,
    });
  });
});
