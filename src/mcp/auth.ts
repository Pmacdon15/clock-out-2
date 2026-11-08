import { clerkClient } from "@clerk/nextjs/server";
import type { AuthInfo } from "@modelcontextprotocol/server";

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
