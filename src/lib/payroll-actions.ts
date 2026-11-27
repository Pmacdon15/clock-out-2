"use server";

import { updateTag } from "next/cache";
import {
  updateMemberTaxClaimsDal,
  updatePayrollSettingsDal,
} from "./payroll-dal";

export async function updatePayrollSettingsAction(
  deductionsEnabled: boolean,
  province: string,
) {
  const result = await updatePayrollSettingsDal(deductionsEnabled, province);
  return result.match(
    (row) => {
      updateTag(`payroll-settings-${row.org_id}`);
      return { success: true as const, data: row };
    },
    (e) => ({ success: false as const, error: e.reason }),
  );
}

export async function updateMemberTaxClaimsAction(
  memberId: string,
  federalClaim: number | null,
  provincialClaim: number | null,
  additionalTax: number,
) {
  const result = await updateMemberTaxClaimsDal(
    memberId,
    federalClaim,
    provincialClaim,
    additionalTax,
  );
  return result.match(
    (saved) => {
      updateTag(`tax-claims-${saved.org_id}`);
      return { success: true as const, data: saved.claims };
    },
    (e) => ({ success: false as const, error: e.reason }),
  );
}
