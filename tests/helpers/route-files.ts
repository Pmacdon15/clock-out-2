import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { Glob } from "bun";

export const APP_DIR = join(import.meta.dir, "..", "..", "src", "app");

/**
 * Next.js route-segment files that render a React component.
 * Any file with one of these names anywhere under src/app is checked,
 * so new routes are picked up automatically.
 */
export const ROUTE_COMPONENT_FILES = [
  "page",
  "layout",
  "template",
  "default",
  "loading",
  "error",
  "global-error",
  "not-found",
] as const;

const EXTENSIONS = ["tsx", "ts", "jsx", "js"];

/** Finds every route component file under src/app (e.g. app/plans/page.tsx). */
export function findRouteFiles(appDir = APP_DIR): string[] {
  const pattern = `**/{${ROUTE_COMPONENT_FILES.join(",")}}.{${EXTENSIONS.join(",")}}`;
  const glob = new Glob(pattern);
  return [...glob.scanSync({ cwd: appDir })]
    .map((file) => join(appDir, file))
    .sort();
}

/** Finds only page files (page.tsx etc.) under src/app. */
export function findPageFiles(appDir = APP_DIR): string[] {
  return findRouteFiles(appDir).filter((file) =>
    /(^|[/\\])page\.[jt]sx?$/.test(file),
  );
}

export function displayPath(file: string, appDir = APP_DIR): string {
  return `src/app/${relative(appDir, file).replaceAll("\\", "/")}`;
}

/** Removes // and /* *\/ comments so commented-out code is ignored. */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:\\])\/\/.*$/gm, "$1");
}

export type DefaultExportInfo =
  | { found: false }
  | { found: true; isAsync: boolean; name?: string };

const escape = (s: string) => s.replace(/[$]/g, "\\$");

/**
 * Inspects a module's source and reports whether its default export is an
 * async function. Handles:
 *   export default async function Page() {}
 *   export default async () => {}
 *   export default function Page() {}
 *   async function Page() {} ... export default Page;
 *   const Page = async () => {} ... export default Page;
 *   export { Page as default };
 */
export function inspectDefaultExport(source: string): DefaultExportInfo {
  const code = stripComments(source);

  // Inline default export: `export default [async] function|(...)=>`
  const inline = code.match(
    /export\s+default\s+(async\s+)?(function\b|\(|[A-Za-z_$][\w$]*\s*=>)/,
  );
  if (inline) {
    return { found: true, isAsync: Boolean(inline[1]) };
  }

  // Named default export: `export default Name;` or `export { Name as default }`
  const named =
    code.match(/export\s+default\s+([A-Za-z_$][\w$]*)\s*;?\s*$/m) ??
    code.match(/export\s*\{[^}]*?\b([A-Za-z_$][\w$]*)\s+as\s+default\b[^}]*\}/);
  if (!named) {
    return { found: false };
  }

  const name = named[1];
  const id = escape(name);
  const asyncDecl = new RegExp(`\\basync\\s+function\\s*\\*?\\s*${id}\\b`);
  const asyncExpr = new RegExp(
    `\\b(?:const|let|var)\\s+${id}\\b[^=]*=\\s*async\\b`,
  );
  return {
    found: true,
    isAsync: asyncDecl.test(code) || asyncExpr.test(code),
    name,
  };
}

export function readSource(file: string): string {
  return readFileSync(file, "utf8");
}
