import { sql } from "./db";

/*
 * Fixed-window rate limits kept in Postgres, for the actions that spend
 * money or third-party quota (Geoapify, SES, push, the MCP endpoint's Clerk
 * calls). Postgres is the one store every serverless instance shares, so a
 * caller can't dodge a limit by landing on a fresh instance. Each check is
 * one upsert on a small table keyed by limit and caller.
 */

export type RateLimit = {
  /** Names the limit in the key, e.g. "geocode". */
  name: string;
  /** Requests allowed per window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
};

export type RateLimitResult =
  | { ok: true; remaining: number }
  | { ok: false; retryAfterSeconds: number };

/** Address search and lookup while setting up work sites (Geoapify). */
export const GEOCODE_LIMIT: RateLimit = {
  name: "geocode",
  limit: 60,
  windowSeconds: 10 * 60,
};
/** "Send a test notification" (SES email + push). */
export const TEST_NOTIFICATION_LIMIT: RateLimit = {
  name: "test-notification",
  limit: 5,
  windowSeconds: 60 * 60,
};
/** "Send this week's report now" (SES email to every admin). */
export const TEST_REPORT_LIMIT: RateLimit = {
  name: "test-report",
  limit: 3,
  windowSeconds: 60 * 60,
};
/** MCP requests per signed-in user (each one makes several Clerk calls). */
export const MCP_REQUEST_LIMIT: RateLimit = {
  name: "mcp",
  limit: 120,
  windowSeconds: 60,
};

let tableReady: Promise<void> | null = null;

function ensureRateLimitTable(): Promise<void> {
  tableReady ??= (async () => {
    await sql`
			CREATE TABLE IF NOT EXISTS rate_limits (
				key TEXT PRIMARY KEY,
				window_start TIMESTAMP WITH TIME ZONE NOT NULL,
				count INTEGER NOT NULL
			)
		`;
  })().catch((error) => {
    tableReady = null;
    throw error;
  });
  return tableReady;
}

/** A friendly "try again in …" for a retry delay. */
export function retryAfterText(seconds: number) {
  if (seconds < 90) return `${Math.max(1, Math.ceil(seconds))} seconds`;
  return `${Math.ceil(seconds / 60)} minutes`;
}

/**
 * Counts one request against `limit` for `subject` (a user or org ID) and
 * says whether it's allowed. A database error lets the request through:
 * a broken limiter shouldn't take the feature down with it.
 */
export async function checkRateLimit(
  limit: RateLimit,
  subject: string,
): Promise<RateLimitResult> {
  const key = `${limit.name}:${subject}`;
  try {
    await ensureRateLimitTable();
    const [row] = (await sql`
			INSERT INTO rate_limits (key, window_start, count)
			VALUES (${key}, NOW(), 1)
			ON CONFLICT (key) DO UPDATE SET
				count = CASE
					WHEN rate_limits.window_start <= NOW() - ${limit.windowSeconds} * INTERVAL '1 second'
					THEN 1 ELSE rate_limits.count + 1 END,
				window_start = CASE
					WHEN rate_limits.window_start <= NOW() - ${limit.windowSeconds} * INTERVAL '1 second'
					THEN NOW() ELSE rate_limits.window_start END
			RETURNING count, window_start
		`) as { count: number; window_start: Date | string }[];
    const count = Number(row?.count ?? 1);
    if (count <= limit.limit) {
      return { ok: true, remaining: limit.limit - count };
    }
    const started = new Date(row?.window_start ?? Date.now()).getTime();
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((started + limit.windowSeconds * 1000 - Date.now()) / 1000),
    );
    return { ok: false, retryAfterSeconds };
  } catch (error) {
    console.error(`Rate limit check failed for ${limit.name}:`, error);
    return { ok: true, remaining: limit.limit };
  }
}

/** The error message shown when a limit is hit. */
export function rateLimitedMessage(retryAfterSeconds: number) {
  return `Too many requests. Try again in ${retryAfterText(retryAfterSeconds)}.`;
}
