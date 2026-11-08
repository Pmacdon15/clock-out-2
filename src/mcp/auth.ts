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
/**
 * OAuth client IDs allowed to call Clock Out, from `MCP_ALLOWED_OAUTH_CLIENT_IDS`
 * (comma or whitespace separated). Clerk only grants its built-in scopes, so
 * a token's scopes can't tell a Clock Out connection apart from any other app
 * signed in with this Clerk instance. Setting the allowlist limits the MCP
 * server and the export endpoint to the clients you trust. Unset or empty
 * keeps today's behaviour (every client Clerk registered is accepted).
 */
export function allowedOAuthClientIds(
  raw = process.env.MCP_ALLOWED_OAUTH_CLIENT_IDS,
): Set<string> | null {
  const ids = (raw ?? "")
    .split(/[\s,]+/)
    .map((id) => id.trim())
    .filter(Boolean);
  return ids.length > 0 ? new Set(ids) : null;
}

export type AudienceMode = "off" | "log" | "enforce";

/**
 * How strictly a token's audience (RFC 8707 `aud`) must name this MCP
 * server, from `MCP_TOKEN_AUDIENCE`: "enforce" rejects a token whose
 * audience is missing or different, "log" only warns (to see whether the
 * clients' tokens carry it before enforcing), and anything else skips the
 * check. Each check is one extra Clerk Backend API call.
 */
export function audienceMode(
  raw = process.env.MCP_TOKEN_AUDIENCE,
): AudienceMode {
  const mode = raw?.trim().toLowerCase();
  return mode === "enforce" || mode === "log" ? mode : "off";
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

export async function verifyMcpToken(
  req: Request,
  token: string | undefined,
): Promise<AuthInfo | undefined> {
  if (!token) return undefined;
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
      `MCP: rejected an OAuth access token from client ${auth.clientId ?? "(none)"}, which isn't in MCP_ALLOWED_OAUTH_CLIENT_IDS`,
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
