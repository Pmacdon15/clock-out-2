import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { sql, neon } = vi.hoisted(() => {
  const sql = Object.assign(vi.fn(), { transaction: vi.fn() });
  return { sql, neon: vi.fn(() => sql) };
});

vi.mock("@neondatabase/serverless", () => ({ neon }));
vi.mock("next/cache", () => ({ cacheTag: vi.fn(), cacheLife: vi.fn() }));

type Db = typeof import("@/lib/db");
type Requests = typeof import("@/lib/shift-requests-db");
let db: Db;
let requests: Requests;

const textOf = (call = 0) =>
  (sql.mock.calls[call][0] as string[]).join("?").replace(/\s+/g, " ").trim();
const valuesOf = (call = 0) => sql.mock.calls[call].slice(1);

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "postgres://test");
  db = await import("@/lib/db");
  requests = await import("@/lib/shift-requests-db");
});

/** Runs the one-time table checks, then forgets their calls. */
async function ready() {
  sql.mockResolvedValue([]);
  await requests.ensureShiftRequestsTable();
  sql.mockReset();
  sql.transaction.mockReset();
}

beforeEach(async () => {
  db.resetScheduledShiftsTableCheck();
  requests.resetShiftRequestsTableCheck();
  sql.mockReset();
  sql.transaction.mockReset();
});

describe("ensureShiftRequestsTable", () => {
  it("creates the schedule table, then the requests table and indexes, once", async () => {
    sql.mockResolvedValue([]);
    await Promise.all([
      requests.ensureShiftRequestsTable(),
      requests.ensureShiftRequestsTable(),
    ]);
    const texts = sql.mock.calls.map((_, i) => textOf(i));
    expect(texts).toHaveLength(5);
    expect(texts[0]).toContain("CREATE TABLE IF NOT EXISTS scheduled_shifts");
    expect(texts[2]).toContain("CREATE TABLE IF NOT EXISTS shift_requests");
    expect(texts[2]).toContain("REFERENCES scheduled_shifts(id)");
    expect(texts[3]).toContain("idx_shift_requests_org_status");
    expect(texts[4]).toContain("idx_shift_requests_one_active");
  });

  it("retries after a failure", async () => {
    db.resetScheduledShiftsTableCheck();
    sql.mockRejectedValueOnce(new Error("db down"));
    await expect(requests.ensureShiftRequestsTable()).rejects.toThrow(
      "db down",
    );
    sql.mockResolvedValue([]);
    await requests.ensureShiftRequestsTable();
    expect(textOf(sql.mock.calls.length - 3)).toContain("shift_requests");
  });
});

describe("queries", () => {
  beforeEach(ready);

  it("lists requests with their shifts, scoped to the org", async () => {
    const since = new Date("2030-01-01T00:00:00Z");
    sql.mockResolvedValueOnce([{ id: 1 }]);
    await expect(
      requests.dbListShiftRequests("o1", ["open"], since),
    ).resolves.toEqual([{ id: 1 }]);
    expect(textOf()).toContain("LEFT JOIN scheduled_shifts w");
    expect(textOf()).toContain("r.org_id = ?");
    expect(valuesOf()).toEqual(["o1", ["open"], since]);
  });

  it("reads one request in the org", async () => {
    sql.mockResolvedValueOnce([{ id: 4 }]);
    await expect(requests.dbGetShiftRequest(4, "o1")).resolves.toEqual({
      id: 4,
    });
    expect(valuesOf()).toEqual([4, "o1"]);
    sql.mockResolvedValueOnce([]);
    await expect(requests.dbGetShiftRequest(5, "o1")).resolves.toBeUndefined();
  });

  it("creates a request under a lock unless a shift is already taken", async () => {
    sql.mockImplementation((strings: string[], ...values: unknown[]) => ({
      strings,
      values,
    }));
    sql.transaction.mockResolvedValueOnce([[], [{ id: 9 }]]);
    const input = {
      orgId: "o1",
      type: "swap" as const,
      shiftId: 1,
      swapShiftId: 2,
      requestedBy: "amy",
      targetUserId: "ben",
      claimedBy: "ben",
      note: null,
    };
    await expect(requests.dbCreateShiftRequest(input)).resolves.toEqual({
      id: 9,
    });
    expect(textOf(0)).toContain("pg_advisory_xact_lock");
    expect(valuesOf(0)).toEqual(["o1:shift-requests"]);
    expect(textOf(1)).toContain("WHERE NOT EXISTS");
    expect(valuesOf(1)).toEqual([
      "o1",
      "swap",
      1,
      2,
      "amy",
      "ben",
      "ben",
      null,
      "o1",
      1,
      2,
      1,
      2,
    ]);
    sql.transaction.mockResolvedValueOnce([[], []]);
    await expect(requests.dbCreateShiftRequest(input)).resolves.toBeUndefined();
  });

  it("claims, cancels and denies only from the expected status", async () => {
    sql.mockResolvedValueOnce([{ id: 1, status: "pending_approval" }]);
    await expect(requests.dbClaimShiftRequest(1, "o1", "ben")).resolves.toEqual(
      { id: 1, status: "pending_approval" },
    );
    expect(textOf()).toContain("status = 'open'");

    sql.mockResolvedValueOnce([{ id: 1, status: "cancelled" }]);
    await requests.dbCancelShiftRequest(1, "o1", "amy");
    expect(textOf(1)).toContain("status IN ('open', 'pending_approval')");
    expect(valuesOf(1)).toEqual(["amy", 1, "o1"]);

    sql.mockResolvedValueOnce([]);
    await expect(
      requests.dbDenyShiftRequest(1, "o1", "mgr", "no"),
    ).resolves.toBeUndefined();
    expect(textOf(2)).toContain("status = 'pending_approval'");
    expect(valuesOf(2)).toEqual(["mgr", "no", 1, "o1"]);
  });

  it("approves and moves the shifts in one transaction", async () => {
    sql.mockImplementation((strings: string[], ...values: unknown[]) => ({
      strings,
      values,
    }));
    sql.transaction.mockResolvedValueOnce([
      [
        {
          request: { id: 1, status: "approved" },
          shifts: [
            {
              id: 3,
              user_id: "ben",
              shift_start: "2030-01-05T09:00:00Z",
              shift_end: "2030-01-05T17:00:00Z",
            },
          ],
        },
      ],
      [{ id: 2 }],
    ]);
    await expect(
      requests.dbApproveShiftRequest(1, "o1", "mgr", null),
    ).resolves.toEqual({
      request: { id: 1, status: "approved" },
      shifts: [
        {
          id: 3,
          user_id: "ben",
          shift_start: new Date("2030-01-05T09:00:00Z"),
          shift_end: new Date("2030-01-05T17:00:00Z"),
        },
      ],
      superseded: [{ id: 2 }],
    });
    expect(textOf(0)).toContain("UPDATE scheduled_shifts s");
    expect(textOf(0)).toContain("s.user_id = r.claimed_by");
    expect(textOf(1)).toContain("a.reviewed_at = NOW()");

    sql.transaction.mockResolvedValueOnce([
      [{ request: null, shifts: [] }],
      [],
    ]);
    await expect(
      requests.dbApproveShiftRequest(1, "o1", "mgr", null),
    ).resolves.toBeUndefined();
    sql.transaction.mockResolvedValueOnce([[], []]);
    await expect(
      requests.dbApproveShiftRequest(1, "o1", "mgr", null),
    ).resolves.toBeUndefined();
  });

  it("finds a member's overlapping shifts, leaving some out", async () => {
    const start = new Date("2030-01-05T09:00:00Z");
    const end = new Date("2030-01-05T17:00:00Z");
    sql.mockResolvedValueOnce([{ id: 4 }]);
    await expect(
      requests.dbGetOverlappingScheduledShifts("o1", "ben", start, end, [2]),
    ).resolves.toEqual([{ id: 4 }]);
    expect(textOf()).toContain("shift_start < ? AND shift_end > ?");
    expect(valuesOf()).toEqual(["o1", "ben", end, start, [2]]);
  });
});
