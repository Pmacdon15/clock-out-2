import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SEED_PAYROLL_RATES } from "@/lib/payroll";

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

type PayrollDb = typeof import("@/lib/payroll-db");
let pdb: PayrollDb;

const textOf = (call: number) =>
  (sql.mock.calls[call][0] as string[]).join("?").replace(/\s+/g, " ").trim();
const valuesOf = (call: number) => sql.mock.calls[call].slice(1);

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "postgres://test");
  pdb = await import("@/lib/payroll-db");
});

beforeEach(() => {
  sql.mockReset();
  sql.mockResolvedValue([]);
  pdb.resetPayrollTablesCheck();
});

async function primeTables() {
  await pdb.ensurePayrollTables();
  sql.mockClear();
}

describe("ensurePayrollTables", () => {
  it("creates the tables once per instance", async () => {
    await pdb.ensurePayrollTables();
    await pdb.ensurePayrollTables();
    expect(sql).toHaveBeenCalledTimes(3);
    expect(textOf(0)).toContain("CREATE TABLE IF NOT EXISTS settings");
    expect(textOf(1)).toContain("CREATE TABLE IF NOT EXISTS payroll_settings");
    expect(textOf(2)).toContain("CREATE TABLE IF NOT EXISTS payroll_rates");
  });

  it("retries after a failure", async () => {
    sql.mockRejectedValueOnce(new Error("down"));
    await expect(pdb.ensurePayrollTables()).rejects.toThrow("down");
    await pdb.ensurePayrollTables();
    expect(sql).toHaveBeenCalledTimes(4);
  });
});

describe("payroll settings", () => {
  it("reads one org's row, cached per org", async () => {
    await primeTables();
    sql.mockResolvedValueOnce([{ org_id: "org_1", province: "QC" }]);
    await expect(pdb.dbGetPayrollSettings("org_1")).resolves.toEqual({
      org_id: "org_1",
      province: "QC",
    });
    expect(cacheTag).toHaveBeenCalledWith("payroll-settings-org_1");
    expect(textOf(0)).toContain("FROM payroll_settings WHERE org_id = ?");
    expect(valuesOf(0)).toEqual(["org_1"]);
  });

  it("upserts the settings row after the parent row", async () => {
    await primeTables();
    sql.mockResolvedValueOnce([]);
    sql.mockResolvedValueOnce([{ org_id: "org_1" }]);
    await expect(
      pdb.dbUpdatePayrollSettings("org_1", true, "ON"),
    ).resolves.toEqual({ org_id: "org_1" });
    expect(textOf(0)).toContain("INSERT INTO settings");
    expect(textOf(1)).toContain("INSERT INTO payroll_settings");
    expect(valuesOf(1)).toEqual(["org_1", true, "ON", true, "ON"]);
  });
});

describe("payroll rates", () => {
  it("returns stored rows and drops ones that fail validation", async () => {
    await primeTables();
    const bad = { ...SEED_PAYROLL_RATES[0], effectiveFrom: "soon" };
    sql.mockResolvedValueOnce([
      { rates: SEED_PAYROLL_RATES[1] },
      { rates: bad },
    ]);
    await expect(pdb.dbGetPayrollRates()).resolves.toEqual([
      SEED_PAYROLL_RATES[1],
    ]);
    expect(cacheTag).toHaveBeenCalledWith(pdb.PAYROLL_RATES_TAG);
    expect(cacheLife).toHaveBeenCalledWith("days");
  });

  it("upserts a row by jurisdiction and date", async () => {
    await primeTables();
    const row = SEED_PAYROLL_RATES[0];
    await pdb.dbUpsertPayrollRates(row, "https://cra.example/jul");
    expect(textOf(0)).toContain("INSERT INTO payroll_rates");
    expect(textOf(0)).toContain("ON CONFLICT (jurisdiction, effective_from)");
    const json = JSON.stringify(row);
    expect(valuesOf(0)).toEqual([
      "CA",
      "2026-01-01",
      json,
      "https://cra.example/jul",
      json,
      "https://cra.example/jul",
    ]);
  });
});
