import { auth } from "@clerk/nextjs/server";
import { err, ok, type Result } from "neverthrow";
import { revalidateTag } from "next/cache";
import { fetchCraPayrollRates } from "./cra-rates";
import { getOrgMembers } from "./dal";
import {
  hasEnteredClaims,
  isValidAdditionalTax,
  isValidClaimAmount,
  type TaxClaims,
  toTaxClaims,
} from "./income-tax";
import {
  isProvinceCode,
  mergePayrollRates,
  normalizePayrollSettings,
  type PayrollRates,
  type PayrollSettingsData,
  type PayrollView,
  sameFigures,
  selectPayrollRates,
  validatePayrollRates,
} from "./payroll";
import {
  dbDeleteTaxClaims,
  dbGetPayrollRates,
  dbGetPayrollSettings,
  dbGetTaxClaims,
  dbUpdatePayrollSettings,
  dbUpsertPayrollRates,
  dbUpsertTaxClaims,
  PAYROLL_RATES_TAG,
} from "./payroll-db";
import type { SerializableResult } from "./types";

type Failure = { reason: string };

/** Seed rates plus stored ones; a failed read falls back to the seed. */
async function loadPayrollRates(): Promise<PayrollRates[]> {
  try {
    return mergePayrollRates(await dbGetPayrollRates());
  } catch (e) {
    console.error("Error fetching payroll rates: ", e);
    return mergePayrollRates([]);
  }
}

/**
 * The org's payroll deduction settings, every known rate row and the TD1
 * claims the caller may see: every member's for admins, only their own for
 * everyone else. Every member may read it: members see deductions on their
 * own pay estimate.
 */
export async function getOrgPayroll(): Promise<
  SerializableResult<PayrollView, Failure>
> {
  const { userId, orgId, orgRole } = await auth.protect();
  if (!userId || !orgId) {
    return {
      ok: false,
      error: { reason: "Unauthorized or no organization selected" },
    };
  }
  try {
    const [settings, rates, claimRows] = await Promise.all([
      dbGetPayrollSettings(orgId),
      loadPayrollRates(),
      dbGetTaxClaims(orgId),
    ]);
    const claims = claimRows
      .filter((row) => orgRole === "org:admin" || row.user_id === userId)
      .map(toTaxClaims)
      .filter((row): row is TaxClaims => row !== null);
    return {
      ok: true,
      value: { ...normalizePayrollSettings(settings), rates, claims },
    };
  } catch (e) {
    console.error("Error fetching payroll settings: ", e);
    return { ok: false, error: { reason: "Error fetching payroll settings" } };
  }
}

/** Turns deductions on or off and sets the province. Admins only. */
export async function updatePayrollSettingsDal(
  deductionsEnabled: unknown,
  province: unknown,
): Promise<Result<PayrollSettingsData, Failure>> {
  const { userId, orgId, orgRole } = await auth.protect();
  if (!userId || !orgId || orgRole !== "org:admin") {
    return err({ reason: "Unauthorized" });
  }
  if (typeof deductionsEnabled !== "boolean" || !isProvinceCode(province)) {
    return err({ reason: "Invalid payroll settings" });
  }
  return await dbUpdatePayrollSettings(orgId, deductionsEnabled, province)
    .then((row) => ok(row))
    .catch((e) => {
      console.error("Update payroll settings error: ", e);
      return err({ reason: "Failed to update payroll settings" });
    });
}

/**
 * Saves one member's TD1 claim amounts; with nothing entered, the row is
 * removed so the basic personal amounts apply. Admins only, and only for
 * members of the admin's active organization.
 */
export async function updateMemberTaxClaimsDal(
  memberId: unknown,
  federalClaim: unknown,
  provincialClaim: unknown,
  additionalTax: unknown,
): Promise<Result<{ org_id: string; claims: TaxClaims | null }, Failure>> {
  const { userId, orgId, orgRole } = await auth.protect();
  if (!userId || !orgId || orgRole !== "org:admin") {
    return err({ reason: "Unauthorized" });
  }
  if (
    typeof memberId !== "string" ||
    !isValidClaimAmount(federalClaim) ||
    !isValidClaimAmount(provincialClaim) ||
    !isValidAdditionalTax(additionalTax)
  ) {
    return err({ reason: "Invalid TD1 amounts" });
  }
  const members = await getOrgMembers();
  if (!members.some((member) => member.id === memberId)) {
    return err({ reason: "Member not found" });
  }
  const claims: TaxClaims = {
    userId: memberId,
    federalClaim,
    provincialClaim,
    additionalTax,
  };
  try {
    if (!hasEnteredClaims(claims)) {
      await dbDeleteTaxClaims(orgId, memberId);
      return ok({ org_id: orgId, claims: null });
    }
    await dbUpsertTaxClaims(orgId, claims);
    return ok({ org_id: orgId, claims });
  } catch (e) {
    console.error("Update TD1 claims error: ", e);
    return err({ reason: "Failed to save TD1 amounts" });
  }
}

export type PayrollSyncResult = {
  source: string;
  /** "CA@2026-07-01" for each row stored. */
  updated: string[];
  /** Rows whose figures match what's already in effect. */
  unchanged: string[];
  /** Rows that failed validation and were not stored. */
  rejected: { row: string; reason: string }[];
};

/**
 * Pulls the current T4127 edition from the CRA and stores any jurisdiction
 * whose figures differ from the ones already in effect on that date. Rows
 * that fail validation are logged and skipped, so existing rates stay in use.
 * Callers must authorize the request first (the cron route checks
 * CRON_SECRET).
 */
export async function syncPayrollRatesFromCra(
  fetchRates: typeof fetchCraPayrollRates = fetchCraPayrollRates,
): Promise<PayrollSyncResult> {
  const { rates, source } = await fetchRates();
  const current = mergePayrollRates(await dbGetPayrollRates());
  const result: PayrollSyncResult = {
    source,
    updated: [],
    unchanged: [],
    rejected: [],
  };
  for (const row of rates) {
    const label = `${row.jurisdiction}@${row.effectiveFrom}`;
    const reason = validatePayrollRates(row);
    if (reason) {
      console.error(`[Payroll rates] Rejected ${label}: ${reason}`);
      result.rejected.push({ row: label, reason });
      continue;
    }
    const inEffect = selectPayrollRates(
      current,
      row.jurisdiction,
      row.effectiveFrom,
    );
    if (inEffect && sameFigures(inEffect, row)) {
      result.unchanged.push(label);
      continue;
    }
    await dbUpsertPayrollRates(row, source);
    result.updated.push(label);
  }
  if (result.updated.length > 0) {
    revalidateTag(PAYROLL_RATES_TAG, { expire: 0 });
  }
  return result;
}
