// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type PayrollRates, SEED_PAYROLL_RATES } from "@/lib/payroll";

const mocks = vi.hoisted(() => ({
  protect: vi.fn(),
  revalidateTag: vi.fn(),
  dbGetPayrollRates: vi.fn(),
  dbGetPayrollSettings: vi.fn(),
  dbUpdatePayrollSettings: vi.fn(),
  dbUpsertPayrollRates: vi.fn(),
  fetchCraPayrollRates: vi.fn(),
  dbGetTaxClaims: vi.fn(),
  dbUpsertTaxClaims: vi.fn(),
  dbDeleteTaxClaims: vi.fn(),
  getOrgMembers: vi.fn(),
}));

vi.mock("@/lib/dal", () => ({ getOrgMembers: mocks.getOrgMembers }));

vi.mock("@clerk/nextjs/server", () => ({ auth: { protect: mocks.protect } }));
vi.mock("next/cache", () => ({ revalidateTag: mocks.revalidateTag }));
vi.mock("@/lib/payroll-db", () => ({
  PAYROLL_RATES_TAG: "payroll-rates",
  dbGetPayrollRates: mocks.dbGetPayrollRates,
  dbGetPayrollSettings: mocks.dbGetPayrollSettings,
  dbUpdatePayrollSettings: mocks.dbUpdatePayrollSettings,
  dbUpsertPayrollRates: mocks.dbUpsertPayrollRates,
  dbGetTaxClaims: mocks.dbGetTaxClaims,
  dbUpsertTaxClaims: mocks.dbUpsertTaxClaims,
  dbDeleteTaxClaims: mocks.dbDeleteTaxClaims,
}));
vi.mock("@/lib/cra-rates", () => ({
  fetchCraPayrollRates: mocks.fetchCraPayrollRates,
}));

import {
  getOrgPayroll,
  syncPayrollRatesFromCra,
  updateMemberTaxClaimsDal,
  updatePayrollSettingsDal,
} from "@/lib/payroll-dal";

const admin = { userId: "u1", orgId: "org_1", orgRole: "org:admin" };
const member = { userId: "u2", orgId: "org_1", orgRole: "org:member" };
const [CA, QC] = SEED_PAYROLL_RATES;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.protect.mockResolvedValue(admin);
  mocks.dbGetPayrollRates.mockResolvedValue([]);
  mocks.dbGetPayrollSettings.mockResolvedValue(undefined);
  mocks.dbUpsertPayrollRates.mockResolvedValue(undefined);
  mocks.dbGetTaxClaims.mockResolvedValue([]);
  mocks.dbUpsertTaxClaims.mockResolvedValue({});
  mocks.dbDeleteTaxClaims.mockResolvedValue(undefined);
  mocks.getOrgMembers.mockResolvedValue([{ id: "u2", name: "Bo" }]);
});

const claimRow = (user_id: string, federal_claim: number | null) => ({
  org_id: "org_1",
  user_id,
  federal_claim,
  provincial_claim: null,
  additional_tax: 0,
});

describe("getOrgPayroll", () => {
  it("requires an org", async () => {
    mocks.protect.mockResolvedValue({ userId: "u1", orgId: null });
    await expect(getOrgPayroll()).resolves.toEqual({
      ok: false,
      error: { reason: "Unauthorized or no organization selected" },
    });
  });

  it("gives members the settings and the seed plus stored rates", async () => {
    mocks.protect.mockResolvedValue(member);
    const stored = { ...CA, effectiveFrom: "2027-01-01" };
    mocks.dbGetPayrollRates.mockResolvedValue([stored]);
    mocks.dbGetPayrollSettings.mockResolvedValue({
      org_id: "org_1",
      deductions_enabled: true,
      province: "QC",
    });
    await expect(getOrgPayroll()).resolves.toEqual({
      ok: true,
      value: {
        enabled: true,
        province: "QC",
        rates: [stored, CA, QC],
        claims: [],
      },
    });
    expect(mocks.dbGetPayrollSettings).toHaveBeenCalledWith("org_1");
  });

  it("falls back to the seed rates when the rate table can't be read", async () => {
    mocks.dbGetPayrollRates.mockRejectedValue(new Error("down"));
    const result = await getOrgPayroll();
    expect(result).toEqual({
      ok: true,
      value: { enabled: false, province: "SK", rates: [CA, QC], claims: [] },
    });
  });

  it("gives admins every member's TD1 claims and drops unusable rows", async () => {
    mocks.dbGetTaxClaims.mockResolvedValue([
      claimRow("u1", 16452),
      claimRow("u2", null),
      claimRow("u3", -5),
    ]);
    const result = await getOrgPayroll();
    expect(result.ok && result.value.claims).toEqual([
      {
        userId: "u1",
        federalClaim: 16452,
        provincialClaim: null,
        additionalTax: 0,
      },
      {
        userId: "u2",
        federalClaim: null,
        provincialClaim: null,
        additionalTax: 0,
      },
    ]);
    expect(mocks.dbGetTaxClaims).toHaveBeenCalledWith("org_1");
  });

  it("gives members only their own TD1 claims", async () => {
    mocks.protect.mockResolvedValue(member);
    mocks.dbGetTaxClaims.mockResolvedValue([
      claimRow("u1", 16452),
      claimRow("u2", 20000),
    ]);
    const result = await getOrgPayroll();
    expect(result.ok && result.value.claims).toEqual([
      {
        userId: "u2",
        federalClaim: 20000,
        provincialClaim: null,
        additionalTax: 0,
      },
    ]);
  });

  it("reports a settings read failure", async () => {
    mocks.dbGetPayrollSettings.mockRejectedValue(new Error("down"));
    await expect(getOrgPayroll()).resolves.toEqual({
      ok: false,
      error: { reason: "Error fetching payroll settings" },
    });
  });
});

describe("updatePayrollSettingsDal", () => {
  it("is admin-only", async () => {
    mocks.protect.mockResolvedValue(member);
    const result = await updatePayrollSettingsDal(true, "ON");
    expect(result._unsafeUnwrapErr()).toEqual({ reason: "Unauthorized" });
    expect(mocks.dbUpdatePayrollSettings).not.toHaveBeenCalled();
  });

  it.each([
    ["yes", "ON"],
    [true, "Ontario"],
  ])("rejects %j / %j", async (enabled, province) => {
    const result = await updatePayrollSettingsDal(enabled, province);
    expect(result._unsafeUnwrapErr()).toEqual({
      reason: "Invalid payroll settings",
    });
  });

  it("saves valid settings for the admin's org", async () => {
    const row = { org_id: "org_1", deductions_enabled: true, province: "ON" };
    mocks.dbUpdatePayrollSettings.mockResolvedValue(row);
    const result = await updatePayrollSettingsDal(true, "ON");
    expect(result._unsafeUnwrap()).toEqual(row);
    expect(mocks.dbUpdatePayrollSettings).toHaveBeenCalledWith(
      "org_1",
      true,
      "ON",
    );
  });

  it("reports a write failure", async () => {
    mocks.dbUpdatePayrollSettings.mockRejectedValue(new Error("down"));
    const result = await updatePayrollSettingsDal(false, "SK");
    expect(result._unsafeUnwrapErr()).toEqual({
      reason: "Failed to update payroll settings",
    });
  });
});

describe("updateMemberTaxClaimsDal", () => {
  it("is admin-only", async () => {
    mocks.protect.mockResolvedValue(member);
    const result = await updateMemberTaxClaimsDal("u2", 1, null, 0);
    expect(result._unsafeUnwrapErr()).toEqual({ reason: "Unauthorized" });
  });

  it.each([
    [42, 1, null, 0],
    ["u2", -1, null, 0],
    ["u2", null, "x", 0],
    ["u2", null, null, null],
  ])("rejects %j / %j / %j / %j", async (id, fed, prov, extra) => {
    const result = await updateMemberTaxClaimsDal(id, fed, prov, extra);
    expect(result._unsafeUnwrapErr()).toEqual({
      reason: "Invalid TD1 amounts",
    });
  });

  it("only saves for members of the org", async () => {
    const result = await updateMemberTaxClaimsDal("u9", 1, null, 0);
    expect(result._unsafeUnwrapErr()).toEqual({ reason: "Member not found" });
    expect(mocks.dbUpsertTaxClaims).not.toHaveBeenCalled();
  });

  it("saves entered amounts", async () => {
    const result = await updateMemberTaxClaimsDal("u2", 16452, 20000, 5);
    const claims = {
      userId: "u2",
      federalClaim: 16452,
      provincialClaim: 20000,
      additionalTax: 5,
    };
    expect(result._unsafeUnwrap()).toEqual({ org_id: "org_1", claims });
    expect(mocks.dbUpsertTaxClaims).toHaveBeenCalledWith("org_1", claims);
  });

  it("removes the row when nothing is entered", async () => {
    const result = await updateMemberTaxClaimsDal("u2", null, null, 0);
    expect(result._unsafeUnwrap()).toEqual({ org_id: "org_1", claims: null });
    expect(mocks.dbDeleteTaxClaims).toHaveBeenCalledWith("org_1", "u2");
    expect(mocks.dbUpsertTaxClaims).not.toHaveBeenCalled();
  });

  it("reports a write failure", async () => {
    mocks.dbUpsertTaxClaims.mockRejectedValue(new Error("down"));
    const result = await updateMemberTaxClaimsDal("u2", 1, null, 0);
    expect(result._unsafeUnwrapErr()).toEqual({
      reason: "Failed to save TD1 amounts",
    });
  });
});

describe("syncPayrollRatesFromCra", () => {
  const source = "https://cra.example/t4127-jul.html";
  const fetched = (rates: PayrollRates[]) =>
    vi.fn().mockResolvedValue({ rates, source });

  it("stores nothing when the figures in effect are the same", async () => {
    const july = SEED_PAYROLL_RATES.map((r) => ({
      ...r,
      effectiveFrom: "2026-07-01",
    }));
    await expect(syncPayrollRatesFromCra(fetched(july))).resolves.toEqual({
      source,
      updated: [],
      unchanged: ["CA@2026-07-01", "QC@2026-07-01"],
      rejected: [],
    });
    expect(mocks.dbUpsertPayrollRates).not.toHaveBeenCalled();
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });

  it("stores changed and first-seen rows and refreshes the cache", async () => {
    const ca2027 = {
      ...CA,
      effectiveFrom: "2027-01-01",
      ei: { ...CA.ei, employeeRate: 0.0164, maxEmployeePremium: 1129.96 },
    };
    const early = { ...QC, effectiveFrom: "2025-01-01" };
    const result = await syncPayrollRatesFromCra(fetched([ca2027, early]));
    expect(result.updated).toEqual(["CA@2027-01-01", "QC@2025-01-01"]);
    expect(mocks.dbUpsertPayrollRates).toHaveBeenCalledWith(ca2027, source);
    expect(mocks.revalidateTag).toHaveBeenCalledWith("payroll-rates", {
      expire: 0,
    });
  });

  it("rejects rows that fail validation and keeps the rest", async () => {
    const bad = {
      ...CA,
      effectiveFrom: "2027-01-01",
      pension: { ...CA.pension, rate: 5.95 },
    };
    const result = await syncPayrollRatesFromCra(fetched([bad]));
    expect(result.rejected).toEqual([
      { row: "CA@2027-01-01", reason: "Rate out of range" },
    ]);
    expect(mocks.dbUpsertPayrollRates).not.toHaveBeenCalled();
  });

  it("uses the CRA fetcher by default", async () => {
    mocks.fetchCraPayrollRates.mockRejectedValue(new Error("CRA down"));
    await expect(syncPayrollRatesFromCra()).rejects.toThrow("CRA down");
  });
});
