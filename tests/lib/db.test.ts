import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { sql, neon, cacheTag, cacheLife } = vi.hoisted(() => {
  const sql = Object.assign(vi.fn(), { transaction: vi.fn() });
  return {
    sql,
    neon: vi.fn(() => sql),
    cacheTag: vi.fn(),
    cacheLife: vi.fn(),
  };
});

vi.mock("@neondatabase/serverless", () => ({ neon }));
vi.mock("next/cache", () => ({ cacheTag, cacheLife }));

type Db = typeof import("@/lib/db");
let db: Db;
let neonCalls: unknown[][] = [];

/** The interpolated values passed to the nth `sql` tagged-template call. */
const valuesOf = (call = 0) => sql.mock.calls[call].slice(1);
/** The SQL text of the nth call, whitespace-collapsed. */
const textOf = (call = 0) =>
  (sql.mock.calls[call][0] as string[]).join("?").replace(/\s+/g, " ").trim();

const start = new Date("2026-01-01T00:00:00Z");
const end = new Date("2026-01-08T00:00:00Z");

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "postgres://test");
  db = await import("@/lib/db");
  // Snapshot now: call history is cleared before every test.
  neonCalls = [...neon.mock.calls];
});

beforeEach(() => {
  sql.mockReset();
  sql.transaction.mockReset();
});

describe("module setup", () => {
  it("creates the neon client from DATABASE_URL", () => {
    expect(neonCalls).toEqual([["postgres://test"]]);
    expect(db.sql).toBe(sql);
  });

  it("throws when DATABASE_URL is missing", async () => {
    vi.resetModules();
    vi.stubEnv("DATABASE_URL", "");
    await expect(import("@/lib/db")).rejects.toThrow(
      "DATABASE_URL is not defined",
    );
  });
});

describe("dbGetTimeEntries", () => {
  it("filters by date range when both dates are given", async () => {
    sql.mockResolvedValue([{ id: 1 }]);
    await expect(db.dbGetTimeEntries("u1", "o1", start, end)).resolves.toEqual([
      { id: 1 },
    ]);
    expect(textOf()).toContain("clock_in >= ? AND clock_in < ?");
    expect(valuesOf()).toEqual(["u1", "o1", start, end]);
    expect(cacheTag).toHaveBeenCalledWith(
      `time-entries-u1-o1-${start}-${end}`,
      "time-entries-u1-o1",
    );
    expect(cacheLife).toHaveBeenCalledWith("hours");
  });

  it("returns all entries when no range is given", async () => {
    sql.mockResolvedValue([]);
    await db.dbGetTimeEntries("u1", "o1");
    expect(textOf()).not.toContain("clock_in >=");
    expect(valuesOf()).toEqual(["u1", "o1"]);
  });
});

describe("dbGetOrgTimeEntries", () => {
  it("filters by date range when both dates are given", async () => {
    sql.mockResolvedValue([{ id: 2 }]);
    await expect(db.dbGetOrgTimeEntries("o1", start, end)).resolves.toEqual([
      { id: 2 },
    ]);
    expect(valuesOf()).toEqual(["o1", start, end]);
    expect(cacheTag).toHaveBeenCalledWith(
      "org-time-entries-o1",
      `org-time-entries-o1-${start.toISOString()}-${end.toISOString()}`,
    );
  });

  it("returns all entries when the range is incomplete", async () => {
    sql.mockResolvedValue([]);
    await db.dbGetOrgTimeEntries("o1", start);
    expect(valuesOf()).toEqual(["o1"]);
    expect(cacheTag).toHaveBeenCalledWith(
      "org-time-entries-o1",
      `org-time-entries-o1-${start.toISOString()}-all`,
    );
  });

  it("tags the cache with 'all' when no dates are given", async () => {
    sql.mockResolvedValue([]);
    await db.dbGetOrgTimeEntries("o1");
    expect(cacheTag).toHaveBeenCalledWith(
      "org-time-entries-o1",
      "org-time-entries-o1-all-all",
    );
  });
});

describe("active entries", () => {
  it("dbCheckActiveEntry returns the raw rows", async () => {
    sql.mockResolvedValue([{ id: 3 }]);
    await expect(db.dbCheckActiveEntry("u1", "o1")).resolves.toEqual([
      { id: 3 },
    ]);
    expect(textOf()).toContain("clock_out IS NULL");
  });

  it("dbGetActiveEntry returns the first row", async () => {
    sql.mockResolvedValue([{ id: 4 }]);
    await expect(db.dbGetActiveEntry("u1", "o1")).resolves.toEqual({ id: 4 });
  });

  it("dbGetActiveEntry returns null when there is no open entry", async () => {
    sql.mockResolvedValue([]);
    await expect(db.dbGetActiveEntry("u1", "o1")).resolves.toBeNull();
  });
});

describe("mutations", () => {
  it("dbClockIn locks, inserts atomically and returns the new row", async () => {
    sql.mockReturnValueOnce("lock-query").mockReturnValueOnce("insert-query");
    sql.transaction.mockResolvedValue([[{}], [{ id: 5 }]]);
    await expect(db.dbClockIn("u1", "o1")).resolves.toEqual({ id: 5 });
    expect(sql.transaction).toHaveBeenCalledWith([
      "lock-query",
      "insert-query",
    ]);
    expect(textOf(0)).toContain("pg_advisory_xact_lock");
    expect(valuesOf(0)).toEqual(["u1:o1"]);
    expect(textOf(1)).toContain("INSERT INTO time_entries");
    expect(textOf(1)).toContain("WHERE NOT EXISTS");
    expect(textOf(1)).toContain("clock_out IS NULL");
    expect(valuesOf(1)).toEqual(["u1", "o1", "u1", "o1"]);
  });

  it("dbClockIn returns undefined when an open entry already exists", async () => {
    sql.transaction.mockResolvedValue([[{}], []]);
    await expect(db.dbClockIn("u1", "o1")).resolves.toBeUndefined();
  });

  it("dbClockOut closes the open entry", async () => {
    sql.mockResolvedValue([{ id: 6 }]);
    await expect(db.dbClockOut("u1", "o1")).resolves.toEqual({ id: 6 });
    expect(textOf()).toContain("SET clock_out = NOW()");
  });

  it("dbDeleteTimeEntry deletes by id within the org", async () => {
    sql.mockResolvedValue([{ id: 7 }]);
    await expect(db.dbDeleteTimeEntry(7, "o1")).resolves.toEqual({ id: 7 });
    expect(valuesOf()).toEqual([7, "o1"]);
  });

  it("dbUpdateTimeEntry passes times, org and admin flag", async () => {
    sql.mockResolvedValue([{ id: 8 }]);
    await expect(
      db.dbUpdateTimeEntry(8, start, null, "o1", true),
    ).resolves.toEqual({ id: 8 });
    expect(valuesOf()).toEqual([start, null, 8, "o1", true]);
  });

  it("dbUpdateTimeEntry updates skip_lunch when provided", async () => {
    sql.mockResolvedValue([{ id: 8, skip_lunch: true }]);
    await expect(
      db.dbUpdateTimeEntry(8, start, end, "o1", true, true),
    ).resolves.toEqual({ id: 8, skip_lunch: true });
    expect(textOf()).toContain("skip_lunch = ?");
    expect(valuesOf()).toEqual([start, end, true, 8, "o1", true]);
  });

  it("dbGetTimeEntriesForPeriod orders ascending", async () => {
    sql.mockResolvedValue([{ id: 9 }]);
    await expect(
      db.dbGetTimeEntriesForPeriod("u1", "o1", start, end),
    ).resolves.toEqual([{ id: 9 }]);
    expect(textOf()).toContain("ORDER BY clock_in ASC");
    expect(valuesOf()).toEqual(["u1", "o1", start, end]);
  });
});

describe("reporting settings", () => {
  it("dbGetReportingSettings reads and tags the cache", async () => {
    sql.mockResolvedValue([{ org_id: "o1" }]);
    await expect(db.dbGetReportingSettings("o1")).resolves.toEqual({
      org_id: "o1",
    });
    expect(cacheTag).toHaveBeenCalledWith("reporting-settings-o1");
  });

  it("dbUpdateReportingSettings upserts settings then reporting settings", async () => {
    sql.mockResolvedValueOnce([]).mockResolvedValueOnce([{ org_id: "o1" }]);
    await expect(
      db.dbUpdateReportingSettings("o1", "custom", "Monday", 2),
    ).resolves.toEqual({ org_id: "o1" });
    expect(textOf(0)).toContain("INSERT INTO settings");
    expect(valuesOf(0)).toEqual(["o1"]);
    expect(textOf(1)).toContain("INSERT INTO reporting_settings");
    expect(valuesOf(1)).toEqual([
      "o1",
      "custom",
      "Monday",
      2,
      "custom",
      "Monday",
      2,
    ]);
  });
});

describe("break settings", () => {
  beforeEach(() => {
    db.resetBreakSettingsTableCheck();
  });

  it("ensureBreakSettingsTable creates settings then break_settings if missing", async () => {
    sql.mockResolvedValue([]);
    await db.ensureBreakSettingsTable();
    expect(sql).toHaveBeenCalledTimes(2);
    expect(textOf(0)).toContain("CREATE TABLE IF NOT EXISTS settings");
    expect(textOf(1)).toContain("CREATE TABLE IF NOT EXISTS break_settings");
    expect(textOf(1)).toContain("REFERENCES settings(org_id)");
    expect(textOf(1)).toContain("dock_lunch BOOLEAN NOT NULL DEFAULT FALSE");
    expect(textOf(1)).toContain(
      "lunch_duration_minutes INTEGER NOT NULL DEFAULT 30",
    );
    expect(textOf(1)).toContain(
      "lunch_min_shift_hours DOUBLE PRECISION NOT NULL DEFAULT 5",
    );
  });

  it("ensureBreakSettingsTable only runs once per instance", async () => {
    sql.mockResolvedValue([]);
    await Promise.all([
      db.ensureBreakSettingsTable(),
      db.ensureBreakSettingsTable(),
    ]);
    await db.ensureBreakSettingsTable();
    expect(sql).toHaveBeenCalledTimes(2);
  });

  it("ensureBreakSettingsTable retries after a failure", async () => {
    sql.mockRejectedValueOnce(new Error("db down"));
    await expect(db.ensureBreakSettingsTable()).rejects.toThrow("db down");
    sql.mockReset();
    sql.mockResolvedValue([]);
    await db.ensureBreakSettingsTable();
    expect(sql).toHaveBeenCalledTimes(2);
    expect(textOf(1)).toContain("CREATE TABLE IF NOT EXISTS break_settings");
  });

  it("dbGetBreakSettings creates the table first, then reads and tags the cache", async () => {
    sql
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ org_id: "o1", dock_lunch: true }]);
    await expect(db.dbGetBreakSettings("o1")).resolves.toEqual({
      org_id: "o1",
      dock_lunch: true,
    });
    expect(textOf(1)).toContain("CREATE TABLE IF NOT EXISTS break_settings");
    expect(textOf(2)).toContain("SELECT * FROM break_settings");
    expect(valuesOf(2)).toEqual(["o1"]);
    expect(cacheTag).toHaveBeenCalledWith("break-settings-o1");
  });

  it("dbGetBreakSettings returns undefined for an org with no saved settings", async () => {
    sql.mockResolvedValue([]);
    await expect(db.dbGetBreakSettings("o2")).resolves.toBeUndefined();
  });

  it("dbGetBreakSettings rejects when the table can't be created", async () => {
    sql.mockRejectedValueOnce(new Error("permission denied"));
    await expect(db.dbGetBreakSettings("o1")).rejects.toThrow(
      "permission denied",
    );
  });

  it("dbUpdateBreakSettings creates the table, then upserts settings and break settings", async () => {
    sql
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ org_id: "o1", dock_lunch: true }]);
    await expect(db.dbUpdateBreakSettings("o1", true, 30, 5)).resolves.toEqual({
      org_id: "o1",
      dock_lunch: true,
    });
    expect(textOf(0)).toContain("CREATE TABLE IF NOT EXISTS settings");
    expect(textOf(1)).toContain("CREATE TABLE IF NOT EXISTS break_settings");
    expect(textOf(2)).toContain("INSERT INTO settings");
    expect(valuesOf(2)).toEqual(["o1"]);
    expect(textOf(3)).toContain("INSERT INTO break_settings");
    expect(valuesOf(3)).toEqual(["o1", true, 30, 5, true, 30, 5]);
  });

  it("dbUpdateBreakSettings skips table creation once it has run", async () => {
    sql.mockResolvedValue([]);
    await db.ensureBreakSettingsTable();
    sql.mockReset();
    sql
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ org_id: "o1", dock_lunch: false }]);
    await db.dbUpdateBreakSettings("o1", false, 45, 6);
    expect(sql).toHaveBeenCalledTimes(2);
    expect(textOf(0)).toContain("INSERT INTO settings");
    expect(valuesOf(1)).toEqual(["o1", false, 45, 6, false, 45, 6]);
  });
});
