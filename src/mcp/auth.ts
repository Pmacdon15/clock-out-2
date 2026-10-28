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
  return {
    token,
    clientId: auth.clientId ?? "oauth",
    scopes: auth.scopes ?? [],
    extra: { userId: auth.userId, via: "oauth", verifiedBy: "clerk" },
  };
}
