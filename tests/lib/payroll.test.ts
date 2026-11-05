import { describe, expect, it } from "vitest";
import {
  computeDeductionsForPeriods,
  computePeriodDeductions,
  DEFAULT_PROVINCE,
  EMPTY_YEAR_TO_DATE,
  earlierInYearRange,
  formatRate,
  isProvinceCode,
  jurisdictionFor,
  mergePayrollRates,
  normalizePayrollSettings,
  type PayrollRates,
  PROVINCES,
  provinceName,
  SEED_PAYROLL_RATES,
  sameFigures,
  selectPayrollRates,
  sumDeductions,
  validatePayrollRates,
} from "@/lib/payroll";

const [CA, QC] = SEED_PAYROLL_RATES;

const withChanges = (
  base: PayrollRates,
  changes: Partial<{
    effectiveFrom: string;
    jurisdiction: string;
    pension: Partial<PayrollRates["pension"]>;
    pension2: Partial<PayrollRates["pension2"]>;
    ei: Partial<PayrollRates["ei"]>;
  }>,
) =>
  ({
    ...base,
    ...changes,
    pension: { ...base.pension, ...changes.pension },
    pension2: { ...base.pension2, ...changes.pension2 },
    ei: { ...base.ei, ...changes.ei },
  }) as PayrollRates;

describe("provinces", () => {
  it("lists all 13 provinces and territories", () => {
    expect(PROVINCES).toHaveLength(13);
    expect(isProvinceCode("ON")).toBe(true);
    expect(isProvinceCode("XX")).toBe(false);
    expect(isProvinceCode(undefined)).toBe(false);
  });

  it("maps Quebec to QC and everything else to federal rates", () => {
    expect(jurisdictionFor("QC")).toBe("QC");
    for (const { code } of PROVINCES.filter((p) => p.code !== "QC")) {
      expect(jurisdictionFor(code)).toBe("CA");
    }
  });

  it("names provinces, falling back to the code", () => {
    expect(provinceName("SK")).toBe("Saskatchewan");
    expect(provinceName("ZZ" as never)).toBe("ZZ");
  });
});

describe("seed rates", () => {
  it("are the CRA's 2026 figures and pass validation", () => {
    expect(CA.pension).toEqual({
      rate: 0.0595,
      basicExemption: 3500,
      ympe: 74600,
      maxContribution: 4230.45,
    });
    expect(CA.ei.maxEmployeePremium).toBe(1123.07);
    expect(QC.pension.rate).toBe(0.063);
    expect(QC.ei.employeeRate).toBe(0.013);
    for (const rates of SEED_PAYROLL_RATES) {
      expect(validatePayrollRates(rates)).toBeNull();
    }
  });
});

describe("mergePayrollRates / selectPayrollRates", () => {
  const ca2027 = withChanges(CA, {
    effectiveFrom: "2027-01-01",
    pension: { ympe: 76000 },
  });

  it("puts stored rows over seed rows, newest first", () => {
    const replacement = withChanges(CA, { pension: { maxContribution: 1 } });
    const merged = mergePayrollRates([ca2027, replacement]);
    expect(merged.map((r) => `${r.jurisdiction}${r.effectiveFrom}`)).toEqual([
      "CA2027-01-01",
      "CA2026-01-01",
      "QC2026-01-01",
    ]);
    expect(merged[1].pension.maxContribution).toBe(1);
  });

  it("uses the latest row on or before the pay date", () => {
    const rows = mergePayrollRates([ca2027]);
    expect(selectPayrollRates(rows, "CA", "2026-12-31")).toBe(CA);
    expect(selectPayrollRates(rows, "CA", "2027-01-01")).toBe(ca2027);
    expect(selectPayrollRates(rows, "QC", "2027-06-01")).toBe(QC);
    expect(selectPayrollRates(rows, "CA", "2025-12-31")).toBeNull();
  });

  it("prefers the later row when rows arrive oldest first", () => {
    expect(selectPayrollRates([CA, ca2027], "CA", "2028-01-01")).toBe(ca2027);
  });

  it("compares figures only", () => {
    expect(sameFigures(CA, { ...CA, effectiveFrom: "2026-07-01" })).toBe(true);
    expect(sameFigures(CA, ca2027)).toBe(false);
  });
});

describe("computePeriodDeductions", () => {
  it("prorates the basic exemption over the pay periods", () => {
    // Weekly $1,000: CPP = 5.95% × (1000 − 3500/52) = 55.50
    const { deductions, ytd } = computePeriodDeductions(1000, CA, 52);
    expect(deductions).toEqual({
      gross: 1000,
      pension: 55.5,
      pension2: 0,
      ei: 16.3,
      total: 71.8,
      net: 928.2,
      employerCost: 78.32,
    });
    expect(ytd).toEqual({
      pensionableEarnings: 1000,
      pension: 55.5,
      pension2: 0,
      ei: 16.3,
      employerEi: 22.82,
    });
  });

  it("uses Quebec's QPP and EI rates", () => {
    const { deductions } = computePeriodDeductions(1000, QC, 52);
    // QPP = 6.3% × (1000 − 3500/52); EI = 1.30%
    expect(deductions.pension).toBe(58.76);
    expect(deductions.ei).toBe(13);
  });

  it("never deducts below zero or on negative pay", () => {
    const { deductions } = computePeriodDeductions(-50, CA, 52);
    expect(deductions).toMatchObject({ gross: 0, pension: 0, ei: 0, net: 0 });
    // Tiny weekly pay is under the prorated exemption.
    expect(computePeriodDeductions(40, CA, 52).deductions.pension).toBe(0);
  });

  it("treats zero periods as one", () => {
    expect(computePeriodDeductions(10000, CA, 0).deductions.pension).toBe(
      Math.round(0.0595 * (10000 - 3500) * 100) / 100,
    );
  });

  it("stops contributions at the annual maximums mid-year", () => {
    const ytd = {
      ...EMPTY_YEAR_TO_DATE,
      pensionableEarnings: 70000,
      pension: 4200,
      ei: 1120,
      employerEi: 1570,
    };
    const { deductions } = computePeriodDeductions(2000, CA, 52, ytd);
    expect(deductions.pension).toBe(30.45);
    expect(deductions.ei).toBe(3.07);
    expect(deductions.employerCost).toBe(Math.round((30.45 + 2.3) * 100) / 100);
    // Earnings crossed the YMPE (74,600)? 70,000 + 2,000 doesn't, so no CPP2.
    expect(deductions.pension2).toBe(0);
  });

  it("charges CPP2 only on earnings between the YMPE and the YAMPE", () => {
    const ytd = { ...EMPTY_YEAR_TO_DATE, pensionableEarnings: 74000 };
    // 74,000 → 76,000: 1,400 is above the YMPE.
    expect(computePeriodDeductions(2000, CA, 52, ytd).deductions.pension2).toBe(
      56,
    );
    // Already past the YAMPE: nothing more.
    const past = { ...EMPTY_YEAR_TO_DATE, pensionableEarnings: 90000 };
    expect(
      computePeriodDeductions(2000, CA, 52, past).deductions.pension2,
    ).toBe(0);
    // Capped at the CPP2 maximum.
    const nearMax = { ...ytd, pension2: 400 };
    expect(
      computePeriodDeductions(2000, CA, 52, nearMax).deductions.pension2,
    ).toBe(16);
  });
});

describe("computeDeductionsForPeriods", () => {
  it("accumulates the year-to-date across periods in date order", () => {
    const periods = Array.from({ length: 40 }, (_, i) => ({
      date: `2026-${String(Math.floor(i / 4) + 1).padStart(2, "0")}-0${(i % 4) + 1}`,
      gross: 2500,
    })).reverse();
    const { total, unratedPeriods } = computeDeductionsForPeriods(
      periods,
      SEED_PAYROLL_RATES,
      "CA",
      52,
    );
    expect(unratedPeriods).toBe(0);
    // $100,000 for the year hits every maximum.
    expect(total.pension).toBe(4230.45);
    expect(total.pension2).toBe(416);
    expect(total.ei).toBe(1123.07);
    expect(total.gross).toBe(100000);
  });

  it("resets the year-to-date each calendar year and skips unrated periods", () => {
    const ca2027 = withChanges(CA, { effectiveFrom: "2027-01-01" });
    const big = { gross: 80000 };
    const { total, unratedPeriods } = computeDeductionsForPeriods(
      [
        { date: "2025-12-29", gross: 1000 },
        { date: "2026-06-01", ...big },
        { date: "2027-06-01", ...big },
      ],
      [CA, ca2027],
      "CA",
      1,
    );
    expect(unratedPeriods).toBe(1);
    expect(total.pension).toBe(4230.45 * 2);
    expect(total.ei).toBe(Math.round(1123.07 * 2 * 100) / 100);
  });
});

describe("computeDeductionsForPeriods with earlier periods", () => {
  it("counts earlier periods toward the maximums but not the total", () => {
    const { total, unratedPeriods } = computeDeductionsForPeriods(
      [{ date: "2026-06-01", gross: 10000 }],
      [CA],
      "CA",
      1,
      [
        // Before any rates: skipped, and not reported as unrated.
        { date: "2025-06-02", gross: 1000 },
        { date: "2026-06-01", gross: 90000 },
      ],
    );
    expect(unratedPeriods).toBe(0);
    expect(total.gross).toBe(10000);
    // $90,000 earlier already reached the CPP and EI maximums.
    expect(total.pension).toBe(0);
    expect(total.ei).toBe(0);
  });
});

describe("earlierInYearRange", () => {
  it("runs from Jan 1 of the start's pay-week year to the day before", () => {
    expect(earlierInYearRange("2026-03-01")).toEqual({
      start: "2026-01-01",
      end: "2026-02-28",
    });
    // Thu Jan 1, 2026 is in the week of Mon Dec 29, 2025.
    expect(earlierInYearRange("2026-01-01T00:00:00")).toEqual({
      start: "2025-01-01",
      end: "2025-12-31",
    });
  });

  it("is null without a start or an earlier day", () => {
    expect(earlierInYearRange(undefined)).toBeNull();
    // Mon Jan 1, 2029 starts both its week and its year.
    expect(earlierInYearRange("2029-01-01")).toBeNull();
  });
});

describe("sumDeductions / formatRate", () => {
  it("adds every field", () => {
    const one = computePeriodDeductions(1000, CA, 52).deductions;
    expect(sumDeductions([one, one]).total).toBe(143.6);
    expect(sumDeductions([]).net).toBe(0);
  });

  it("formats rates as percentages", () => {
    expect(formatRate(0.0595)).toBe("5.95%");
    expect(formatRate(0.02282)).toBe("2.282%");
  });
});

describe("normalizePayrollSettings", () => {
  it("defaults to off in the default province", () => {
    expect(normalizePayrollSettings(null)).toEqual({
      enabled: false,
      province: DEFAULT_PROVINCE,
    });
    expect(
      normalizePayrollSettings({ deductions_enabled: true, province: "QC" }),
    ).toEqual({ enabled: true, province: "QC" });
    expect(normalizePayrollSettings({ province: "nowhere" }).province).toBe(
      DEFAULT_PROVINCE,
    );
  });
});

describe("validatePayrollRates", () => {
  it.each([
    [{ jurisdiction: "ON" }, "Unknown jurisdiction"],
    [{ effectiveFrom: "July 1" }, "Invalid effective date"],
    [{ pension: { rate: 5.95 } }, "Rate out of range"],
    [{ ei: { employerRate: Number.NaN } }, "Rate out of range"],
    [{ pension: { ympe: 0 } }, "Amount out of range"],
    [{ ei: { maxEmployerPremium: 2_000_000 } }, "Amount out of range"],
    [
      { pension: { maxContribution: 4000 } },
      "CPP/QPP maximum does not match its rate",
    ],
    [
      { pension2: { yampe: 70000 } },
      "CPP2/QPP2 maximum does not match its rate",
    ],
    [
      { pension2: { maxContribution: 300 } },
      "CPP2/QPP2 maximum does not match its rate",
    ],
    [
      { ei: { maxEmployeePremium: 1000 } },
      "EI maximum does not match its rate",
    ],
    [
      { ei: { maxEmployerPremium: 1500 } },
      "EI maximum does not match its rate",
    ],
  ])("rejects %j", (changes, reason) => {
    expect(validatePayrollRates(withChanges(CA, changes))).toBe(reason);
  });

  it("rejects non-numeric values", () => {
    expect(
      validatePayrollRates(
        withChanges(CA, { pension: { rate: "x" as never } }),
      ),
    ).toBe("Rate out of range");
    expect(
      validatePayrollRates(
        withChanges(CA, { pension: { ympe: "x" as never } }),
      ),
    ).toBe("Amount out of range");
  });
});
