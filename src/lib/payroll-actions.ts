"use server";

import { updateTag } from "next/cache";
import { updatePayrollSettingsDal } from "./payroll-dal";

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
