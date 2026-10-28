import {
  clerkDiscoveryDocument,
  configuredIssuer,
  metadataPreflight,
  notConfigured,
} from "@/mcp/oauth-metadata";

/*
 * OAuth Authorization Server Metadata (RFC 8414), copied from this app's Clerk
 * instance. Current MCP clients find Clerk through the protected resource
 * metadata instead; older ones look for this document on the MCP server's own
 * domain, either at the root or with the endpoint's path appended
 * (/.well-known/oauth-authorization-server/api/mcp).
 */
export async function GET() {
  const issuer = configuredIssuer();
  if (!issuer) return notConfigured();
  return clerkDiscoveryDocument(issuer, "oauth-authorization-server");
}

export const OPTIONS = metadataPreflight;
