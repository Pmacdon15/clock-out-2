import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { sql, neon } = vi.hoisted(() => {
  const sql = Object.assign(vi.fn(), { transaction: vi.fn() });
  return { sql, neon: vi.fn(() => sql) };
});

vi.mock("@neondatabase/serverless", () => ({ neon }));
vi.mock("next/cache", () => ({ cacheTag: vi.fn(), cacheLife: vi.fn() }));

type Availability = typeof import("@/lib/availability-db");
let db: Availability;

const textOf = (call = 0) =>
  (sql.mock.calls[call][0] as string[]).join("?").replace(/\s+/g, " ").trim();
const valuesOf = (call = 0) => sql.mock.calls[call].slice(1);

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "postgres://test");
  db = await import("@/lib/availability-db");
});

async function ready() {
  sql.mockResolvedValue([]);
  await db.ensureAvailabilityTable();
  sql.mockReset();
  sql.transaction.mockReset();
}

beforeEach(() => {
  db.resetAvailabilityTableCheck();
  sql.mockReset();
  sql.transaction.mockReset();
});

describe("ensureAvailabilityTable", () => {
  it("creates the table and index once", async () => {
    sql.mockResolvedValue([]);
    await db.ensureAvailabilityTable();
    await db.ensureAvailabilityTable();
    expect(sql).toHaveBeenCalledTimes(2);
    expect(textOf(0)).toContain(
      "CREATE TABLE IF NOT EXISTS member_availability",
    );
    expect(textOf(1)).toContain("idx_member_availability_org_user");
  });

  it("retries after a failure", async () => {
    sql.mockRejectedValueOnce(new Error("db down"));
    await expect(db.ensureAvailabilityTable()).rejects.toThrow("db down");
    sql.mockResolvedValue([]);
    await db.ensureAvailabilityTable();
    expect(sql).toHaveBeenCalledTimes(3);
  });
});

describe("dbListAvailability", () => {
  it("lists the org's windows, or one member's", async () => {
    await ready();
    sql.mockResolvedValue([{ id: 1 }]);
    await expect(db.dbListAvailability("o1", null)).resolves.toEqual([
      { id: 1 },
    ]);
    expect(textOf(0)).toContain("FROM member_availability");
    expect(valuesOf(0)).toEqual(["o1", null, null]);
    await db.dbListAvailability("o1", "amy");
    expect(valuesOf(1)).toEqual(["o1", "amy", "amy"]);
  });
});

describe("dbAddAvailability", () => {
  const input = {
    orgId: "o1",
    userId: "amy",
    kind: "available" as const,
    weekdays: [1, 2],
    startMinute: 540,
    endMinute: 1020,
    timezone: "UTC",
    note: null,
    max: 50,
  };

  it("inserts one row per weekday under a lock and the limit", async () => {
    await ready();
    sql.mockReturnValue("query");
    sql.transaction.mockResolvedValue([[], [{ id: 1 }, { id: 2 }]]);
    await expect(db.dbAddAvailability(input)).resolves.toEqual([
      { id: 1 },
      { id: 2 },
    ]);
    expect(textOf(0)).toContain("pg_advisory_xact_lock");
    expect(valuesOf(0)).toEqual(["o1:amy:availability"]);
    expect(textOf(1)).toContain("INSERT INTO member_availability");
    expect(textOf(1)).toContain("unnest");
    expect(valuesOf(1)).toContain(50);
  });

  it("returns undefined when nothing went in (over the limit)", async () => {
    await ready();
    sql.mockReturnValue("query");
    sql.transaction.mockResolvedValue([[], []]);
    await expect(db.dbAddAvailability(input)).resolves.toBeUndefined();
  });
});

describe("dbDeleteAvailability", () => {
  it("deletes a window in the org, scoped to the member unless admin", async () => {
    await ready();
    sql.mockResolvedValue([{ id: 3 }]);
    await expect(db.dbDeleteAvailability(3, "o1", "amy")).resolves.toEqual({
      id: 3,
    });
    expect(textOf(0)).toContain("DELETE FROM member_availability");
    expect(valuesOf(0)).toEqual([3, "o1", "amy", "amy"]);
    sql.mockResolvedValue([]);
    await expect(
      db.dbDeleteAvailability(3, "o1", null),
    ).resolves.toBeUndefined();
  });
});
