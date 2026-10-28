import {
  configuredIssuer,
  METADATA_CORS_HEADERS,
  metadataPreflight,
  notConfigured,
  protectedResourceMetadata,
} from "@/mcp/oauth-metadata";

/*
 * OAuth Protected Resource Metadata (RFC 9728) for the MCP server: tells an
 * MCP client that /api/mcp is protected by this app's Clerk instance, where
 * the user signs in. Served at /.well-known/oauth-protected-resource/api/mcp
 * (where the 401's WWW-Authenticate header points) and at
 * /.well-known/oauth-protected-resource, the two places clients look.
 */
export function GET(req: Request) {
  const issuer = configuredIssuer();
  if (!issuer) return notConfigured();
  return Response.json(protectedResourceMetadata(req, issuer), {
    headers: { ...METADATA_CORS_HEADERS, "Cache-Control": "max-age=3600" },
  });
}

export const OPTIONS = metadataPreflight;
