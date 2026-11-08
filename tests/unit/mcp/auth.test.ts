import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockAuthenticateRequest = vi.fn();
const mockVerifyAccessToken = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({
    authenticateRequest: mockAuthenticateRequest,
    idPOAuthAccessToken: { verify: mockVerifyAccessToken },
  }),
}));

import {
  allowedOAuthClientIds,
  audienceMode,
  verifyMcpToken,
} from "@/mcp/auth";
import { mcpResourceUrl } from "@/mcp/http";

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

describe("verifyMcpToken audience check", () => {
  const req = new Request("https://clockout.patmac.ca/api/mcp");

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockAuthenticateRequest.mockReset();
    mockVerifyAccessToken.mockReset();
    mockAuthenticateRequest.mockResolvedValue(tokenState("client_x"));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("reads the mode from MCP_TOKEN_AUDIENCE", () => {
    expect(audienceMode(" Enforce ")).toBe("enforce");
    expect(audienceMode("log")).toBe("log");
    expect(audienceMode("yes")).toBe("off");
    expect(audienceMode(undefined)).toBe("off");
  });

  it("skips the extra Clerk call when off", async () => {
    vi.stubEnv("MCP_TOKEN_AUDIENCE", "");
    expect(await verifyMcpToken(req, "oat_1")).toBeDefined();
    expect(mockVerifyAccessToken).not.toHaveBeenCalled();
  });

  it("accepts a token issued for this server when enforcing", async () => {
    vi.stubEnv("MCP_TOKEN_AUDIENCE", "enforce");
    mockVerifyAccessToken.mockResolvedValueOnce({ aud: [mcpResourceUrl(req)] });
    expect(await verifyMcpToken(req, "oat_1")).toBeDefined();
    expect(mockVerifyAccessToken).toHaveBeenCalledWith("oat_1", {
      audience: mcpResourceUrl(req),
    });
  });

  it("rejects a token for another audience when enforcing", async () => {
    vi.stubEnv("MCP_TOKEN_AUDIENCE", "enforce");
    mockVerifyAccessToken.mockRejectedValueOnce(new Error("aud mismatch"));
    expect(await verifyMcpToken(req, "oat_1")).toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("aud mismatch"),
    );
  });

  it("only warns in log mode", async () => {
    vi.stubEnv("MCP_TOKEN_AUDIENCE", "log");
    mockVerifyAccessToken.mockRejectedValueOnce("nope");
    expect(await verifyMcpToken(req, "oat_1")).toBeDefined();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("MCP_TOKEN_AUDIENCE=log"),
    );
  });
});
