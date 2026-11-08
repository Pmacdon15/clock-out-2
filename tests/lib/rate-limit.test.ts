import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const { sql, neon } = vi.hoisted(() => {
  const sql = Object.assign(vi.fn(), { transaction: vi.fn() });
  return { sql, neon: vi.fn(() => sql) };
});

vi.mock("@neondatabase/serverless", () => ({ neon }));
vi.mock("next/cache", () => ({ cacheTag: vi.fn(), cacheLife: vi.fn() }));

type RateLimitModule = typeof import("@/lib/rate-limit");
let rl: RateLimitModule;

const limit = { name: "test", limit: 2, windowSeconds: 60 };

/** The SQL text and values of the nth query. */
const call = (n: number) => (sql.mock.calls[n] ?? []) as unknown[];
const textOf = (n: number) => ((call(n)[0] ?? []) as string[]).join("?");

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "postgres://test");
  rl = await import("@/lib/rate-limit");
});

describe("checkRateLimit", () => {
  beforeEach(() => {
    sql.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-08T12:00:30Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("creates the table once, then counts under one key per limit and subject", async () => {
    sql
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { count: 1, window_start: "2026-11-08T12:00:00Z" },
      ]);
    await expect(rl.checkRateLimit(limit, "user_1")).resolves.toEqual({
      ok: true,
      remaining: 1,
    });
    expect(textOf(0)).toContain("CREATE TABLE IF NOT EXISTS rate_limits");
    expect(textOf(1)).toContain("ON CONFLICT (key)");
    expect(call(1).slice(1, 2)).toEqual(["test:user_1"]);
    expect(call(1)).toContain(60);

    sql.mockResolvedValueOnce([
      { count: 2, window_start: "2026-11-08T12:00:00Z" },
    ]);
    await expect(rl.checkRateLimit(limit, "user_1")).resolves.toEqual({
      ok: true,
      remaining: 0,
    });
    expect(sql).toHaveBeenCalledTimes(3);
  });

  it("refuses once over the limit, with the seconds left in the window", async () => {
    sql.mockResolvedValueOnce([
      { count: 3, window_start: new Date("2026-11-08T12:00:00Z") },
    ]);
    await expect(rl.checkRateLimit(limit, "user_1")).resolves.toEqual({
      ok: false,
      retryAfterSeconds: 30,
    });
  });

  it("never asks a caller to wait less than a second", async () => {
    sql.mockResolvedValueOnce([
      { count: 3, window_start: "2026-11-08T11:00:00Z" },
    ]);
    await expect(rl.checkRateLimit(limit, "user_1")).resolves.toEqual({
      ok: false,
      retryAfterSeconds: 1,
    });
  });

  it("treats a missing row as the first request", async () => {
    sql.mockResolvedValueOnce([]);
    await expect(rl.checkRateLimit(limit, "user_2")).resolves.toEqual({
      ok: true,
      remaining: 1,
    });
  });

  it("uses now for a refused row with no window start", async () => {
    sql.mockResolvedValueOnce([{ count: 9, window_start: null }]);
    await expect(rl.checkRateLimit(limit, "user_3")).resolves.toEqual({
      ok: false,
      retryAfterSeconds: 60,
    });
  });

  it("lets requests through when the database fails, and retries the table later", async () => {
    vi.resetModules();
    vi.stubEnv("DATABASE_URL", "postgres://test");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fresh: RateLimitModule = await import("@/lib/rate-limit");
    sql.mockRejectedValueOnce(new Error("db down"));
    await expect(fresh.checkRateLimit(limit, "user_1")).resolves.toEqual({
      ok: true,
      remaining: 2,
    });
    expect(console.error).toHaveBeenCalled();

    sql
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { count: 1, window_start: "2026-11-08T12:00:00Z" },
      ]);
    await fresh.checkRateLimit(limit, "user_1");
    expect(textOf(1)).toContain("CREATE TABLE IF NOT EXISTS rate_limits");
  });
});

describe("rate limit messages", () => {
  it.each([
    [0.2, "1 seconds"],
    [30, "30 seconds"],
    [89, "89 seconds"],
    [90, "2 minutes"],
    [3600, "60 minutes"],
  ])("describes %s seconds as %s", (seconds, text) => {
    expect(rl.retryAfterText(seconds)).toBe(text);
  });

  it("builds the user-facing message", () => {
    expect(rl.rateLimitedMessage(120)).toBe(
      "Too many requests. Try again in 2 minutes.",
    );
  });

  it("defines the app's limits", () => {
    for (const l of [
      rl.GEOCODE_LIMIT,
      rl.TEST_NOTIFICATION_LIMIT,
      rl.TEST_REPORT_LIMIT,
      rl.MCP_REQUEST_LIMIT,
    ]) {
      expect(l.limit).toBeGreaterThan(0);
      expect(l.windowSeconds).toBeGreaterThan(0);
    }
  });
});
