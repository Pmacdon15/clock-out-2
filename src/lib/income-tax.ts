import type { ProvinceCode } from "./payroll";

/**
 * Income tax withholding estimates, following the CRA's T4127 "Option 1"
 * annual formula: the period's pay is annualized, federal and provincial tax
 * are worked out on the annual amount, less non-refundable credits, and the
 * result is spread back over the pay periods.
 *
 * Withholding depends on what each employee claims on their TD1 forms. When an
 * employee's TD1 total claim amounts are entered they're used as is; when
 * they aren't, the basic personal amount is used (claim code 1), which is
 * what an employer must use when no TD1 is filed. Either way the result is an
 * estimate: other deductions (RRSP, union dues, etc.), the Ontario and BC tax
 * reductions, other provinces' surtaxes and income-tested amounts, QPIP and
 * Quebec provincial tax (Revenu Québec's TP-1015.F) are not calculated.
 */

/** Tax on income above `from` is charged at `rate` (until the next bracket). */
export type TaxBracket = { from: number; rate: number };

/** A basic personal amount that steps down between two income levels. */
export type PhasedAmount = {
  max: number;
  min: number;
  /** Annual taxable income where the amount starts to drop from `max`. */
  phaseStart: number;
  /** Annual taxable income where it reaches `min`. */
  phaseEnd: number;
};

export type ProvincialTaxTable = {
  /** Ascending; the first bracket starts at 0. */
  brackets: TaxBracket[];
  basicPersonalAmount: number | PhasedAmount;
};

export type TaxedProvince = Exclude<ProvinceCode, "QC">;

/** One year's federal and provincial figures from one T4127 edition. */
export type IncomeTaxTables = {
  /** yyyy-MM-dd */
  effectiveFrom: string;
  federal: {
    brackets: TaxBracket[];
    basicPersonalAmount: PhasedAmount;
    canadaEmploymentAmount: number;
    /** Federal tax reduction for Quebec employees (Quebec abatement). */
    quebecAbatement: number;
  };
  provinces: Record<TaxedProvince, ProvincialTaxTable>;
  ontario: {
    /** Surtax on Ontario basic tax above each threshold. */
    surtax: { threshold: number; rate: number }[];
  };
};

/**
 * 2026 figures (T4127 122nd edition, effective January 1, 2026). Thresholds
 * are each jurisdiction's 2025 amounts indexed for 2026.
 */
export const INCOME_TAX_TABLES: readonly IncomeTaxTables[] = [
  {
    effectiveFrom: "2026-01-01",
    federal: {
      brackets: [
        { from: 0, rate: 0.14 },
        { from: 58523, rate: 0.205 },
        { from: 117045, rate: 0.26 },
        { from: 181440, rate: 0.29 },
        { from: 258482, rate: 0.33 },
      ],
      basicPersonalAmount: {
        max: 16452,
        min: 14829,
        phaseStart: 181440,
        phaseEnd: 258482,
      },
      canadaEmploymentAmount: 1501,
      quebecAbatement: 0.165,
    },
    provinces: {
      AB: {
        brackets: [
          { from: 0, rate: 0.08 },
          { from: 61200, rate: 0.1 },
          { from: 154259, rate: 0.12 },
          { from: 185111, rate: 0.13 },
          { from: 246813, rate: 0.14 },
          { from: 370220, rate: 0.15 },
        ],
        basicPersonalAmount: 22769,
      },
      BC: {
        brackets: [
          { from: 0, rate: 0.0506 },
          { from: 50363, rate: 0.077 },
          { from: 100728, rate: 0.105 },
          { from: 115648, rate: 0.1229 },
          { from: 140430, rate: 0.147 },
          { from: 190405, rate: 0.168 },
          { from: 265545, rate: 0.205 },
        ],
        basicPersonalAmount: 13216,
      },
      MB: {
        brackets: [
          { from: 0, rate: 0.108 },
          { from: 47000, rate: 0.1275 },
          { from: 100000, rate: 0.174 },
        ],
        basicPersonalAmount: 15780,
      },
      NB: {
        brackets: [
          { from: 0, rate: 0.094 },
          { from: 52333, rate: 0.14 },
          { from: 104666, rate: 0.16 },
          { from: 193861, rate: 0.195 },
        ],
        basicPersonalAmount: 13664,
      },
      NL: {
        brackets: [
          { from: 0, rate: 0.087 },
          { from: 45076, rate: 0.145 },
          { from: 90150, rate: 0.158 },
          { from: 160948, rate: 0.178 },
          { from: 225328, rate: 0.198 },
          { from: 287858, rate: 0.208 },
          { from: 575718, rate: 0.213 },
          { from: 1151435, rate: 0.218 },
        ],
        basicPersonalAmount: 11288,
      },
      NS: {
        brackets: [
          { from: 0, rate: 0.0879 },
          { from: 31117, rate: 0.1495 },
          { from: 62235, rate: 0.1667 },
          { from: 97801, rate: 0.175 },
          { from: 157743, rate: 0.21 },
        ],
        basicPersonalAmount: 11979,
      },
      NT: {
        brackets: [
          { from: 0, rate: 0.059 },
          { from: 53003, rate: 0.086 },
          { from: 106009, rate: 0.122 },
          { from: 172346, rate: 0.1405 },
        ],
        basicPersonalAmount: 18199,
      },
      NU: {
        brackets: [
          { from: 0, rate: 0.04 },
          { from: 55801, rate: 0.07 },
          { from: 111601, rate: 0.09 },
          { from: 181439, rate: 0.115 },
        ],
        basicPersonalAmount: 19659,
      },
      ON: {
        brackets: [
          { from: 0, rate: 0.0505 },
          { from: 53891, rate: 0.0915 },
          { from: 107785, rate: 0.1116 },
          { from: 150000, rate: 0.1216 },
          { from: 220000, rate: 0.1316 },
        ],
        basicPersonalAmount: 12989,
      },
      PE: {
        brackets: [
          { from: 0, rate: 0.095 },
          { from: 33995, rate: 0.1347 },
          { from: 65949, rate: 0.166 },
          { from: 105000, rate: 0.1762 },
          { from: 140000, rate: 0.19 },
        ],
        basicPersonalAmount: 14943,
      },
      SK: {
        brackets: [
          { from: 0, rate: 0.105 },
          { from: 54532, rate: 0.125 },
          { from: 155805, rate: 0.145 },
        ],
        basicPersonalAmount: 20381,
      },
      YT: {
        brackets: [
          { from: 0, rate: 0.064 },
          { from: 58523, rate: 0.09 },
          { from: 117045, rate: 0.109 },
          { from: 181440, rate: 0.128 },
          { from: 500000, rate: 0.15 },
        ],
        // Yukon's amount follows the federal one, phase-out included.
        basicPersonalAmount: {
          max: 16452,
          min: 14829,
          phaseStart: 181440,
          phaseEnd: 258482,
        },
      },
    },
    ontario: {
      surtax: [
        { threshold: 5818, rate: 0.2 },
        { threshold: 7446, rate: 0.36 },
      ],
    },
  },
];

/** The tables in effect on `date` (yyyy-MM-dd), if any. */
export function selectIncomeTaxTables(
  date: string,
  tables: readonly IncomeTaxTables[] = INCOME_TAX_TABLES,
): IncomeTaxTables | null {
  let best: IncomeTaxTables | null = null;
  for (const table of tables) {
    if (table.effectiveFrom > date) continue;
    if (!best || table.effectiveFrom > best.effectiveFrom) best = table;
  }
  return best;
}

/** Tax on an annual amount over progressive brackets (before credits). */
export function bracketTax(brackets: readonly TaxBracket[], income: number) {
  let tax = 0;
  for (let i = 0; i < brackets.length; i++) {
    const { from, rate } = brackets[i];
    if (income <= from) break;
    const to = brackets[i + 1]?.from ?? Number.POSITIVE_INFINITY;
    tax += (Math.min(income, to) - from) * rate;
  }
  return tax;
}

/** A basic personal amount for an annual taxable income. */
export function basicPersonalAmount(
  amount: number | PhasedAmount,
  income: number,
): number {
  if (typeof amount === "number") return amount;
  if (income <= amount.phaseStart) return amount.max;
  if (income >= amount.phaseEnd) return amount.min;
  const share =
    (income - amount.phaseStart) / (amount.phaseEnd - amount.phaseStart);
  return amount.max - (amount.max - amount.min) * share;
}

/**
 * Ontario Health Premium on annual taxable income: it rises by a share of
 * income over each step, up to that step's cap. These amounts aren't indexed.
 */
const HEALTH_PREMIUM_STEPS = [
  { from: 20000, rate: 0.06, cap: 300 },
  { from: 36000, rate: 0.06, cap: 450 },
  { from: 48000, rate: 0.25, cap: 600 },
  { from: 72000, rate: 0.25, cap: 750 },
  { from: 200000, rate: 0.25, cap: 900 },
];

export function ontarioHealthPremium(income: number): number {
  let premium = 0;
  for (const step of HEALTH_PREMIUM_STEPS) {
    if (income <= step.from) break;
    premium = Math.min(step.cap, premium + (income - step.from) * step.rate);
  }
  return premium;
}

/* ------------------------------------------------------------- claims -- */

/** Largest TD1 total claim amount accepted. */
export const MAX_CLAIM_AMOUNT = 1_000_000;
/** Largest extra amount per pay an employee can ask to have deducted. */
export const MAX_ADDITIONAL_TAX = 10_000;

/** What an employee entered on their federal and provincial TD1 forms. */
export type TaxClaims = {
  userId: string;
  /** TD1 total claim amount; null = not entered (basic personal amount). */
  federalClaim: number | null;
  /** Provincial TD1 total claim amount; null = not entered. */
  provincialClaim: number | null;
  /** Extra tax deducted from each pay (TD1 "additional tax"). */
  additionalTax: number;
};

/** Whether a TD1 claim amount is acceptable (null = not entered). */
export function isValidClaimAmount(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= MAX_CLAIM_AMOUNT)
  );
}

/** Whether an additional tax amount is acceptable. */
export function isValidAdditionalTax(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_ADDITIONAL_TAX
  );
}

/** Whether any TD1 figure was entered (otherwise the defaults apply). */
export function hasEnteredClaims(claims?: TaxClaims | null): boolean {
  return Boolean(
    claims &&
      (claims.federalClaim !== null ||
        claims.provincialClaim !== null ||
        claims.additionalTax > 0),
  );
}

/** A stored row as claims, or null when it's missing or unusable. */
export function toTaxClaims(
  row?: {
    user_id?: string;
    federal_claim?: number | string | null;
    provincial_claim?: number | string | null;
    additional_tax?: number | string | null;
  } | null,
): TaxClaims | null {
  if (!row?.user_id) return null;
  const amount = (value: number | string | null | undefined) =>
    value === null || value === undefined ? null : Number(value);
  const federalClaim = amount(row.federal_claim);
  const provincialClaim = amount(row.provincial_claim);
  const additionalTax = amount(row.additional_tax) ?? 0;
  if (
    !isValidClaimAmount(federalClaim) ||
    !isValidClaimAmount(provincialClaim) ||
    !isValidAdditionalTax(additionalTax)
  ) {
    return null;
  }
  return { userId: row.user_id, federalClaim, provincialClaim, additionalTax };
}

/* ---------------------------------------------------------- withholding -- */

export type IncomeTaxInput = {
  /** Gross pay for the period. */
  gross: number;
  periodsPerYear: number;
  province: ProvinceCode;
  /** This period's CPP/QPP base + first additional contribution. */
  pension: number;
  /** This period's CPP2/QPP2 contribution. */
  pension2: number;
  ei: number;
  /** CPP/QPP total rate and annual maximum, to split off the enhancement. */
  pensionRate: number;
  pensionMax: number;
  eiMax: number;
  claims?: TaxClaims | null;
};

export type IncomeTax = { federal: number; provincial: number };

/** First additional CPP/QPP rate: deducted from income, not a tax credit. */
const ENHANCED_PENSION_RATE = 0.01;

const cents = (amount: number) => Math.round(amount * 100) / 100;

/**
 * Federal and provincial tax to withhold from one period's pay. Quebec gets
 * federal tax only (less the Quebec abatement); its provincial tax is
 * withheld under Revenu Québec's rules and isn't estimated.
 */
export function computeIncomeTax(
  input: IncomeTaxInput,
  tables: IncomeTaxTables,
): IncomeTax {
  const periods = Math.max(1, input.periodsPerYear);
  const enhancedShare = ENHANCED_PENSION_RATE / input.pensionRate;
  // F5A: the enhanced contributions are a deduction from income.
  const enhanced = input.pension * enhancedShare + input.pension2;
  const income = Math.max(0, periods * (Math.max(0, input.gross) - enhanced));

  // Credits on base CPP/QPP and EI, at each jurisdiction's lowest rate.
  const creditBase =
    Math.min(
      periods * input.pension * (1 - enhancedShare),
      input.pensionMax * (1 - enhancedShare),
    ) + Math.min(periods * input.ei, input.eiMax);

  const { federal } = tables;
  const lowestFederal = federal.brackets[0].rate;
  const federalClaim =
    input.claims?.federalClaim ??
    basicPersonalAmount(federal.basicPersonalAmount, income);
  let federalTax = Math.max(
    0,
    bracketTax(federal.brackets, income) -
      lowestFederal * federalClaim -
      lowestFederal * creditBase -
      lowestFederal * Math.min(income, federal.canadaEmploymentAmount),
  );
  if (input.province === "QC") {
    federalTax -= federalTax * federal.quebecAbatement;
  }

  let provincialTax = 0;
  if (input.province !== "QC") {
    const table = tables.provinces[input.province];
    const lowest = table.brackets[0].rate;
    const claim =
      input.claims?.provincialClaim ??
      basicPersonalAmount(table.basicPersonalAmount, income);
    provincialTax = Math.max(
      0,
      bracketTax(table.brackets, income) - lowest * claim - lowest * creditBase,
    );
    if (input.province === "ON") {
      let surtax = 0;
      for (const step of tables.ontario.surtax) {
        surtax += Math.max(0, provincialTax - step.threshold) * step.rate;
      }
      provincialTax += surtax + ontarioHealthPremium(income);
    }
  }

  return {
    federal: cents(federalTax / periods + (input.claims?.additionalTax ?? 0)),
    provincial: cents(provincialTax / periods),
  };
}
