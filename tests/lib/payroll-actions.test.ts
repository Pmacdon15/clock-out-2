// @vitest-environment node
import { err, ok } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateTag: vi.fn(),
  updatePayrollSettingsDal: vi.fn(),
}));

vi.mock("next/cache", () => ({ updateTag: mocks.updateTag }));
vi.mock("@/lib/payroll-dal", () => ({
  updatePayrollSettingsDal: mocks.updatePayrollSettingsDal,
}));

import { updatePayrollSettingsAction } from "@/lib/payroll-actions";

describe("updatePayrollSettingsAction", () => {
  it("saves and refreshes the org's payroll cache", async () => {
    const row = { org_id: "org_1", deductions_enabled: true, province: "QC" };
    mocks.updatePayrollSettingsDal.mockResolvedValueOnce(ok(row));
    await expect(updatePayrollSettingsAction(true, "QC")).resolves.toEqual({
      success: true,
      data: row,
    });
    expect(mocks.updatePayrollSettingsDal).toHaveBeenCalledWith(true, "QC");
    expect(mocks.updateTag).toHaveBeenCalledWith("payroll-settings-org_1");
  });

  it("returns the failure reason", async () => {
    mocks.updatePayrollSettingsDal.mockResolvedValueOnce(
      err({ reason: "Unauthorized" }),
    );
    await expect(updatePayrollSettingsAction(true, "QC")).resolves.toEqual({
      success: false,
      error: "Unauthorized",
    });
  });
});
