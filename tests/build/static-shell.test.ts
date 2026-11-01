import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Checks the output of `next build` (run `bun run test:build`). Every page the
 * build produced is read from its manifests, so new pages are covered without
 * touching this file.
 *
 * With Cache Components, `next build` sorts pages into:
 *   ○ Static   the whole page is prerendered
 *   ◐ Partial  a static HTML shell is prerendered; small holes stream in
 *   ƒ Dynamic  the prerender came out empty, so the server renders it all
 *
 * No page may be ƒ, and the public marketing/legal pages must stay ○.
 */

const ROOT = path.resolve(__dirname, "../..");
const NEXT = path.join(ROOT, ".next");
const MANIFEST = path.join(NEXT, "prerender-manifest.json");

type Prerender = {
  routeType?: "page" | "route" | "shell";
  response?: "empty" | "initial" | "complete";
  compute?: "static" | "resuming" | "blocking";
};

const built = existsSync(MANIFEST);
const read = <T>(file: string): T =>
  JSON.parse(readFileSync(path.join(NEXT, file), "utf8"));

/** The page's ○/◐/ƒ symbol, the way `next build` prints it. */
function symbolFor(entry: Prerender | undefined) {
  if (!entry) return "ƒ";
  if (entry.response === "empty" || entry.compute === "blocking") return "ƒ";
  return entry.compute === "static" ? "○" : "◐";
}

describe.skipIf(!built && !process.env.REQUIRE_BUILD)(
  "next build output",
  () => {
    it("has a build to check", () => {
      expect(built, "run `next build` before `bun run test:build`").toBe(true);
    });

    if (!built) return;

    const manifest = read<{
      routes: Record<string, Prerender>;
      dynamicRoutes: Record<string, Prerender>;
    }>("prerender-manifest.json");
    const appPaths = read<Record<string, string>>(
      "app-path-routes-manifest.json",
    );

    // Every App Router page the build knows about, e.g. "/plans/page" → "/plans".
    const pages = Object.entries(appPaths)
      .filter(([entry]) => entry.endsWith("/page"))
      .map(([, route]) => route)
      .filter((route) => route !== "/_global-error");

    const entryFor = (route: string) =>
      manifest.routes[route] ?? manifest.dynamicRoutes[route];

    it("built the app's pages", () => {
      for (const route of ["/", "/plans", "/privacy", "/tos"]) {
        expect(pages).toContain(route);
      }
    });

    it.each(pages)("%s has a static shell (not ƒ)", (route) => {
      const entry = entryFor(route);
      expect(entry, `${route} wasn't prerendered at all`).toBeDefined();
      expect(symbolFor(entry), `${route} came out fully dynamic`).not.toBe("ƒ");
    });

    // The prerendered HTML for a route with no dynamic segments.
    const htmlFor = (route: string) => {
      const file = path.join(
        NEXT,
        "server/app",
        `${route === "/" ? "index" : route.slice(1)}.html`,
      );
      return existsSync(file) ? readFileSync(file, "utf8") : null;
    };

    const partialPages = pages.filter(
      (route) =>
        !route.includes("[") &&
        !route.startsWith("/_") &&
        entryFor(route)?.compute === "resuming",
    );

    it.each(partialPages)(
      "%s puts its heading in the static shell, not just a loading state",
      (route) => {
        const html = htmlFor(route);
        expect(html, `${route} has no prerendered HTML`).not.toBeNull();
        expect(html).toMatch(/<h1[\s>]/);
      },
    );

    it("keeps the public pages fully static", () => {
      for (const route of ["/plans", "/privacy", "/tos"]) {
        expect(symbolFor(manifest.routes[route]), route).toBe("○");
      }
    });

    it("prerenders the PWA manifest at build time", () => {
      // A request-time read here would make every install fetch hit the server.
      expect(manifest.routes["/manifest.webmanifest"]).toBeDefined();
    });
  },
);
