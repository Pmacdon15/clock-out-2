import type { AuthInfo } from "@modelcontextprotocol/server";
import { getPublicOrigin } from "mcp-handler";
import { MCP_SCOPES } from "@/mcp/oauth-config";

export { MCP_SCOPES };

/*
 * The HTTP edge of the MCP server, written to the MCP and OAuth specs rather
 * than to one AI app's habits, so Claude, ChatGPT, Gemini, Muse and any other
 * client connect the same way:
 *
 * - Bearer auth (RFC 6750): the scheme is case-insensitive, a missing token
 *   gets a plain challenge, a rejected one `error="invalid_token"`, and both
 *   point at the protected resource metadata (RFC 9728) for this endpoint.
 * - CORS on every response, including the 401 and the OPTIONS preflight, with
 *   `WWW-Authenticate` and `Mcp-Session-Id` exposed, for browser-based clients.
 * - Streamable HTTP for clients that only accept `application/json`: the
 *   server is stateless, so every exchange ends with its response and can be
 *   answered as a plain JSON body instead of a one-shot event stream.
 */

export const MCP_PATH = "/api/mcp";
export const PROTECTED_RESOURCE_METADATA_PATH =
  "/.well-known/oauth-protected-resource";

/**
 * The origin MCP clients connect to. In production that's always the
 * project's production domain (clockout.patmac.ca), even when the request came
 * in on a per-deployment *.vercel.app host, so the `resource` an
 * authorization server binds tokens to never changes between deployments.
 * Previews and local runs answer with the host that was used, so a client
 * pointed at a preview sees metadata that matches the URL it was given.
 */
export function publicOrigin(req: Request) {
  const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (process.env.VERCEL_ENV === "production" && productionHost) {
    return `https://${productionHost.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  }
  return getPublicOrigin(req);
}

/** The canonical URL of the MCP server, as clients connect to it. */
export function mcpResourceUrl(req: Request) {
  return `${publicOrigin(req)}${MCP_PATH}`;
}

/** Where this endpoint's protected resource metadata lives (RFC 9728 §3.1). */
export function resourceMetadataUrl(req: Request) {
  return `${publicOrigin(req)}${PROTECTED_RESOURCE_METADATA_PATH}${MCP_PATH}`;
}

const ALLOWED_HEADERS = [
  "Authorization",
  "Content-Type",
  "Accept",
  "Mcp-Session-Id",
  "Mcp-Protocol-Version",
  "Mcp-Method",
  "Mcp-Name",
  "Last-Event-ID",
].join(", ");

export const MCP_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": ALLOWED_HEADERS,
  "Access-Control-Expose-Headers":
    "WWW-Authenticate, Mcp-Session-Id, Mcp-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

/** The response with CORS headers added. Auth is a bearer token, never a cookie, so any origin may call. */
export function withCors(response: Response) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(MCP_CORS_HEADERS)) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** The CORS preflight answer. Echoes the requested headers, so a client's own extra headers pass too. */
export function preflight(req: Request) {
  const response = withCors(new Response(null, { status: 204 }));
  const requested = req.headers.get("access-control-request-headers");
  if (requested) {
    response.headers.set("Access-Control-Allow-Headers", requested);
    response.headers.set("Vary", "Access-Control-Request-Headers");
  }
  return response;
}

/**
 * The bearer token from `Authorization`, regardless of how the client cased
 * "Bearer" (RFC 6750 §2.1 / RFC 9110 §11.1: auth-scheme is case-insensitive).
 */
export function bearerToken(req: Request) {
  const header = req.headers.get("authorization")?.trim();
  const match = header?.match(/^bearer\s+(\S+)$/i);
  return match?.[1];
}

/**
 * 401 with `WWW-Authenticate: Bearer`. A missing token gets a plain challenge
 * (RFC 6750 §3.1: no error code when nothing was sent); a rejected one gets
 * `error="invalid_token"` with a short reason, which tells the
 * client to refresh or sign in again. Both name the resource metadata
 * (RFC 9728 §5.1) and the scopes to ask for (RFC 6750 §3, which the MCP
 * authorization spec has clients prefer over guessing).
 */
export function unauthorized(req: Request, invalidTokenReason?: string) {
  const params = [
    ...(invalidTokenReason
      ? [
          'error="invalid_token"',
          `error_description="${invalidTokenReason.replace(/["\\]/g, "")}"`,
        ]
      : []),
    `resource_metadata="${resourceMetadataUrl(req)}"`,
    `scope="${MCP_SCOPES.join(" ")}"`,
  ];
  return Response.json(
    invalidTokenReason
      ? { error: "invalid_token", error_description: invalidTokenReason }
      : {
          error: "unauthorized",
          error_description: "Sign in to Clock Out to use this connector.",
        },
    {
      status: 401,
      headers: { "WWW-Authenticate": `Bearer ${params.join(", ")}` },
    },
  );
}

const STREAMABLE_ACCEPT = "application/json, text/event-stream";

/**
 * Streamable HTTP requires a POST to accept both JSON and event streams. A
 * client that sends only `application/json` (or `*\/*`, or nothing) is still
 * served: the request goes in with the full Accept header, and the answer
 * comes back as plain JSON.
 */
async function negotiate(req: Request) {
  if (req.method !== "POST") return { request: req, jsonOnly: false };
  const accept = (req.headers.get("accept") ?? "").toLowerCase();
  const takesStream = accept.includes("text/event-stream");
  if (takesStream && accept.includes("application/json")) {
    return { request: req, jsonOnly: false };
  }
  const headers = new Headers(req.headers);
  headers.set("accept", STREAMABLE_ACCEPT);
  const request = new Request(req.url, {
    method: req.method,
    headers,
    body: await req.arrayBuffer(),
    signal: req.signal,
  });
  return { request, jsonOnly: !takesStream };
}

/** The JSON-RPC messages in a finished event stream. */
export function messagesFromEventStream(stream: string): unknown[] {
  return stream
    .split(/\r?\n\r?\n/)
    .map((event) =>
      event
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).replace(/^ /, ""))
        .join("\n"),
    )
    .filter((data) => data.length > 0)
    .map((data) => JSON.parse(data));
}

/** An event-stream answer as a plain JSON one: the message, or an array of them for a batch. */
async function asJson(response: Response) {
  const type = response.headers.get("content-type") ?? "";
  if (!type.startsWith("text/event-stream")) return response;
  const messages = messagesFromEventStream(await response.text());
  const headers = new Headers(response.headers);
  for (const name of ["content-type", "cache-control", "connection"]) {
    headers.delete(name);
  }
  if (messages.length === 0) {
    return new Response(null, { status: 202, headers });
  }
  headers.set("content-type", "application/json");
  return new Response(
    JSON.stringify(messages.length === 1 ? messages[0] : messages),
    { status: response.status, headers },
  );
}

export type McpHandler = (req: Request) => Promise<Response>;
export type VerifyToken = (
  req: Request,
  token: string,
) => Promise<AuthInfo | undefined>;

/**
 * Which app is calling, for the logs: its User-Agent, trimmed. Enough to tell
 * Gemini's linking attempts from Claude's or Muse's when one of them can't
 * connect. Never the token.
 */
export function callerLabel(req: Request) {
  const agent = req.headers.get("user-agent")?.replace(/\s+/g, " ").trim();
  return agent ? agent.slice(0, 120) : "no user agent";
}

/**
 * The MCP route: CORS, bearer auth, then the MCP handler with the verified
 * auth on `req.auth`, where mcp-handler reads it.
 */
export function mcpRoute(handler: McpHandler, verifyToken: VerifyToken) {
  return async function route(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") return preflight(req);

    const token = bearerToken(req);
    if (!token) {
      console.info(
        `MCP: ${req.method} without a bearer token, asked to sign in (${callerLabel(req)})`,
      );
      return withCors(unauthorized(req));
    }

    let authInfo: AuthInfo | undefined;
    try {
      authInfo = await verifyToken(req, token);
    } catch (error) {
      console.error("MCP: couldn't verify the access token", error);
    }
    if (!authInfo) {
      console.warn(`MCP: access token refused (${callerLabel(req)})`);
      return withCors(
        unauthorized(req, "The access token is invalid or has expired."),
      );
    }
    if (authInfo.expiresAt && authInfo.expiresAt < Date.now() / 1000) {
      return withCors(unauthorized(req, "The access token has expired."));
    }

    const { request, jsonOnly } = await negotiate(req);
    Object.assign(request, { auth: authInfo });
    const response = await handler(request);
    return withCors(jsonOnly ? await asJson(response) : response);
  };
}
