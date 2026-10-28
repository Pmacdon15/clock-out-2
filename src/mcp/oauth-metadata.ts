import { mcpResourceUrl, publicOrigin } from "@/mcp/http";
import { MCP_SCOPES } from "@/mcp/oauth-config";

export { clerkIssuer, configuredIssuer } from "@/mcp/oauth-config";

/*
 * OAuth discovery documents for MCP clients. The authorization server is this
 * app's Clerk instance (its Frontend API, which has dynamic client
 * registration and Client ID Metadata Documents turned on); Clock Out is the
 * protected resource.
 */

export const METADATA_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

/** CORS preflight for the discovery documents, which browser-based clients fetch too. */
export function metadataPreflight() {
  return new Response(null, { status: 204, headers: METADATA_CORS_HEADERS });
}

/**
 * Protected Resource Metadata (RFC 9728) for the MCP endpoint.
 * `resource` is the exact URL clients connect to (and send as the RFC 8707
 * resource indicator), `authorization_servers` is Clerk, `scopes_supported`
 * is what a client should ask for (`offline_access` gets the refresh token
 * Google/Gemini account linking requires), and `logo_uri` points to Clock Out's
 * own icon so clients don't fall back to the root patmac.ca favicon.
 */
export function protectedResourceMetadata(req: Request, issuer: string) {
  const origin = publicOrigin(req);
  return {
    resource: mcpResourceUrl(req),
    authorization_servers: [issuer],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "Clock Out",
    resource_documentation: origin,
    logo_uri: `${origin}/icon.svg`,
  };
}

export function notConfigured() {
  return Response.json(
    { error: "Sign-in isn't configured for this deployment." },
    { status: 503, headers: METADATA_CORS_HEADERS },
  );
}

/**
 * One of Clerk's discovery documents, served from this origin for clients
 * that look for the authorization server on the MCP server's own domain
 * (the 2025-03-26 MCP spec did). Its `issuer` stays Clerk's, which is where
 * tokens come from.
 */
export async function clerkDiscoveryDocument(
  issuer: string,
  document: "oauth-authorization-server" | "openid-configuration",
) {
  try {
    const res = await fetch(`${issuer}/.well-known/${document}`, {
      signal: AbortSignal.timeout(10_000),
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Clerk answered ${res.status}`);
    return Response.json(await res.json(), {
      headers: { ...METADATA_CORS_HEADERS, "Cache-Control": "max-age=3600" },
    });
  } catch (error) {
    console.error(`Couldn't fetch Clerk's ${document} document`, error);
    return Response.json(
      { error: "The sign-in server didn't answer. Try again shortly." },
      { status: 502, headers: METADATA_CORS_HEADERS },
    );
  }
}
