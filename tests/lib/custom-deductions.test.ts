import { describe, expect, it } from "vitest";
import { INCOME_TAX_TABLES } from "@/lib/income-tax";
import {
  type CustomDeduction,
  computeDeductionsForPeriods,
  computePeriodDeductions,
  customDeductionAmount,
  customDeductionsFor,
  describeCustomDeduction,
  SEED_PAYROLL_RATES,
  toCustomDeduction,
  validateCustomDeduction,
} from "@/lib/payroll";

const [CA] = SEED_PAYROLL_RATES;
const [tables] = INCOME_TAX_TABLES;

const deduction = (overrides: Partial<CustomDeduction>): CustomDeduction => ({
  id: "1",
  userId: null,
  name: "Dues",
  kind: "fixed",
  amount: 25,
  preTax: false,
  ...overrides,
});

describe("validateCustomDeduction", () => {
  const ok = { name: "RRSP", kind: "percent", amount: 5, preTax: true };

  it("accepts a named fixed amount or percentage", () => {
    expect(validateCustomDeduction(ok)).toBeNull();
    expect(
      validateCustomDeduction({ ...ok, kind: "fixed", amount: 10_000 }),
    ).toBeNull();
  });

  it.each([
    { name: "  " },
    { name: "x".repeat(41) },
    { kind: "weekly" },
    { amount: 0 },
    { amount: Number.NaN },
    { amount: "5" },
    { amount: 100.01 },
    { kind: "fixed", amount: 10_000.01 },
    { preTax: undefined },
  ])("rejects %j", (overrides) => {
    expect(validateCustomDeduction({ ...ok, ...overrides })).not.toBeNull();
  });
});

describe("custom deduction helpers", () => {
  it("works out a fixed amount or a share of gross", () => {
    expect(customDeductionAmount({ kind: "fixed", amount: 25 }, 1000)).toBe(25);
    expect(customDeductionAmount({ kind: "percent", amount: 5 }, 1000)).toBe(
      50,
    );
    expect(customDeductionAmount({ kind: "percent", amount: 5 }, -10)).toBe(0);
  });

  it("picks everyone's and the member's own", () => {
    const list = [
      deduction({ id: "1" }),
      deduction({ id: "2", userId: "u1" }),
      deduction({ id: "3", userId: "u2" }),
    ];
    expect(customDeductionsFor(list, "u1").map((d) => d.id)).toEqual([
      "1",
      "2",
    ]);
  });

  it("describes each kind", () => {
    expect(describeCustomDeduction(deduction({}))).toBe("$25.00 per week");
    expect(
      describeCustomDeduction(
        deduction({ kind: "percent", amount: 5, preTax: true }),
      ),
    ).toBe("5% of gross, before tax");
  });

  it("reads stored rows and drops unusable ones", () => {
    expect(
      toCustomDeduction({
        id: 4,
        user_id: null,
        name: " RRSP ",
        kind: "percent",
        amount: "5",
        pre_tax: true,
      }),
    ).toEqual({
      id: "4",
      userId: null,
      name: "RRSP",
      kind: "percent",
      amount: 5,
      preTax: true,
    });
    expect(toCustomDeduction(null)).toBeNull();
    expect(
      toCustomDeduction({ id: 1, name: "X", kind: "fixed", amount: -1 }),
    ).toBeNull();
  });
});

describe("computePeriodDeductions with custom deductions", () => {
  it("takes fixed and percentage deductions off net pay", () => {
    // Weekly $1,000: CPP 55.50 + EI 16.30, then $25 + 10% ($100).
    const { deductions, custom } = computePeriodDeductions(
      1000,
      CA,
      52,
      undefined,
      undefined,
      [
        deduction({ id: "a" }),
        deduction({ id: "b", kind: "percent", amount: 10 }),
      ],
    );
    expect(custom).toEqual({ a: 25, b: 100 });
    expect(deductions.other).toBe(125);
    expect(deductions.total).toBe(196.8);
    expect(deductions.net).toBe(803.2);
  });

  it("lowers income tax for before-tax deductions only", () => {
    const tax = { province: "SK" as const, tables };
    const plain = computePeriodDeductions(1000, CA, 52, undefined, tax);
    const after = computePeriodDeductions(1000, CA, 52, undefined, tax, [
      deduction({ amount: 100 }),
    ]);
    const before = computePeriodDeductions(1000, CA, 52, undefined, tax, [
      deduction({ amount: 100, preTax: true }),
    ]);
    const incomeTax = (r: typeof plain) =>
      r.deductions.federalTax + r.deductions.provincialTax;
    expect(incomeTax(after)).toBe(incomeTax(plain));
    expect(incomeTax(before)).toBeLessThan(incomeTax(plain));
    // CPP and EI don't change either way.
    expect(before.deductions.pension).toBe(plain.deductions.pension);
    expect(before.deductions.ei).toBe(plain.deductions.ei);
    expect(before.deductions.net).toBeGreaterThan(after.deductions.net);
  });

  it("never takes pay below zero", () => {
    const { deductions, custom } = computePeriodDeductions(
      1000,
      CA,
      52,
      undefined,
      undefined,
      [
        deduction({ id: "a", amount: 900 }),
        deduction({ id: "b", amount: 900 }),
      ],
    );
    expect(custom).toEqual({ a: 900, b: 28.2 });
    expect(deductions.net).toBe(0);
  });

  it("adds up each deduction over the periods", () => {
    const result = computeDeductionsForPeriods(
      [
        { date: "2026-01-05", gross: 1000 },
        { date: "2026-01-12", gross: 500 },
      ],
      [CA],
      "CA",
      52,
      undefined,
      undefined,
      [
        deduction({ id: "a" }),
        deduction({ id: "b", kind: "percent", amount: 2 }),
      ],
    );
    expect(result.customById).toEqual({ a: 50, b: 30 });
    expect(result.total.other).toBe(80);
  });
});
