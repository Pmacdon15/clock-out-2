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
    expect(sql).toHaveBeenCalledTimes(6);
    expect(textOf(3)).toContain("CREATE TABLE IF NOT EXISTS member_tax_claims");
    expect(textOf(4)).toContain(
      "CREATE TABLE IF NOT EXISTS payroll_custom_deductions",
    );
    expect(textOf(5)).toContain("payroll_custom_deductions_org_idx");
    expect(textOf(0)).toContain("CREATE TABLE IF NOT EXISTS settings");
    expect(textOf(1)).toContain("CREATE TABLE IF NOT EXISTS payroll_settings");
    expect(textOf(2)).toContain("CREATE TABLE IF NOT EXISTS payroll_rates");
  });

  it("retries after a failure", async () => {
    sql.mockRejectedValueOnce(new Error("down"));
    await expect(pdb.ensurePayrollTables()).rejects.toThrow("down");
    await pdb.ensurePayrollTables();
    expect(sql).toHaveBeenCalledTimes(7);
  });
});

describe("custom deductions", () => {
  it("reads one org's rows, cached per org", async () => {
    await primeTables();
    sql.mockResolvedValueOnce([{ id: 1 }]);
    await expect(pdb.dbGetCustomDeductions("org_1")).resolves.toEqual([
      { id: 1 },
    ]);
    expect(cacheTag).toHaveBeenCalledWith("custom-deductions-org_1");
    expect(textOf(0)).toContain("FROM payroll_custom_deductions");
    expect(valuesOf(0)).toEqual(["org_1"]);
  });

  it("inserts a row for the org", async () => {
    await primeTables();
    sql.mockResolvedValueOnce([{ id: 7 }]);
    await expect(
      pdb.dbInsertCustomDeduction("org_1", {
        userId: null,
        name: "RRSP",
        kind: "percent",
        amount: 5,
        preTax: true,
      }),
    ).resolves.toEqual({ id: 7 });
    expect(textOf(0)).toContain("INSERT INTO payroll_custom_deductions");
    expect(valuesOf(0)).toEqual(["org_1", null, "RRSP", "percent", 5, true]);
  });

  it("deletes only within the org and counts what went", async () => {
    await primeTables();
    sql.mockResolvedValueOnce([{ id: 7 }]);
    await expect(pdb.dbDeleteCustomDeduction("org_1", 7)).resolves.toBe(1);
    expect(textOf(0)).toContain("WHERE org_id = ? AND id = ?");
    expect(valuesOf(0)).toEqual(["org_1", 7]);
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

describe("TD1 claims", () => {
  const claims = {
    userId: "u1",
    federalClaim: 16452,
    provincialClaim: null,
    additionalTax: 5,
  };

  it("reads one org's rows, cached per org", async () => {
    await primeTables();
    sql.mockResolvedValueOnce([{ org_id: "org_1", user_id: "u1" }]);
    await expect(pdb.dbGetTaxClaims("org_1")).resolves.toEqual([
      { org_id: "org_1", user_id: "u1" },
    ]);
    expect(cacheTag).toHaveBeenCalledWith("tax-claims-org_1");
    expect(textOf(0)).toContain("FROM member_tax_claims WHERE org_id = ?");
    expect(valuesOf(0)).toEqual(["org_1"]);
  });

  it("upserts a member's row", async () => {
    await primeTables();
    sql.mockResolvedValueOnce([{ user_id: "u1" }]);
    await expect(pdb.dbUpsertTaxClaims("org_1", claims)).resolves.toEqual({
      user_id: "u1",
    });
    expect(textOf(0)).toContain("INSERT INTO member_tax_claims");
    expect(textOf(0)).toContain("ON CONFLICT (org_id, user_id)");
    expect(valuesOf(0)).toEqual([
      "org_1",
      "u1",
      16452,
      null,
      5,
      16452,
      null,
      5,
    ]);
  });

  it("deletes a member's row", async () => {
    await primeTables();
    await pdb.dbDeleteTaxClaims("org_1", "u1");
    expect(textOf(0)).toContain("DELETE FROM member_tax_claims");
    expect(valuesOf(0)).toEqual(["org_1", "u1"]);
  });
});
