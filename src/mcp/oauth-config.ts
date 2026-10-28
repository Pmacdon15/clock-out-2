/*
 * The OAuth settings MCP clients are told about, kept free of server-only
 * imports so UI components can read them if needed.
 */

/**
 * The scopes an MCP client should ask Clerk for. Clock Out only needs to know
 * who signed in (the token's user), so nothing beyond Clerk's basic profile,
 * plus `offline_access` so the client gets a refresh token and stays linked.
 * Google account linking (Gemini) needs that refresh token; Claude, Muse, and
 * ChatGPT use it too. All three are built-in Clerk scopes, so any client Clerk
 * registers (dynamically, by metadata document, or in the dashboard) can be
 * granted them.
 */
export const MCP_SCOPES = ["profile", "email", "offline_access"] as const;

/** The Clerk Frontend API URL (the OAuth issuer) encoded in a publishable key. */
export function clerkIssuer(publishableKey: string) {
  const encoded = publishableKey
    .replace(/^pk_(test|live)_/, "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const host = atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "="))
    .replace(/\$$/, "")
    .trim();
  return `https://${host}`;
}

export function configuredIssuer() {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  return publishableKey ? clerkIssuer(publishableKey) : null;
}
