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
  type CustomDeduction,
  customDeductionsFor,
  isProvinceCode,
  MAX_CUSTOM_DEDUCTIONS,
  mergePayrollRates,
  normalizePayrollSettings,
  type PayrollRates,
  type PayrollSettingsData,
  type PayrollView,
  sameFigures,
  selectPayrollRates,
  toCustomDeduction,
  validateCustomDeduction,
  validatePayrollRates,
} from "./payroll";
import {
  dbDeleteCustomDeduction,
  dbDeleteTaxClaims,
  dbGetCustomDeductions,
  dbGetPayrollRates,
  dbGetPayrollSettings,
  dbGetTaxClaims,
  dbInsertCustomDeduction,
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
 * The org's payroll deduction settings, every known rate row, and the TD1
 * claims and custom deductions the caller may see: every member's for
 * admins, only their own for everyone else. Every member may read it:
 * members see deductions on their own pay estimate.
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
    const isAdmin = orgRole === "org:admin";
    const [settings, rates, claimRows, deductionRows] = await Promise.all([
      dbGetPayrollSettings(orgId),
      loadPayrollRates(),
      dbGetTaxClaims(orgId),
      loadCustomDeductions(orgId),
    ]);
    const claims = claimRows
      .filter((row) => isAdmin || row.user_id === userId)
      .map(toTaxClaims)
      .filter((row): row is TaxClaims => row !== null);
    const deductions = deductionRows
      .map(toCustomDeduction)
      .filter((row): row is CustomDeduction => row !== null);
    return {
      ok: true,
      value: {
        ...normalizePayrollSettings(settings),
        rates,
        claims,
        customDeductions: isAdmin
          ? deductions
          : customDeductionsFor(deductions, userId),
      },
    };
  } catch (e) {
    console.error("Error fetching payroll settings: ", e);
    return { ok: false, error: { reason: "Error fetching payroll settings" } };
  }
}

/** Custom deduction rows; a failed read means none rather than no payroll. */
async function loadCustomDeductions(orgId: string) {
  try {
    return await dbGetCustomDeductions(orgId);
  } catch (e) {
    console.error("Error fetching custom deductions: ", e);
    return [];
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
 * removed so the basic personal amounts apply. Admins may save them for any
 * member of their active organization; every member may save their own.
 */
export async function updateMemberTaxClaimsDal(
  memberId: unknown,
  federalClaim: unknown,
  provincialClaim: unknown,
  additionalTax: unknown,
): Promise<Result<{ org_id: string; claims: TaxClaims | null }, Failure>> {
  const { userId, orgId, orgRole } = await auth.protect();
  if (!userId || !orgId) {
    return err({ reason: "Unauthorized" });
  }
  const isSelf = memberId === userId;
  if (orgRole !== "org:admin" && !isSelf) {
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
  // The caller is a member of the active org, so their own id needs no lookup.
  if (!isSelf) {
    const members = await getOrgMembers();
    if (!members.some((member) => member.id === memberId)) {
      return err({ reason: "Member not found" });
    }
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

/**
 * Adds a custom deduction (RRSP, union dues, ...) for one member, or for
 * every member when `memberId` is null. Admins only.
 */
export async function addCustomDeductionDal(input: {
  memberId: unknown;
  name: unknown;
  kind: unknown;
  amount: unknown;
  preTax: unknown;
}): Promise<Result<{ org_id: string; deduction: CustomDeduction }, Failure>> {
  const { userId, orgId, orgRole } = await auth.protect();
  if (!userId || !orgId || orgRole !== "org:admin") {
    return err({ reason: "Unauthorized" });
  }
  const invalid = validateCustomDeduction(input);
  if (invalid) return err({ reason: invalid });
  const { memberId } = input;
  if (memberId !== null && typeof memberId !== "string") {
    return err({ reason: "Member not found" });
  }
  try {
    if (memberId !== null) {
      const members = await getOrgMembers();
      if (!members.some((member) => member.id === memberId)) {
        return err({ reason: "Member not found" });
      }
    }
    const existing = await dbGetCustomDeductions(orgId);
    if (existing.length >= MAX_CUSTOM_DEDUCTIONS) {
      return err({
        reason: `An organization can have up to ${MAX_CUSTOM_DEDUCTIONS} custom deductions`,
      });
    }
    const row = await dbInsertCustomDeduction(orgId, {
      userId: memberId,
      name: String(input.name).trim(),
      kind: input.kind as CustomDeduction["kind"],
      amount: input.amount as number,
      preTax: input.preTax as boolean,
    });
    const deduction = toCustomDeduction(row);
    if (!deduction) return err({ reason: "Failed to save the deduction" });
    return ok({ org_id: orgId, deduction });
  } catch (e) {
    console.error("Add custom deduction error: ", e);
    return err({ reason: "Failed to save the deduction" });
  }
}

/** Removes one of the org's custom deductions. Admins only. */
export async function deleteCustomDeductionDal(
  id: unknown,
): Promise<Result<{ org_id: string }, Failure>> {
  const { userId, orgId, orgRole } = await auth.protect();
  if (!userId || !orgId || orgRole !== "org:admin") {
    return err({ reason: "Unauthorized" });
  }
  const numericId = typeof id === "string" ? Number(id) : id;
  if (
    typeof numericId !== "number" ||
    !Number.isSafeInteger(numericId) ||
    numericId <= 0
  ) {
    return err({ reason: "Deduction not found" });
  }
  try {
    const removed = await dbDeleteCustomDeduction(orgId, numericId);
    if (removed === 0) return err({ reason: "Deduction not found" });
    return ok({ org_id: orgId });
  } catch (e) {
    console.error("Delete custom deduction error: ", e);
    return err({ reason: "Failed to remove the deduction" });
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
