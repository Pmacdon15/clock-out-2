import { createMcpHandler } from "mcp-handler";
import { checkRateLimit, MCP_REQUEST_LIMIT } from "@/lib/rate-limit";
import { verifyMcpToken } from "@/mcp/auth";
import { mcpRoute } from "@/mcp/http";
import { registerClockOutPrompts } from "@/mcp/prompts";
import { registerClockOutTools, SERVER_OPTIONS } from "@/mcp/server";

/*
 * /api/mcp — the Clock Out MCP server.
 *
 * Auth is a Clerk OAuth access token in `Authorization: Bearer ...`. When
 * there isn't one, the 401 points the client at
 * `/.well-known/oauth-protected-resource/api/mcp`, which sends it to Clerk to
 * sign the user in. Every tool runs only for that token's verified Clerk user.
 * Prompts (`src/mcp/prompts.ts`) only build instructions and touch no data.
 */
const handler = createMcpHandler((server) => {
  registerClockOutTools(server);
  registerClockOutPrompts(server);
}, SERVER_OPTIONS);
const route = mcpRoute(handler, verifyMcpToken, (userId) =>
  checkRateLimit(MCP_REQUEST_LIMIT, userId),
);

export { route as DELETE, route as GET, route as OPTIONS, route as POST };
