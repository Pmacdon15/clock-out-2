import { createMcpHandler } from "mcp-handler";
import { verifyMcpToken } from "@/mcp/auth";
import { mcpRoute } from "@/mcp/http";
import { registerClockOutTools, SERVER_OPTIONS } from "@/mcp/server";

/*
 * /api/mcp — the Clock Out MCP server.
 *
 * Auth is a Clerk OAuth access token in `Authorization: Bearer ...`. When
 * there isn't one, the 401 points the client at
 * `/.well-known/oauth-protected-resource/api/mcp`, which sends it to Clerk to
 * sign the user in. Every tool runs only for that token's verified Clerk user.
 */
const handler = createMcpHandler(registerClockOutTools, SERVER_OPTIONS);
const route = mcpRoute(handler, verifyMcpToken);

export { route as DELETE, route as GET, route as OPTIONS, route as POST };
