// @vitest-environment node
import { err, ok } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateTag: vi.fn(),
  updatePayrollSettingsDal: vi.fn(),
  updateMemberTaxClaimsDal: vi.fn(),
  addCustomDeductionDal: vi.fn(),
  deleteCustomDeductionDal: vi.fn(),
}));

vi.mock("next/cache", () => ({ updateTag: mocks.updateTag }));
vi.mock("@/lib/payroll-dal", () => ({
  updatePayrollSettingsDal: mocks.updatePayrollSettingsDal,
  updateMemberTaxClaimsDal: mocks.updateMemberTaxClaimsDal,
  addCustomDeductionDal: mocks.addCustomDeductionDal,
  deleteCustomDeductionDal: mocks.deleteCustomDeductionDal,
}));

import {
  addCustomDeductionAction,
  deleteCustomDeductionAction,
  updateMemberTaxClaimsAction,
  updatePayrollSettingsAction,
} from "@/lib/payroll-actions";

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

describe("updateMemberTaxClaimsAction", () => {
  it("saves and refreshes the org's TD1 cache", async () => {
    const claims = {
      userId: "u2",
      federalClaim: 16452,
      provincialClaim: null,
      additionalTax: 0,
    };
    mocks.updateMemberTaxClaimsDal.mockResolvedValueOnce(
      ok({ org_id: "org_1", claims }),
    );
    await expect(
      updateMemberTaxClaimsAction("u2", 16452, null, 0),
    ).resolves.toEqual({ success: true, data: claims });
    expect(mocks.updateMemberTaxClaimsDal).toHaveBeenCalledWith(
      "u2",
      16452,
      null,
      0,
    );
    expect(mocks.updateTag).toHaveBeenCalledWith("tax-claims-org_1");
  });

  it("returns the failure reason", async () => {
    mocks.updateMemberTaxClaimsDal.mockResolvedValueOnce(
      err({ reason: "Member not found" }),
    );
    await expect(
      updateMemberTaxClaimsAction("u9", 1, null, 0),
    ).resolves.toEqual({ success: false, error: "Member not found" });
  });
});

describe("custom deduction actions", () => {
  const deduction = {
    id: "1",
    userId: null,
    name: "RRSP",
    kind: "fixed" as const,
    amount: 25,
    preTax: true,
  };

  it("adds and refreshes the org's deductions", async () => {
    mocks.addCustomDeductionDal.mockResolvedValueOnce(
      ok({ org_id: "org_1", deduction }),
    );
    const input = { ...deduction, memberId: null };
    await expect(addCustomDeductionAction(input)).resolves.toEqual({
      success: true,
      data: deduction,
    });
    expect(mocks.addCustomDeductionDal).toHaveBeenCalledWith(input);
    expect(mocks.updateTag).toHaveBeenCalledWith("custom-deductions-org_1");
  });

  it("removes and refreshes the org's deductions", async () => {
    mocks.deleteCustomDeductionDal.mockResolvedValueOnce(
      ok({ org_id: "org_1" }),
    );
    await expect(deleteCustomDeductionAction("1")).resolves.toEqual({
      success: true,
    });
    expect(mocks.updateTag).toHaveBeenCalledWith("custom-deductions-org_1");
  });

  it("returns the failure reason", async () => {
    mocks.deleteCustomDeductionDal.mockResolvedValueOnce(
      err({ reason: "Unauthorized" }),
    );
    await expect(deleteCustomDeductionAction("1")).resolves.toEqual({
      success: false,
      error: "Unauthorized",
    });
  });
});
