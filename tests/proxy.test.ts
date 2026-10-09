// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({
  // Hand back the route handler itself so the test can call it directly.
  clerkMiddleware: (handler: unknown) => handler,
  createRouteMatcher: (patterns: string[]) => (req: Request) =>
    patterns.some((pattern) =>
      new RegExp(`^${pattern}$`).test(new URL(req.url).pathname),
    ),
}));

import { config, proxy } from "@/proxy";

type Handler = (
  auth: { protect: () => Promise<void> },
  req: Request,
) => Promise<void>;

const run = async (path: string) => {
  const protect = vi.fn(async () => {});
  await (proxy as unknown as Handler)(
    { protect },
    new Request(`https://example.test${path}`),
  );
  return protect;
};

describe("proxy", () => {
  it("requires sign-in for dashboard routes", async () => {
    expect(await run("/dashboard")).toHaveBeenCalledTimes(1);
    expect(await run("/dashboard/settings")).toHaveBeenCalledTimes(1);
  });

  it("leaves other routes public", async () => {
    expect(await run("/")).not.toHaveBeenCalled();
    expect(await run("/plans")).not.toHaveBeenCalled();
  });

  it("runs on pages and API routes but skips static assets", () => {
    const [pages, api] = config.matcher.map((m) => new RegExp(`^${m}$`));
    expect(pages.test("/")).toBe(true);
    expect(pages.test("/plans")).toBe(true);
    expect(pages.test("/_next/static/chunk.js")).toBe(false);
    expect(pages.test("/logo.png")).toBe(false);
    expect(pages.test("/data.json")).toBe(true);
    expect(api.test("/api/cron/weekly-report")).toBe(true);
    expect(api.test("/trpc/thing")).toBe(true);
  });
});
