import { describe, expect, it } from "vitest";
import {
  basicPersonalAmount,
  bracketTax,
  computeIncomeTax,
  hasEnteredClaims,
  INCOME_TAX_TABLES,
  type IncomeTaxInput,
  type IncomeTaxTables,
  isValidAdditionalTax,
  isValidClaimAmount,
  ontarioHealthPremium,
  selectIncomeTaxTables,
  toTaxClaims,
} from "@/lib/income-tax";

const [TABLES] = INCOME_TAX_TABLES;

/** An annual pay (one period a year) with no CPP or EI credits. */
const input = (overrides: Partial<IncomeTaxInput> = {}): IncomeTaxInput => ({
  gross: 50000,
  periodsPerYear: 1,
  province: "SK",
  pension: 0,
  pension2: 0,
  ei: 0,
  pensionRate: 0.0595,
  pensionMax: 4230.45,
  eiMax: 1123.07,
  ...overrides,
});

const claims = (
  federalClaim: number | null,
  provincialClaim: number | null,
  additionalTax = 0,
) => ({ userId: "u1", federalClaim, provincialClaim, additionalTax });

describe("tax tables", () => {
  it("start every jurisdiction's brackets at zero, in ascending order", () => {
    const all = [TABLES.federal, ...Object.values(TABLES.provinces)];
    for (const table of all) {
      expect(table.brackets[0].from).toBe(0);
      for (let i = 1; i < table.brackets.length; i++) {
        expect(table.brackets[i].from).toBeGreaterThan(
          table.brackets[i - 1].from,
        );
        expect(table.brackets[i].rate).toBeGreaterThan(
          table.brackets[i - 1].rate,
        );
      }
    }
  });

  it("picks the tables in effect on a date", () => {
    expect(selectIncomeTaxTables("2026-03-01")).toBe(TABLES);
    expect(selectIncomeTaxTables("2025-12-31")).toBeNull();
    const later: IncomeTaxTables = { ...TABLES, effectiveFrom: "2027-01-01" };
    expect(selectIncomeTaxTables("2027-02-01", [later, TABLES])).toBe(later);
    expect(selectIncomeTaxTables("2026-02-01", [later, TABLES])).toBe(TABLES);
    expect(selectIncomeTaxTables("2027-02-01", [TABLES, later])).toBe(later);
  });
});

describe("bracketTax", () => {
  it("charges each slice of income at its bracket's rate", () => {
    // 58,523 × 14% + 41,477 × 20.5%
    expect(bracketTax(TABLES.federal.brackets, 100000)).toBeCloseTo(
      16696.005,
      3,
    );
    expect(bracketTax(TABLES.federal.brackets, 0)).toBe(0);
    // Top bracket has no ceiling.
    expect(bracketTax([{ from: 0, rate: 0.1 }], 1000)).toBeCloseTo(100);
  });
});

describe("basicPersonalAmount", () => {
  const phased = TABLES.federal.basicPersonalAmount;
  it("returns a fixed amount as is", () => {
    expect(basicPersonalAmount(20381, 1_000_000)).toBe(20381);
  });

  it("steps the federal amount down between the two incomes", () => {
    expect(basicPersonalAmount(phased, 100000)).toBe(16452);
    expect(basicPersonalAmount(phased, 300000)).toBe(14829);
    expect(basicPersonalAmount(phased, (181440 + 258482) / 2)).toBeCloseTo(
      15640.5,
    );
  });
});

describe("ontarioHealthPremium", () => {
  it.each([
    [15000, 0],
    [22000, 120],
    [30000, 300],
    [37000, 360],
    [40000, 450],
    [48300, 525],
    [60000, 600],
    [72300, 675],
    [100000, 750],
    [200300, 825],
    [300000, 900],
  ])("on %d is %d", (income, premium) => {
    expect(ontarioHealthPremium(income)).toBeCloseTo(premium);
  });
});

describe("computeIncomeTax", () => {
  it("uses the basic personal amounts when no TD1 amounts are entered", () => {
    // Federal: 14% × 50,000 − 14% × (16,452 + 1,501 CEA)
    const tax = computeIncomeTax(input(), TABLES);
    expect(tax.federal).toBe(4486.58);
    // Saskatchewan: 10.5% × (50,000 − 20,381)
    expect(tax.provincial).toBeCloseTo(3110, 1);
  });

  it("uses the TD1 claim amounts and adds the extra tax", () => {
    const tax = computeIncomeTax(
      input({ claims: claims(16000, 20000, 10) }),
      TABLES,
    );
    // 7,000 − 14% × 16,000 − 14% × 1,501 + 10
    expect(tax.federal).toBe(4559.86);
    // 5,250 − 10.5% × 20,000
    expect(tax.provincial).toBe(3150);
  });

  it("falls back per form when only one claim amount is entered", () => {
    const tax = computeIncomeTax(
      input({ claims: claims(null, 20000) }),
      TABLES,
    );
    expect(tax.federal).toBe(4486.58);
    expect(tax.provincial).toBe(3150);
  });

  it("annualizes each period's pay and spreads the tax back", () => {
    const annual = computeIncomeTax(input({ gross: 52000 }), TABLES);
    const weekly = computeIncomeTax(
      input({ gross: 1000, periodsPerYear: 52 }),
      TABLES,
    );
    expect(Math.abs(weekly.federal - annual.federal / 52)).toBeLessThan(0.01);
  });

  it("credits base CPP and EI and deducts enhanced CPP from income", () => {
    const plain = computeIncomeTax(input(), TABLES);
    const withCredits = computeIncomeTax(
      input({ pension: 2766, pension2: 0, ei: 815 }),
      TABLES,
    );
    // The 1% enhancement (2,766 × 1/5.95 = 464.87) comes off income at 14%,
    // the base (2,301.13) and EI (815) are credited at 14%.
    const expected = 4486.58 - 0.14 * 464.87 - 0.14 * (2301.13 + 815);
    expect(withCredits.federal).toBeCloseTo(expected, 1);
    expect(withCredits.provincial).toBeLessThan(plain.provincial);
  });

  it("caps the CPP and EI credits at their annual maximums", () => {
    const capped = computeIncomeTax(
      input({ gross: 200000, pension: 9000, ei: 5000 }),
      TABLES,
    );
    const atMax = computeIncomeTax(
      input({ gross: 200000, pension: 9000, ei: 1123.07 }),
      TABLES,
    );
    expect(capped.federal).toBe(atMax.federal);
  });

  it("never withholds below zero, and treats zero periods as one", () => {
    expect(computeIncomeTax(input({ gross: 8000 }), TABLES)).toEqual({
      federal: 0,
      provincial: 0,
    });
    expect(computeIncomeTax(input({ gross: -100 }), TABLES)).toEqual({
      federal: 0,
      provincial: 0,
    });
    expect(computeIncomeTax(input({ periodsPerYear: 0 }), TABLES)).toEqual(
      computeIncomeTax(input(), TABLES),
    );
  });

  it("applies the Quebec abatement and leaves Quebec tax out", () => {
    const tax = computeIncomeTax(input({ province: "QC" }), TABLES);
    expect(tax.federal).toBe(Math.round(4486.58 * 0.835 * 100) / 100);
    expect(tax.provincial).toBe(0);
  });

  it("adds the Ontario surtax and health premium", () => {
    const tax = computeIncomeTax(
      input({ gross: 150000, province: "ON", claims: claims(null, 0) }),
      TABLES,
    );
    // Basic tax 12,363.99; surtax 20% over 5,818 + 36% over 7,446 = 3,079.67;
    // health premium 750.
    expect(tax.provincial).toBe(16193.67);
  });

  it("skips the surtax for Ontario basic tax under the thresholds", () => {
    const tax = computeIncomeTax(
      input({ gross: 30000, province: "ON" }),
      TABLES,
    );
    // 5.05% × (30,000 − 12,989) + 300 health premium
    expect(tax.provincial).toBeCloseTo(0.0505 * (30000 - 12989) + 300, 1);
  });
});

describe("claims", () => {
  it("validates claim amounts", () => {
    expect(isValidClaimAmount(null)).toBe(true);
    expect(isValidClaimAmount(0)).toBe(true);
    expect(isValidClaimAmount(16452)).toBe(true);
    expect(isValidClaimAmount(-1)).toBe(false);
    expect(isValidClaimAmount(2_000_000)).toBe(false);
    expect(isValidClaimAmount(Number.NaN)).toBe(false);
    expect(isValidClaimAmount("100")).toBe(false);
  });

  it("validates the additional tax", () => {
    expect(isValidAdditionalTax(0)).toBe(true);
    expect(isValidAdditionalTax(25.5)).toBe(true);
    expect(isValidAdditionalTax(null)).toBe(false);
    expect(isValidAdditionalTax(-5)).toBe(false);
    expect(isValidAdditionalTax(20000)).toBe(false);
    expect(isValidAdditionalTax(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it("knows whether anything was entered", () => {
    expect(hasEnteredClaims(null)).toBe(false);
    expect(hasEnteredClaims(undefined)).toBe(false);
    expect(hasEnteredClaims(claims(null, null))).toBe(false);
    expect(hasEnteredClaims(claims(0, null))).toBe(true);
    expect(hasEnteredClaims(claims(null, 0))).toBe(true);
    expect(hasEnteredClaims(claims(null, null, 5))).toBe(true);
  });

  it("reads stored rows", () => {
    expect(toTaxClaims(null)).toBeNull();
    expect(toTaxClaims({ federal_claim: 1 })).toBeNull();
    expect(
      toTaxClaims({
        user_id: "u1",
        federal_claim: "16452",
        provincial_claim: null,
        additional_tax: "12.5",
      }),
    ).toEqual(claims(16452, null, 12.5));
    expect(toTaxClaims({ user_id: "u1" })).toEqual(claims(null, null, 0));
    expect(toTaxClaims({ user_id: "u1", federal_claim: -1 })).toBeNull();
    expect(toTaxClaims({ user_id: "u1", provincial_claim: "x" })).toBeNull();
    expect(toTaxClaims({ user_id: "u1", additional_tax: -1 })).toBeNull();
  });
});
