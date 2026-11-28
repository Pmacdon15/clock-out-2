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
 * The figures are estimates for planning, not a payroll engine. Income tax
 * is estimated in ./income-tax from each employee's TD1 claim amounts (or
 * the basic personal amounts when none are entered). Admins can add their
 * own deductions (RRSP, union dues, benefits) as a fixed amount or a
 * percentage of gross pay; QPIP is not calculated.
 */

import {
  computeIncomeTax,
  type IncomeTaxTables,
  selectIncomeTaxTables,
  type TaxClaims,
} from "./income-tax";

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
  /** Federal income tax withheld (plus any TD1 additional tax). */
  federalTax: number;
  /** Provincial or territorial income tax withheld (0 for Quebec). */
  provincialTax: number;
  /** Custom deductions (RRSP, union dues, ...) added up. */
  other: number;
  /** pension + pension2 + ei + federalTax + provincialTax + other */
  total: number;
  /** gross − total */
  net: number;
  /** Employer matches pension and pension2, and pays its own EI premium. */
  employerCost: number;
};

const cents = (amount: number) => Math.round(amount * 100) / 100;
const capped = (amount: number, remaining: number) =>
  cents(Math.max(0, Math.min(amount, remaining)));

/** Who the income tax is for; without it no income tax is estimated. */
export type IncomeTaxContext = {
  province: ProvinceCode;
  claims?: TaxClaims | null;
};

/**
 * Deductions for one pay period, following the CRA's T4127 formulas: the
 * basic exemption is prorated over the pay periods in a year, and each
 * contribution stops once the year-to-date amount reaches its annual maximum.
 * Income tax is added when `tax` names the tables and province to use.
 *
 * Custom deductions come after CPP/QPP and EI: the before-tax ones first
 * (they lower taxable income), then the after-tax ones. None of them takes
 * pay below zero; one that doesn't fit is cut to what is left.
 */
export function computePeriodDeductions(
  gross: number,
  rates: PayrollRates,
  periodsPerYear: number,
  ytd: PayrollYearToDate = EMPTY_YEAR_TO_DATE,
  tax?: IncomeTaxContext & { tables: IncomeTaxTables },
  custom: readonly CustomDeduction[] = [],
): {
  deductions: PayrollDeductions;
  ytd: PayrollYearToDate;
  /** What each custom deduction took this period, by id. */
  custom: Record<string, number>;
} {
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

  let room = pay - pension - pension2 - ei;
  const taken: Record<string, number> = {};
  const take = (deduction: CustomDeduction) => {
    const amount = capped(customDeductionAmount(deduction, pay), room);
    room -= amount;
    taken[deduction.id] = cents((taken[deduction.id] ?? 0) + amount);
    return amount;
  };
  let preTax = 0;
  for (const deduction of custom) {
    if (deduction.preTax) preTax += take(deduction);
  }

  const incomeTax = tax
    ? computeIncomeTax(
        {
          gross: pay,
          periodsPerYear,
          province: tax.province,
          pension,
          pension2,
          ei,
          pensionRate: rates.pension.rate,
          pensionMax: rates.pension.maxContribution,
          eiMax: rates.ei.maxEmployeePremium,
          claims: tax.claims,
          preTaxDeductions: preTax,
        },
        tax.tables,
      )
    : { federal: 0, provincial: 0 };

  room -= incomeTax.federal + incomeTax.provincial;
  let postTax = 0;
  for (const deduction of custom) {
    if (!deduction.preTax) postTax += take(deduction);
  }
  const other = cents(preTax + postTax);

  const total = cents(
    pension + pension2 + ei + incomeTax.federal + incomeTax.provincial + other,
  );
  return {
    deductions: {
      gross: cents(pay),
      pension,
      pension2,
      ei,
      federalTax: incomeTax.federal,
      provincialTax: incomeTax.provincial,
      other,
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
    custom: taken,
  };
}

export const ZERO_DEDUCTIONS: PayrollDeductions = {
  gross: 0,
  pension: 0,
  pension2: 0,
  ei: 0,
  federalTax: 0,
  provincialTax: 0,
  other: 0,
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
 * effect are skipped and counted in `unratedPeriods`. With `tax`, income tax
 * is estimated too, from the tax tables in effect on each period's date;
 * periods before the first tables get none and are counted in
 * `untaxedPeriods`. `custom` deductions are taken from every period, and
 * `customById` adds up what each one took.
 */
export function computeDeductionsForPeriods(
  periods: readonly { date: string; gross: number }[],
  rows: readonly PayrollRates[],
  jurisdiction: PayrollJurisdiction,
  periodsPerYear: number,
  tax?: IncomeTaxContext,
  taxTables?: readonly IncomeTaxTables[],
  custom: readonly CustomDeduction[] = [],
): {
  total: PayrollDeductions;
  unratedPeriods: number;
  untaxedPeriods: number;
  customById: Record<string, number>;
} {
  const sorted = [...periods].sort((a, b) => a.date.localeCompare(b.date));
  const results: PayrollDeductions[] = [];
  let ytd = EMPTY_YEAR_TO_DATE;
  let year = "";
  let unratedPeriods = 0;
  let untaxedPeriods = 0;
  const customById: Record<string, number> = {};
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
    const tables = tax ? selectIncomeTaxTables(period.date, taxTables) : null;
    if (tax && !tables) untaxedPeriods += 1;
    const next = computePeriodDeductions(
      period.gross,
      rates,
      periodsPerYear,
      ytd,
      tax && tables ? { ...tax, tables } : undefined,
      custom,
    );
    ytd = next.ytd;
    results.push(next.deductions);
    for (const [id, amount] of Object.entries(next.custom)) {
      customById[id] = cents((customById[id] ?? 0) + amount);
    }
  }
  return {
    total: sumDeductions(results),
    unratedPeriods,
    untaxedPeriods,
    customById,
  };
}

/* --------------------------------------------------- custom deductions -- */

export type CustomDeductionKind = "fixed" | "percent";

/** A deduction an admin added: RRSP, union dues, benefits, ... */
export type CustomDeduction = {
  id: string;
  /** Whose pay it comes off; null = every member. */
  userId: string | null;
  name: string;
  /** "fixed": dollars per pay week; "percent": % of gross pay. */
  kind: CustomDeductionKind;
  amount: number;
  /** Taken before income tax, so it lowers taxable income (e.g. RRSP). */
  preTax: boolean;
};

export const MAX_CUSTOM_DEDUCTIONS = 50;
export const MAX_DEDUCTION_NAME_LENGTH = 40;
export const MAX_FIXED_DEDUCTION = 10_000;
export const MAX_PERCENT_DEDUCTION = 100;

export function isCustomDeductionKind(
  value: unknown,
): value is CustomDeductionKind {
  return value === "fixed" || value === "percent";
}

/** Why a custom deduction can't be saved, or null when it can. */
export function validateCustomDeduction(input: {
  name: unknown;
  kind: unknown;
  amount: unknown;
  preTax: unknown;
}): string | null {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length > MAX_DEDUCTION_NAME_LENGTH) {
    return `Give the deduction a name of up to ${MAX_DEDUCTION_NAME_LENGTH} characters`;
  }
  if (!isCustomDeductionKind(input.kind)) return "Pick a fixed amount or a %";
  const max =
    input.kind === "percent" ? MAX_PERCENT_DEDUCTION : MAX_FIXED_DEDUCTION;
  if (
    typeof input.amount !== "number" ||
    !Number.isFinite(input.amount) ||
    input.amount <= 0 ||
    input.amount > max
  ) {
    return input.kind === "percent"
      ? `Enter a percentage above 0 and up to ${MAX_PERCENT_DEDUCTION}`
      : `Enter an amount above $0 and up to $${MAX_FIXED_DEDUCTION.toLocaleString("en-US")}`;
  }
  if (typeof input.preTax !== "boolean") return "Invalid before-tax setting";
  return null;
}

/** What a deduction asks for from one period's gross pay (before capping). */
export function customDeductionAmount(
  deduction: Pick<CustomDeduction, "kind" | "amount">,
  gross: number,
): number {
  return deduction.kind === "percent"
    ? (Math.max(0, gross) * deduction.amount) / 100
    : deduction.amount;
}

/** The deductions that come off one member's pay. */
export function customDeductionsFor(
  deductions: readonly CustomDeduction[],
  userId: string,
): CustomDeduction[] {
  return deductions.filter(
    (deduction) => deduction.userId === null || deduction.userId === userId,
  );
}

/** A stored row as a deduction, or null when it's unusable. */
export function toCustomDeduction(
  row?: {
    id?: number | string | null;
    user_id?: string | null;
    name?: string | null;
    kind?: string | null;
    amount?: number | string | null;
    pre_tax?: boolean | null;
  } | null,
): CustomDeduction | null {
  if (!row || row.id === undefined || row.id === null) return null;
  const input = {
    name: row.name,
    kind: row.kind,
    amount: Number(row.amount),
    preTax: row.pre_tax === true,
  };
  if (validateCustomDeduction(input) !== null) return null;
  return {
    id: String(row.id),
    userId: row.user_id ?? null,
    name: String(row.name).trim(),
    kind: row.kind as CustomDeductionKind,
    amount: input.amount,
    preTax: input.preTax,
  };
}

/** "$50.00 per week" or "5% of gross", plus ", before tax" when it is. */
export function describeCustomDeduction(
  deduction: Pick<CustomDeduction, "kind" | "amount" | "preTax">,
): string {
  const amount =
    deduction.kind === "percent"
      ? `${Number(deduction.amount.toFixed(3))}% of gross`
      : `$${deduction.amount.toFixed(2)} per week`;
  return deduction.preTax ? `${amount}, before tax` : amount;
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
  /** TD1 claims the caller may see: everyone's for admins, else their own. */
  claims: TaxClaims[];
  /**
   * Custom deductions the caller may see: every one for admins, else the
   * ones that come off their own pay.
   */
  customDeductions: CustomDeduction[];
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
