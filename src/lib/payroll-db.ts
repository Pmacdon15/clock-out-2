import { cacheLife, cacheTag } from "next/cache";
import { sql } from "./db";
import {
  type PayrollRates,
  type PayrollSettingsData,
  validatePayrollRates,
} from "./payroll";

/** Cache tag for the shared rate table (one for every org). */
export const PAYROLL_RATES_TAG = "payroll-rates";

let payrollTablesReady: Promise<void> | null = null;

/**
 * Payroll deduction settings (per org) and CRA rate rows (shared). Production
 * databases that predate them in schema.sql don't have the tables, so create
 * them on first use, like the overtime table. Runs once per server instance;
 * a failure is not cached, so the next call retries.
 */
export function ensurePayrollTables(): Promise<void> {
  payrollTablesReady ??= (async () => {
    await sql`
		CREATE TABLE IF NOT EXISTS settings (
			org_id TEXT PRIMARY KEY,
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)
	`;
    await sql`
		CREATE TABLE IF NOT EXISTS payroll_settings (
			org_id TEXT PRIMARY KEY REFERENCES settings(org_id) ON DELETE CASCADE,
			deductions_enabled BOOLEAN NOT NULL DEFAULT FALSE,
			province TEXT NOT NULL DEFAULT 'SK',
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)
	`;
    await sql`
		CREATE TABLE IF NOT EXISTS payroll_rates (
			jurisdiction TEXT NOT NULL,
			effective_from TEXT NOT NULL,
			rates JSONB NOT NULL,
			source TEXT,
			fetched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			PRIMARY KEY (jurisdiction, effective_from)
		)
	`;
  })().catch((error) => {
    payrollTablesReady = null;
    throw error;
  });
  return payrollTablesReady;
}

/** Test-only: forget that the table check ran. */
export function resetPayrollTablesCheck() {
  payrollTablesReady = null;
}

export async function dbGetPayrollSettings(orgId: string) {
  "use cache";
  cacheTag(`payroll-settings-${orgId}`);
  cacheLife("hours");
  await ensurePayrollTables();
  const [row] = await sql`
		SELECT * FROM payroll_settings WHERE org_id = ${orgId}
	`;
  return row as PayrollSettingsData | undefined;
}

export async function dbUpdatePayrollSettings(
  orgId: string,
  deductionsEnabled: boolean,
  province: string,
) {
  await ensurePayrollTables();
  await sql`
		INSERT INTO settings (org_id, updated_at)
		VALUES (${orgId}, NOW())
		ON CONFLICT (org_id) DO UPDATE SET updated_at = NOW()
	`;
  const [row] = await sql`
		INSERT INTO payroll_settings (org_id, deductions_enabled, province, updated_at)
		VALUES (${orgId}, ${deductionsEnabled}, ${province}, NOW())
		ON CONFLICT (org_id)
		DO UPDATE SET
            deductions_enabled = ${deductionsEnabled},
            province = ${province},
            updated_at = NOW()
		RETURNING *
	`;
  return row as PayrollSettingsData;
}

/**
 * Every stored rate row. A row that no longer passes validation is dropped
 * rather than used.
 */
export async function dbGetPayrollRates(): Promise<PayrollRates[]> {
  "use cache";
  cacheTag(PAYROLL_RATES_TAG);
  cacheLife("days");
  await ensurePayrollTables();
  const rows = (await sql`
		SELECT rates FROM payroll_rates ORDER BY effective_from DESC
	`) as { rates: PayrollRates }[];
  return rows
    .map((row) => row.rates)
    .filter((rates) => validatePayrollRates(rates) === null);
}

/** Stores (or replaces) one jurisdiction's row for one effective date. */
export async function dbUpsertPayrollRates(
  rates: PayrollRates,
  source: string,
) {
  await ensurePayrollTables();
  const json = JSON.stringify(rates);
  await sql`
		INSERT INTO payroll_rates (jurisdiction, effective_from, rates, source, fetched_at)
		VALUES (${rates.jurisdiction}, ${rates.effectiveFrom}, ${json}::jsonb, ${source}, NOW())
		ON CONFLICT (jurisdiction, effective_from)
		DO UPDATE SET rates = ${json}::jsonb, source = ${source}, fetched_at = NOW()
	`;
}
