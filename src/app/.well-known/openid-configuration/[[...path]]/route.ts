import {
  clerkDiscoveryDocument,
  configuredIssuer,
  metadataPreflight,
  notConfigured,
} from "@/mcp/oauth-metadata";

/*
 * OpenID Connect discovery, copied from this app's Clerk instance, for MCP
 * clients that try it when RFC 8414 metadata isn't where they look first.
 */
export async function GET() {
  const issuer = configuredIssuer();
  if (!issuer) return notConfigured();
  return clerkDiscoveryDocument(issuer, "openid-configuration");
}

export const OPTIONS = metadataPreflight;
