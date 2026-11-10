import { clerkClient } from "@clerk/nextjs/server";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { mcpResourceUrl } from "@/mcp/http";

/*
 * Verifies who is calling the Clock Out MCP server using Clerk OAuth tokens.
 *
 * The AI app (Claude, Gemini, Muse, ChatGPT, ...) sends the user to sign in
 * to Clock Out with Clerk, and Clerk issues an OAuth access token (`oat_...`
 * or JWT). Clerk verifies the token directly via `authenticateRequest` with
 * `{ acceptsToken: "oauth_token" }` so case-insensitive `Bearer` schemes work
 * and the verified Clerk `userId` is placed in `extra.userId`.
 */
/** Whether this is the production deployment (not a preview or local dev). */
export function isProductionDeployment(): boolean {
  return process.env.VERCEL_ENV === "production";
}

/**
 * OAuth client IDs allowed to call Clock Out, from `MCP_ALLOWED_OAUTH_CLIENT_IDS`
 * (comma or whitespace separated). Clerk only grants its built-in scopes, so
 * a token's scopes can't tell a Clock Out connection apart from any other app
 * signed in with this Clerk instance. Setting the allowlist limits the MCP
 * server and the export endpoint to the clients you trust.
 *
 * Returns null when every client is accepted: `*`, or unset/empty outside
 * production. In production an unset or empty list fails closed (an empty
 * set, so every token is rejected) because dynamic client registration lets
 * anyone register a client on the Clerk instance.
 */
export function allowedOAuthClientIds(
  raw = process.env.MCP_ALLOWED_OAUTH_CLIENT_IDS,
  production = isProductionDeployment(),
): Set<string> | null {
  const ids = (raw ?? "")
    .split(/[\s,]+/)
    .map((id) => id.trim())
    .filter(Boolean);
  if (ids.includes("*")) return null;
  if (ids.length > 0) return new Set(ids);
  return production ? new Set() : null;
}

export type AudienceMode = "off" | "log" | "enforce";

/**
 * How strictly a token's audience (RFC 8707 `aud`) must name this MCP
 * server, from `MCP_TOKEN_AUDIENCE`: "enforce" rejects a token whose
 * audience is missing or different, "log" only warns (to see whether the
 * clients' tokens carry it before enforcing), and "off" skips the check.
 * Unset or unrecognised values default to "enforce" in production and
 * "off" elsewhere, so production only accepts tokens issued for this server
 * unless it is explicitly turned off. Each check is one extra Clerk Backend
 * API call.
 */
export function audienceMode(
  raw = process.env.MCP_TOKEN_AUDIENCE,
  production = isProductionDeployment(),
): AudienceMode {
  const mode = raw?.trim().toLowerCase();
  if (mode === "enforce" || mode === "log" || mode === "off") return mode;
  return production ? "enforce" : "off";
}

/** Whether the token was issued for this server, per {@link audienceMode}. */
async function audienceAllowed(
  client: Awaited<ReturnType<typeof clerkClient>>,
  req: Request,
  token: string,
): Promise<boolean> {
  const mode = audienceMode();
  if (mode === "off") return true;
  const audience = mcpResourceUrl(req);
  try {
    await client.idPOAuthAccessToken.verify(token, { audience });
    return true;
  } catch (error) {
    console.warn(
      `MCP: OAuth access token audience isn't ${audience} (${error instanceof Error ? error.message : "verification failed"})${mode === "log" ? "; allowed because MCP_TOKEN_AUDIENCE=log" : ""}`,
    );
    return mode === "log";
  }
}

/**
 * Whether a bearer token could be a Clerk OAuth access token: an opaque
 * `oat_...` token or a JWT. Anything else is refused without a Clerk call,
 * so junk tokens cost nothing.
 */
export function looksLikeOAuthToken(token: string): boolean {
  if (token.length > 4096) return false;
  return (
    /^oat_[A-Za-z0-9_-]+$/.test(token) ||
    /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)
  );
}

export async function verifyMcpToken(
  req: Request,
  token: string | undefined,
): Promise<AuthInfo | undefined> {
  if (!token) return undefined;
  if (!looksLikeOAuthToken(token)) {
    console.warn("MCP: refused a bearer token that isn't an OAuth token");
    return undefined;
  }
  return verifyOAuthToken(req, token);
}

async function verifyOAuthToken(
  req: Request,
  token: string,
): Promise<AuthInfo | undefined> {
  const client = await clerkClient();
  const state = await client.authenticateRequest(
    new Request(req.url, { headers: { authorization: `Bearer ${token}` } }),
    { acceptsToken: "oauth_token" },
  );
  const auth = state.toAuth();
  if (!auth?.isAuthenticated || auth.tokenType !== "oauth_token") {
    console.warn(
      `MCP: Clerk rejected an OAuth access token (${state.reason ?? "no reason given"}${state.message ? `: ${state.message}` : ""})`,
    );
    return undefined;
  }
  if (!auth.userId) {
    console.warn("MCP: an OAuth access token without a user was rejected");
    return undefined;
  }
  if (!(await audienceAllowed(client, req, token))) return undefined;
  const allowed = allowedOAuthClientIds();
  if (allowed && (!auth.clientId || !allowed.has(auth.clientId))) {
    console.warn(
      allowed.size === 0
        ? "MCP: rejected an OAuth access token because MCP_ALLOWED_OAUTH_CLIENT_IDS is not set in production (set it to your clients' IDs, or * to accept any client)"
        : `MCP: rejected an OAuth access token from client ${auth.clientId ?? "(none)"}, which isn't in MCP_ALLOWED_OAUTH_CLIENT_IDS`,
    );
    return undefined;
  }
  return {
    token,
    clientId: auth.clientId ?? "oauth",
    scopes: auth.scopes ?? [],
    extra: { userId: auth.userId, via: "oauth", verifiedBy: "clerk" },
  };
}
