/**
 * Canadian payroll deductions: CPP/QPP (base and second additional) and EI.
 *
 * Rates are data, not code paths: each row is one jurisdiction's figures from
 * one CRA T4127 edition, keyed by the date it takes effect. Quebec is its own
 * jurisdiction (QPP instead of CPP, and a lower EI rate because QPIP covers
 * parental benefits); every other province and territory uses the federal
 * CPP and EI figures. A pay date uses the latest row that took effect on or
 * before it, so pay periods from earlier years keep their own year's rates.
 *
 * The figures are estimates for planning, not a payroll engine: income tax,
 * QPIP and other deductions are not calculated.
 */

export const PROVINCES = [
  { code: "AB", name: "Alberta" },
  { code: "BC", name: "British Columbia" },
  { code: "MB", name: "Manitoba" },
  { code: "NB", name: "New Brunswick" },
  { code: "NL", name: "Newfoundland and Labrador" },
  { code: "NS", name: "Nova Scotia" },
  { code: "NT", name: "Northwest Territories" },
  { code: "NU", name: "Nunavut" },
  { code: "ON", name: "Ontario" },
  { code: "PE", name: "Prince Edward Island" },
  { code: "QC", name: "Quebec" },
  { code: "SK", name: "Saskatchewan" },
  { code: "YT", name: "Yukon" },
] as const;

export type ProvinceCode = (typeof PROVINCES)[number]["code"];

/** "CA" is Canada except Quebec; "QC" is Quebec. */
export type PayrollJurisdiction = "CA" | "QC";

export const DEFAULT_PROVINCE: ProvinceCode = "SK";

export function isProvinceCode(value: unknown): value is ProvinceCode {
  return PROVINCES.some((province) => province.code === value);
}

export function jurisdictionFor(province: ProvinceCode): PayrollJurisdiction {
  return province === "QC" ? "QC" : "CA";
}

export function provinceName(code: ProvinceCode): string {
  return PROVINCES.find((province) => province.code === code)?.name ?? code;
}

/** One jurisdiction's CPP/QPP and EI figures from one T4127 edition. */
export type PayrollRates = {
  jurisdiction: PayrollJurisdiction;
  /** yyyy-MM-dd */
  effectiveFrom: string;
  pension: {
    /** Employee rate; the employer matches it. */
    rate: number;
    basicExemption: number;
    /** Year's Maximum Pensionable Earnings. */
    ympe: number;
    maxContribution: number;
  };
  pension2: {
    rate: number;
    /** Year's Additional Maximum Pensionable Earnings. */
    yampe: number;
    maxContribution: number;
  };
  ei: {
    employeeRate: number;
    employerRate: number;
    maxInsurableEarnings: number;
    maxEmployeePremium: number;
    maxEmployerPremium: number;
  };
};

/**
 * Seed figures from the CRA's T4127 122nd edition (effective January 1,
 * 2026), tables 8.3, 8.6 and 8.7. Newer editions are picked up by the
 * payroll-rates cron and stored in the database.
 */
export const SEED_PAYROLL_RATES: readonly PayrollRates[] = [
  {
    jurisdiction: "CA",
    effectiveFrom: "2026-01-01",
    pension: {
      rate: 0.0595,
      basicExemption: 3500,
      ympe: 74600,
      maxContribution: 4230.45,
    },
    pension2: { rate: 0.04, yampe: 85000, maxContribution: 416 },
    ei: {
      employeeRate: 0.0163,
      employerRate: 0.02282,
      maxInsurableEarnings: 68900,
      maxEmployeePremium: 1123.07,
      maxEmployerPremium: 1572.3,
    },
  },
  {
    jurisdiction: "QC",
    effectiveFrom: "2026-01-01",
    pension: {
      rate: 0.063,
      basicExemption: 3500,
      ympe: 74600,
      maxContribution: 4479.3,
    },
    pension2: { rate: 0.04, yampe: 85000, maxContribution: 416 },
    ei: {
      employeeRate: 0.013,
      employerRate: 0.0182,
      maxInsurableEarnings: 68900,
      maxEmployeePremium: 895.7,
      maxEmployerPremium: 1253.98,
    },
  },
];

const rateKey = (rates: Pick<PayrollRates, "jurisdiction" | "effectiveFrom">) =>
  `${rates.jurisdiction}|${rates.effectiveFrom}`;

/**
 * The seed rows plus stored rows, newest first. A stored row replaces the
 * seed row for the same jurisdiction and date.
 */
export function mergePayrollRates(
  stored: readonly PayrollRates[],
  seed: readonly PayrollRates[] = SEED_PAYROLL_RATES,
): PayrollRates[] {
  const byKey = new Map<string, PayrollRates>();
  for (const rates of [...seed, ...stored]) byKey.set(rateKey(rates), rates);
  return Array.from(byKey.values()).sort((a, b) =>
    b.effectiveFrom.localeCompare(a.effectiveFrom),
  );
}

/** The row in effect on `date` (yyyy-MM-dd) for a jurisdiction, if any. */
export function selectPayrollRates(
  rows: readonly PayrollRates[],
  jurisdiction: PayrollJurisdiction,
  date: string,
): PayrollRates | null {
  let best: PayrollRates | null = null;
  for (const rates of rows) {
    if (rates.jurisdiction !== jurisdiction || rates.effectiveFrom > date) {
      continue;
    }
    if (!best || rates.effectiveFrom > best.effectiveFrom) best = rates;
  }
  return best;
}

/** Whether two rows hold the same figures (dates and jurisdiction aside). */
export function sameFigures(a: PayrollRates, b: PayrollRates): boolean {
  return (
    JSON.stringify([a.pension, a.pension2, a.ei]) ===
    JSON.stringify([b.pension, b.pension2, b.ei])
  );
}

/** Running totals for one employee in one calendar year. */
export type PayrollYearToDate = {
  pensionableEarnings: number;
  pension: number;
  pension2: number;
  ei: number;
  employerEi: number;
};

export const EMPTY_YEAR_TO_DATE: PayrollYearToDate = {
  pensionableEarnings: 0,
  pension: 0,
  pension2: 0,
  ei: 0,
  employerEi: 0,
};

export type PayrollDeductions = {
  gross: number;
  /** CPP or QPP base contribution, employee share. */
  pension: number;
  /** CPP2 or QPP2 contribution, employee share. */
  pension2: number;
  ei: number;
  /** pension + pension2 + ei */
  total: number;
  /** gross − total (income tax not included). */
  net: number;
  /** Employer matches pension and pension2, and pays its own EI premium. */
  employerCost: number;
};

const cents = (amount: number) => Math.round(amount * 100) / 100;
const capped = (amount: number, remaining: number) =>
  cents(Math.max(0, Math.min(amount, remaining)));

/**
 * Deductions for one pay period, following the CRA's T4127 formulas: the
 * basic exemption is prorated over the pay periods in a year, and each
 * contribution stops once the year-to-date amount reaches its annual maximum.
 */
export function computePeriodDeductions(
  gross: number,
  rates: PayrollRates,
  periodsPerYear: number,
  ytd: PayrollYearToDate = EMPTY_YEAR_TO_DATE,
): { deductions: PayrollDeductions; ytd: PayrollYearToDate } {
  const pay = Math.max(0, gross);

  const pension = capped(
    rates.pension.rate *
      (pay - rates.pension.basicExemption / Math.max(1, periodsPerYear)),
    rates.pension.maxContribution - ytd.pension,
  );

  const before = ytd.pensionableEarnings;
  const after = before + pay;
  const secondBand = Math.max(
    0,
    Math.min(after, rates.pension2.yampe) -
      Math.max(before, rates.pension.ympe),
  );
  const pension2 = capped(
    secondBand * rates.pension2.rate,
    rates.pension2.maxContribution - ytd.pension2,
  );

  const ei = capped(
    pay * rates.ei.employeeRate,
    rates.ei.maxEmployeePremium - ytd.ei,
  );
  const employerEi = capped(
    pay * rates.ei.employerRate,
    rates.ei.maxEmployerPremium - ytd.employerEi,
  );

  const total = cents(pension + pension2 + ei);
  return {
    deductions: {
      gross: cents(pay),
      pension,
      pension2,
      ei,
      total,
      net: cents(pay - total),
      employerCost: cents(pension + pension2 + employerEi),
    },
    ytd: {
      pensionableEarnings: after,
      pension: ytd.pension + pension,
      pension2: ytd.pension2 + pension2,
      ei: ytd.ei + ei,
      employerEi: ytd.employerEi + employerEi,
    },
  };
}

export const ZERO_DEDUCTIONS: PayrollDeductions = {
  gross: 0,
  pension: 0,
  pension2: 0,
  ei: 0,
  total: 0,
  net: 0,
  employerCost: 0,
};

export function sumDeductions(
  items: Iterable<PayrollDeductions>,
): PayrollDeductions {
  const total = { ...ZERO_DEDUCTIONS };
  for (const item of items) {
    for (const key of Object.keys(total) as (keyof PayrollDeductions)[]) {
      total[key] = cents(total[key] + item[key]);
    }
  }
  return total;
}

/**
 * One employee's deductions over consecutive pay periods. Periods are taken
 * in date order; the year-to-date totals reset each calendar year, and each
 * period uses the rates in effect on its date. Periods with no rates in
 * effect are skipped and counted in `unratedPeriods`.
 */
export function computeDeductionsForPeriods(
  periods: readonly { date: string; gross: number }[],
  rows: readonly PayrollRates[],
  jurisdiction: PayrollJurisdiction,
  periodsPerYear: number,
): { total: PayrollDeductions; unratedPeriods: number } {
  const sorted = [...periods].sort((a, b) => a.date.localeCompare(b.date));
  const results: PayrollDeductions[] = [];
  let ytd = EMPTY_YEAR_TO_DATE;
  let year = "";
  let unratedPeriods = 0;
  for (const period of sorted) {
    const periodYear = period.date.slice(0, 4);
    if (periodYear !== year) {
      year = periodYear;
      ytd = EMPTY_YEAR_TO_DATE;
    }
    const rates = selectPayrollRates(rows, jurisdiction, period.date);
    if (!rates) {
      unratedPeriods += 1;
      continue;
    }
    const next = computePeriodDeductions(
      period.gross,
      rates,
      periodsPerYear,
      ytd,
    );
    ytd = next.ytd;
    results.push(next.deductions);
  }
  return { total: sumDeductions(results), unratedPeriods };
}

/** "5.95%" */
export const formatRate = (rate: number) =>
  `${Number((rate * 100).toFixed(3))}%`;

/* ------------------------------------------------------------ settings -- */

/** The org's payroll deduction settings as stored. */
export type PayrollSettingsData = {
  org_id: string;
  deductions_enabled: boolean;
  province: string;
  updated_at?: Date;
};

/** What the dashboard needs: the org's settings plus every known rate row. */
export type PayrollView = {
  enabled: boolean;
  province: ProvinceCode;
  rates: PayrollRates[];
};

/** Settings with defaults filled in, and an unknown province replaced. */
export function normalizePayrollSettings(
  row?: Partial<PayrollSettingsData> | null,
): { enabled: boolean; province: ProvinceCode } {
  return {
    enabled: row?.deductions_enabled === true,
    province: isProvinceCode(row?.province) ? row.province : DEFAULT_PROVINCE,
  };
}

/* ---------------------------------------------------------- validation -- */

const isFraction = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 && value < 1;
const isAmount = (value: unknown) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value > 0 &&
  value < 1_000_000;

/**
 * Sanity checks for a row fetched from the CRA before it is stored: every
 * rate is a fraction, every amount is positive, and the published maximums
 * agree with the rates and ceilings (within a dollar of rounding). A row that
 * fails is never used, so a change in the CRA's file layout can't put bad
 * numbers into anyone's pay.
 */
export function validatePayrollRates(rates: PayrollRates): string | null {
  if (rates.jurisdiction !== "CA" && rates.jurisdiction !== "QC") {
    return "Unknown jurisdiction";
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rates.effectiveFrom)) {
    return "Invalid effective date";
  }
  const { pension, pension2, ei } = rates;
  if (
    ![pension.rate, pension2.rate, ei.employeeRate, ei.employerRate].every(
      isFraction,
    )
  ) {
    return "Rate out of range";
  }
  if (
    ![
      pension.basicExemption,
      pension.ympe,
      pension.maxContribution,
      pension2.yampe,
      pension2.maxContribution,
      ei.maxInsurableEarnings,
      ei.maxEmployeePremium,
      ei.maxEmployerPremium,
    ].every(isAmount)
  ) {
    return "Amount out of range";
  }
  const near = (a: number, b: number) => Math.abs(a - b) <= 1;
  if (
    !near(
      pension.maxContribution,
      pension.rate * (pension.ympe - pension.basicExemption),
    )
  ) {
    return "CPP/QPP maximum does not match its rate";
  }
  if (
    pension2.yampe <= pension.ympe ||
    !near(
      pension2.maxContribution,
      pension2.rate * (pension2.yampe - pension.ympe),
    )
  ) {
    return "CPP2/QPP2 maximum does not match its rate";
  }
  if (
    !near(ei.maxEmployeePremium, ei.employeeRate * ei.maxInsurableEarnings) ||
    !near(ei.maxEmployerPremium, ei.employerRate * ei.maxInsurableEarnings)
  ) {
    return "EI maximum does not match its rate";
  }
  return null;
}
