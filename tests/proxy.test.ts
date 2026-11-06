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

type Auth = (() => Promise<{ userId: string | null }>) & {
  protect: () => Promise<void>;
};
type Handler = (auth: Auth, req: Request) => Promise<Response | undefined>;

const run = async (path: string, userId: string | null = null) => {
  const protect = vi.fn(async () => {});
  const auth = Object.assign(
    vi.fn(async () => ({ userId })),
    { protect },
  );
  const response = await (proxy as unknown as Handler)(
    auth,
    new Request(`https://example.test${path}`),
  );
  return { auth, protect, response };
};

describe("proxy", () => {
  it("requires sign-in for every dashboard page but the time clock", async () => {
    for (const path of [
      "/hours",
      "/hours?timeframe=week",
      "/notifications",
      "/schedule",
      "/time-off",
      "/settings",
    ]) {
      const { protect, response } = await run(path);
      expect(protect, path).toHaveBeenCalledTimes(1);
      expect(response, path).toBeUndefined();
    }
  });

  it("shows signed-out visitors the welcome page at /", async () => {
    const { response, protect } = await run("/");
    expect(protect).not.toHaveBeenCalled();
    expect(response?.headers.get("x-middleware-rewrite")).toBe(
      "https://example.test/welcome",
    );
  });

  it("shows members the time clock at /", async () => {
    const { response } = await run("/", "user_1");
    expect(response).toBeUndefined();
  });

  it("redirects old tab links to their page", async () => {
    const { response, auth } = await run("/?defaultTab=view&timeframe=week");
    expect(response?.status).toBe(307);
    expect(response?.headers.get("location")).toBe(
      "https://example.test/hours?timeframe=week",
    );
    expect(auth).not.toHaveBeenCalled();
  });

  it("leaves other routes public", async () => {
    for (const path of ["/plans", "/welcome", "/privacy"]) {
      const { auth, protect, response } = await run(path);
      expect(protect, path).not.toHaveBeenCalled();
      expect(auth, path).not.toHaveBeenCalled();
      expect(response, path).toBeUndefined();
    }
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
