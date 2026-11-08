import type { AuthInfo } from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";
import { mcpRoute } from "@/mcp/http";

const authInfo: AuthInfo = {
  token: "oat_1",
  clientId: "client",
  scopes: [],
  extra: { userId: "user_1" },
};

const post = () =>
  new Request("https://clockout.patmac.ca/api/mcp", {
    method: "POST",
    headers: {
      authorization: "Bearer oat_1",
      accept: "application/json, text/event-stream",
    },
    body: "{}",
  });

describe("mcpRoute rate limiting", () => {
  it("answers 429 with Retry-After and never calls the handler when limited", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const handler = vi.fn(async () => new Response("ok"));
    const limit = vi.fn(async () => ({
      ok: false as const,
      retryAfterSeconds: 42,
    }));
    const route = mcpRoute(handler, async () => authInfo, limit);

    const res = await route(post());

    expect(limit).toHaveBeenCalledWith("user_1");
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeTruthy();
    await expect(res.json()).resolves.toMatchObject({ error: "rate_limited" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("passes the request on when under the limit", async () => {
    const handler = vi.fn(async () => new Response("ok"));
    const route = mcpRoute(
      handler,
      async () => authInfo,
      async () => ({
        ok: true as const,
      }),
    );
    const res = await route(post());
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("checks the limit only after the token is verified", async () => {
    const limit = vi.fn();
    const route = mcpRoute(vi.fn(), async () => undefined, limit);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await route(post());
    expect(res.status).toBe(401);
    expect(limit).not.toHaveBeenCalled();
  });
});
