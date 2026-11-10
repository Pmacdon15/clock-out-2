import type { AuthInfo } from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";
import { clientIp, mcpRoute } from "@/mcp/http";

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

  it("rate limits by client IP before verifying the token", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const verify = vi.fn(async () => authInfo);
    const preAuth = vi.fn(async () => ({
      ok: false as const,
      retryAfterSeconds: 7,
    }));
    const route = mcpRoute(vi.fn(), verify, undefined, preAuth);
    const req = post();
    req.headers.set("x-forwarded-for", "198.51.100.4, 10.0.0.2");

    const res = await route(req);

    expect(preAuth).toHaveBeenCalledWith("198.51.100.4");
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("7");
    expect(verify).not.toHaveBeenCalled();
  });

  it("skips the IP limit when no bearer token is sent", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const preAuth = vi.fn();
    const route = mcpRoute(vi.fn(), vi.fn(), undefined, preAuth);
    const res = await route(
      new Request("https://clockout.patmac.ca/api/mcp", { method: "POST" }),
    );
    expect(res.status).toBe(401);
    expect(preAuth).not.toHaveBeenCalled();
  });
});

describe("clientIp", () => {
  const withHeaders = (headers: Record<string, string>) =>
    new Request("https://clockout.patmac.ca/api/mcp", { headers });

  it("uses the first X-Forwarded-For hop, then X-Real-IP, else unknown", () => {
    expect(
      clientIp(withHeaders({ "x-forwarded-for": " 1.2.3.4 , 5.6.7.8" })),
    ).toBe("1.2.3.4");
    expect(clientIp(withHeaders({ "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9");
    expect(clientIp(withHeaders({}))).toBe("unknown");
  });
});
