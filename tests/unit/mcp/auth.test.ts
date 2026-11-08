import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockAuthenticateRequest = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({ authenticateRequest: mockAuthenticateRequest }),
}));

import { allowedOAuthClientIds, verifyMcpToken } from "@/mcp/auth";

const tokenState = (clientId: string | null) => ({
  toAuth: () => ({
    isAuthenticated: true,
    tokenType: "oauth_token",
    userId: "user_1",
    clientId,
    scopes: ["profile"],
  }),
});

describe("verifyMcpToken client allowlist", () => {
  const req = new Request("https://clockout.patmac.ca/api/mcp");

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockAuthenticateRequest.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("parses comma or whitespace separated client IDs", () => {
    expect(allowedOAuthClientIds(" a, b\nc ")).toEqual(
      new Set(["a", "b", "c"]),
    );
    expect(allowedOAuthClientIds("")).toBeNull();
    expect(allowedOAuthClientIds(undefined)).toBeNull();
  });

  it("accepts any client when no allowlist is configured", async () => {
    vi.stubEnv("MCP_ALLOWED_OAUTH_CLIENT_IDS", "");
    mockAuthenticateRequest.mockResolvedValueOnce(tokenState("client_x"));

    const info = await verifyMcpToken(req, "oat_1");
    expect(info?.extra?.userId).toBe("user_1");
  });

  it("accepts an allowlisted client", async () => {
    vi.stubEnv("MCP_ALLOWED_OAUTH_CLIENT_IDS", "client_claude,client_gemini");
    mockAuthenticateRequest.mockResolvedValueOnce(tokenState("client_gemini"));

    const info = await verifyMcpToken(req, "oat_1");
    expect(info?.clientId).toBe("client_gemini");
  });

  it("rejects a client that isn't on the allowlist, or has no client ID", async () => {
    vi.stubEnv("MCP_ALLOWED_OAUTH_CLIENT_IDS", "client_claude");
    mockAuthenticateRequest.mockResolvedValueOnce(tokenState("client_other"));
    expect(await verifyMcpToken(req, "oat_1")).toBeUndefined();

    mockAuthenticateRequest.mockResolvedValueOnce(tokenState(null));
    expect(await verifyMcpToken(req, "oat_2")).toBeUndefined();
  });
});
