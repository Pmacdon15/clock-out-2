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
    // Entries arrive with their (here empty) break records attached.
    await expect(db.dbGetTimeEntries("u1", "o1", start, end)).resolves.toEqual([
      { id: 1, breaks: [] },
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
      { id: 2, breaks: [] },
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
    await expect(db.dbGetActiveEntry("u1", "o1")).resolves.toEqual({
      id: 4,
      breaks: [],
    });
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
    // The five nulls are the (unused) location columns.
    expect(valuesOf(1)).toEqual([
      "u1",
      "o1",
      null,
      null,
      null,
      null,
      null,
      "u1",
      "o1",
    ]);
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
    ).resolves.toEqual([{ id: 9, breaks: [] }]);
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

describe("breaks", () => {
  beforeEach(() => {
    db.resetTimeEntryBreaksTableCheck();
  });

  it("ensureTimeEntryBreaksTable creates the table and its indexes", async () => {
    sql.mockResolvedValue([]);
    await db.ensureTimeEntryBreaksTable();
    expect(sql).toHaveBeenCalledTimes(3);
    expect(textOf(0)).toContain("CREATE TABLE IF NOT EXISTS time_entry_breaks");
    expect(textOf(0)).toContain(
      "REFERENCES time_entries(id) ON DELETE CASCADE",
    );
    expect(textOf(0)).toContain(
      "CHECK (break_type IN ('unpaid_meal', 'unpaid_rest', 'paid_rest'))",
    );
    expect(textOf(1)).toContain("idx_time_entry_breaks_entry");
    expect(textOf(2)).toContain("idx_time_entry_breaks_one_open");
    expect(textOf(2)).toContain("WHERE break_end IS NULL");
  });

  it("ensureTimeEntryBreaksTable only runs once, and retries after a failure", async () => {
    sql.mockResolvedValue([]);
    await Promise.all([
      db.ensureTimeEntryBreaksTable(),
      db.ensureTimeEntryBreaksTable(),
    ]);
    expect(sql).toHaveBeenCalledTimes(3);

    db.resetTimeEntryBreaksTableCheck();
    sql.mockReset();
    sql.mockRejectedValueOnce(new Error("db down"));
    await expect(db.ensureTimeEntryBreaksTable()).rejects.toThrow("db down");
    sql.mockReset();
    sql.mockResolvedValue([]);
    await db.ensureTimeEntryBreaksTable();
    expect(sql).toHaveBeenCalledTimes(3);
  });

  it("dbGetBreaksForEntries skips the query for an empty id list", async () => {
    await expect(db.dbGetBreaksForEntries([])).resolves.toEqual([]);
    expect(sql).not.toHaveBeenCalled();
  });

  it("dbGetBreaksForEntries reads every break for the given entries", async () => {
    sql
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 1, time_entry_id: 3 }]);
    await expect(db.dbGetBreaksForEntries([3, 4])).resolves.toEqual([
      { id: 1, time_entry_id: 3 },
    ]);
    expect(textOf(3)).toContain("SELECT * FROM time_entry_breaks");
    expect(valuesOf(3)).toEqual([[3, 4]]);
  });

  it("attachBreaks groups the breaks onto their entries", async () => {
    sql
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 1, time_entry_id: 10 },
        { id: 2, time_entry_id: 10 },
        { id: 3, time_entry_id: 11 },
      ]);
    await expect(
      db.attachBreaks([{ id: 10 }, { id: 11 }, { id: 12 }] as never),
    ).resolves.toEqual([
      {
        id: 10,
        breaks: [
          { id: 1, time_entry_id: 10 },
          { id: 2, time_entry_id: 10 },
        ],
      },
      { id: 11, breaks: [{ id: 3, time_entry_id: 11 }] },
      { id: 12, breaks: [] },
    ]);
  });

  it("dbGetBreaksForEntriesInOrg scopes by org and member", async () => {
    sql.mockResolvedValue([]);
    await db.ensureTimeEntryBreaksTable();
    sql.mockReset();
    sql.mockResolvedValue([{ id: 1 }]);
    await expect(
      db.dbGetBreaksForEntriesInOrg([5], "o1", "u1", false),
    ).resolves.toEqual([{ id: 1 }]);
    expect(textOf()).toContain("JOIN time_entries e");
    expect(valuesOf()).toEqual([[5], "o1", false, "u1"]);

    await expect(
      db.dbGetBreaksForEntriesInOrg([], "o1", "u1", true),
    ).resolves.toEqual([]);
  });

  it("dbStartBreak locks, then inserts only when no break is running", async () => {
    sql.mockResolvedValue([]);
    await db.ensureTimeEntryBreaksTable();
    sql.mockReset();
    sql.mockReturnValueOnce("lock-query").mockReturnValueOnce("insert-query");
    sql.transaction.mockResolvedValue([[{}], [{ id: 1 }]]);
    await expect(db.dbStartBreak("u1", "o1", "unpaid_meal")).resolves.toEqual({
      id: 1,
    });
    expect(sql.transaction).toHaveBeenCalledWith([
      "lock-query",
      "insert-query",
    ]);
    expect(textOf(0)).toContain("pg_advisory_xact_lock");
    expect(valuesOf(0)).toEqual(["u1:o1:break"]);
    expect(textOf(1)).toContain("INSERT INTO time_entry_breaks");
    expect(textOf(1)).toContain("AND NOT EXISTS");
    expect(valuesOf(1)).toEqual(["unpaid_meal", "u1", "o1"]);
  });

  it("dbStartBreak returns undefined when nothing was inserted", async () => {
    sql.mockResolvedValue([]);
    await db.ensureTimeEntryBreaksTable();
    sql.mockReset();
    sql.transaction.mockResolvedValue([[{}], []]);
    await expect(
      db.dbStartBreak("u1", "o1", "paid_rest"),
    ).resolves.toBeUndefined();
  });

  it("dbEndOpenBreak closes the running break of the open shift", async () => {
    sql.mockResolvedValue([]);
    await db.ensureTimeEntryBreaksTable();
    sql.mockReset();
    sql.mockResolvedValue([{ id: 2 }]);
    await expect(db.dbEndOpenBreak("u1", "o1")).resolves.toEqual({ id: 2 });
    expect(textOf()).toContain("SET break_end = NOW()");
    expect(textOf()).toContain("WHERE break_end IS NULL");
    expect(valuesOf()).toEqual(["u1", "o1"]);
  });

  it("dbGetBreakWithEntry joins the shift it belongs to", async () => {
    sql.mockResolvedValue([]);
    await db.ensureTimeEntryBreaksTable();
    sql.mockReset();
    sql.mockResolvedValue([{ id: 3, user_id: "u1" }]);
    await expect(db.dbGetBreakWithEntry(3, "o1")).resolves.toEqual({
      id: 3,
      user_id: "u1",
    });
    expect(textOf()).toContain("JOIN time_entries e ON e.id = b.time_entry_id");
    expect(valuesOf()).toEqual([3, "o1"]);
  });

  it("dbGetEntryBreaks reads one entry's breaks in order", async () => {
    sql.mockResolvedValue([]);
    await db.ensureTimeEntryBreaksTable();
    sql.mockReset();
    sql.mockResolvedValue([{ id: 4 }]);
    await expect(db.dbGetEntryBreaks(7)).resolves.toEqual([{ id: 4 }]);
    expect(textOf()).toContain("ORDER BY break_start ASC, id ASC");
    expect(valuesOf()).toEqual([7]);
  });

  it("dbUpdateBreak writes the new window and type within the org", async () => {
    sql.mockResolvedValue([]);
    await db.ensureTimeEntryBreaksTable();
    sql.mockReset();
    sql.mockResolvedValue([{ id: 5 }]);
    await expect(
      db.dbUpdateBreak(5, "o1", start, end, "unpaid_rest"),
    ).resolves.toEqual({ id: 5 });
    expect(textOf()).toContain("UPDATE time_entry_breaks");
    expect(valuesOf()).toEqual([start, end, "unpaid_rest", 5, "o1"]);
  });

  it("dbDeleteBreak deletes by id within the org", async () => {
    sql.mockResolvedValue([]);
    await db.ensureTimeEntryBreaksTable();
    sql.mockReset();
    sql.mockResolvedValue([{ id: 6 }]);
    await expect(db.dbDeleteBreak(6, "o1")).resolves.toEqual({ id: 6 });
    expect(textOf()).toContain("DELETE FROM time_entry_breaks");
    expect(valuesOf()).toEqual([6, "o1"]);
  });
});

describe("location settings and sites", () => {
  beforeEach(() => {
    db.resetLocationTablesCheck();
  });

  it("ensureLocationTables creates the tables and the entry columns", async () => {
    sql.mockResolvedValue([]);
    await db.ensureLocationTables();
    expect(sql).toHaveBeenCalledTimes(5);
    expect(textOf(0)).toContain("CREATE TABLE IF NOT EXISTS settings");
    expect(textOf(1)).toContain("CREATE TABLE IF NOT EXISTS location_settings");
    expect(textOf(1)).toContain("capture_mode TEXT NOT NULL DEFAULT 'off'");
    expect(textOf(1)).toContain(
      "restrict_clock_in BOOLEAN NOT NULL DEFAULT FALSE",
    );
    expect(textOf(2)).toContain("CREATE TABLE IF NOT EXISTS sites");
    expect(textOf(2)).toContain("radius_meters DOUBLE PRECISION");
    expect(textOf(3)).toContain("ALTER TABLE sites");
    expect(textOf(3)).toContain("ADD COLUMN IF NOT EXISTS address TEXT");
    expect(textOf(4)).toContain("ALTER TABLE time_entries");
    expect(textOf(4)).toContain("clock_in_latitude DOUBLE PRECISION");
    expect(textOf(4)).toContain("clock_out_site_name TEXT");
    expect(textOf(4)).toContain("clock_out_address TEXT");
  });

  it("ensureLocationTables only runs once per instance", async () => {
    sql.mockResolvedValue([]);
    await Promise.all([db.ensureLocationTables(), db.ensureLocationTables()]);
    await db.ensureLocationTables();
    expect(sql).toHaveBeenCalledTimes(5);
  });

  it("ensureLocationTables retries after a failure", async () => {
    sql.mockRejectedValueOnce(new Error("db down"));
    await expect(db.ensureLocationTables()).rejects.toThrow("db down");
    sql.mockReset();
    sql.mockResolvedValue([]);
    await db.ensureLocationTables();
    expect(sql).toHaveBeenCalledTimes(5);
  });

  it("dbGetLocationSettings creates the tables first, then reads and tags the cache", async () => {
    sql.mockResolvedValue([]);
    sql
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ org_id: "o1", capture_mode: "required" }]);
    await expect(db.dbGetLocationSettings("o1")).resolves.toEqual({
      org_id: "o1",
      capture_mode: "required",
    });
    expect(textOf(5)).toContain("SELECT * FROM location_settings");
    expect(valuesOf(5)).toEqual(["o1"]);
    expect(cacheTag).toHaveBeenCalledWith("location-settings-o1");
  });

  it("dbGetLocationSettings returns undefined for an org with nothing saved", async () => {
    sql.mockResolvedValue([]);
    await expect(db.dbGetLocationSettings("o2")).resolves.toBeUndefined();
  });

  it("dbGetLocationSettings rejects when the tables can't be created", async () => {
    sql.mockRejectedValueOnce(new Error("permission denied"));
    await expect(db.dbGetLocationSettings("o1")).rejects.toThrow(
      "permission denied",
    );
  });

  it("dbUpdateLocationSettings upserts the parent settings row and the mode", async () => {
    sql.mockResolvedValue([]);
    await db.ensureLocationTables();
    sql.mockReset();
    sql
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ org_id: "o1", capture_mode: "optional" }]);
    await expect(
      db.dbUpdateLocationSettings("o1", "optional", true),
    ).resolves.toEqual({ org_id: "o1", capture_mode: "optional" });
    expect(textOf(0)).toContain("INSERT INTO settings");
    expect(textOf(1)).toContain("INSERT INTO location_settings");
    expect(valuesOf(1)).toEqual(["o1", "optional", true, "optional", true]);
  });

  it("dbGetSites reads the org's sites in name order and tags the cache", async () => {
    sql.mockResolvedValue([]);
    await db.ensureLocationTables();
    sql.mockReset();
    sql.mockResolvedValue([{ id: 1, name: "Depot" }]);
    await expect(db.dbGetSites("o1")).resolves.toEqual([
      { id: 1, name: "Depot" },
    ]);
    expect(textOf(0)).toContain("SELECT * FROM sites WHERE org_id =");
    expect(textOf(0)).toContain("ORDER BY name ASC");
    expect(valuesOf(0)).toEqual(["o1"]);
    expect(cacheTag).toHaveBeenCalledWith("sites-o1");
  });

  it("dbGetSitesForEnforcement reads the sites without the cache", async () => {
    sql.mockResolvedValue([]);
    await db.ensureLocationTables();
    sql.mockReset();
    sql.mockResolvedValue([{ id: 1, name: "Depot" }]);
    await expect(db.dbGetSitesForEnforcement("o1")).resolves.toEqual([
      { id: 1, name: "Depot" },
    ]);
    expect(sql).toHaveBeenCalledTimes(1);
    expect(textOf(0)).toContain("SELECT * FROM sites WHERE org_id =");
    expect(valuesOf(0)).toEqual(["o1"]);
  });

  it("dbCreateSite upserts the parent settings row, then inserts the site", async () => {
    sql.mockResolvedValue([]);
    await db.ensureLocationTables();
    sql.mockReset();
    sql
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 1, name: "Depot" }]);
    await expect(
      db.dbCreateSite("o1", "Depot", 45.4215, -75.6972, 150),
    ).resolves.toEqual({ id: 1, name: "Depot" });
    expect(textOf(0)).toContain("INSERT INTO settings");
    expect(textOf(1)).toContain("INSERT INTO sites");
    expect(valuesOf(1)).toEqual(["o1", "Depot", 45.4215, -75.6972, 150, null]);
  });

  it("dbCreateSite writes address when provided", async () => {
    sql.mockResolvedValue([]);
    await db.ensureLocationTables();
    sql.mockReset();
    sql
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 2, name: "Headquarters", address: "111 Albert St" },
      ]);
    await expect(
      db.dbCreateSite(
        "o1",
        "Headquarters",
        45.4215,
        -75.6972,
        150,
        "111 Albert St",
      ),
    ).resolves.toEqual({
      id: 2,
      name: "Headquarters",
      address: "111 Albert St",
    });
    expect(valuesOf(1)).toEqual([
      "o1",
      "Headquarters",
      45.4215,
      -75.6972,
      150,
      "111 Albert St",
    ]);
  });

  it("dbUpdateSite updates by id within the org", async () => {
    sql.mockResolvedValue([]);
    await db.ensureLocationTables();
    sql.mockReset();
    sql.mockResolvedValue([{ id: 1, name: "Yard" }]);
    await expect(
      db.dbUpdateSite(1, "o1", "Yard", 45, -75, 200),
    ).resolves.toEqual({ id: 1, name: "Yard" });
    expect(textOf(0)).toContain("UPDATE sites");
    expect(valuesOf(0)).toEqual(["Yard", 45, -75, 200, null, 1, "o1"]);
  });

  it("dbUpdateSite returns undefined when no row matches", async () => {
    sql.mockResolvedValue([]);
    await expect(
      db.dbUpdateSite(1, "o1", "Yard", 45, -75, 200),
    ).resolves.toBeUndefined();
  });

  it("dbDeleteSite deletes by id within the org", async () => {
    sql.mockResolvedValue([]);
    await db.ensureLocationTables();
    sql.mockReset();
    sql.mockResolvedValue([{ id: 1 }]);
    await expect(db.dbDeleteSite(1, "o1")).resolves.toEqual({ id: 1 });
    expect(textOf(0)).toContain("DELETE FROM sites");
    expect(valuesOf(0)).toEqual([1, "o1"]);
  });

  it("dbDeleteSite returns undefined when no row matches", async () => {
    sql.mockResolvedValue([]);
    await expect(db.dbDeleteSite(1, "o1")).resolves.toBeUndefined();
  });
});

describe("clock in and out store location when given one", () => {
  const location = {
    latitude: 45.4215,
    longitude: -75.6972,
    accuracy: 7,
    siteName: "Depot",
    address: "111 Albert St",
  };

  it("dbClockIn writes the captured clock-in location", async () => {
    sql.mockReturnValueOnce("lock-query").mockReturnValueOnce("insert-query");
    sql.transaction.mockResolvedValue([[{}], [{ id: 5 }]]);
    await db.dbClockIn("u1", "o1", location);
    expect(textOf(1)).toContain("clock_in_site_name");
    expect(textOf(1)).toContain("clock_in_address");
    expect(valuesOf(1)).toEqual([
      "u1",
      "o1",
      45.4215,
      -75.6972,
      7,
      "Depot",
      "111 Albert St",
      "u1",
      "o1",
    ]);
  });

  it("dbClockOut writes the captured clock-out location", async () => {
    sql.mockResolvedValue([{ id: 6 }]);
    await db.dbClockOut("u1", "o1", location);
    expect(textOf()).toContain("clock_out_site_name =");
    expect(textOf()).toContain("clock_out_address =");
    expect(valuesOf()).toEqual([
      45.4215,
      -75.6972,
      7,
      "Depot",
      "111 Albert St",
      "u1",
      "o1",
    ]);
  });

  it("dbClockOut writes nulls when there is no location", async () => {
    sql.mockResolvedValue([{ id: 6 }]);
    await db.dbClockOut("u1", "o1", null);
    expect(valuesOf()).toEqual([null, null, null, null, null, "u1", "o1"]);
  });
});
