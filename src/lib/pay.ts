import type { OvertimeSplit } from "./overtime";
import type { PayRateData } from "./types";

/**
 * Pay rates and estimated gross pay.
 *
 * Each member can have an hourly rate and an overtime multiplier (1.5 for
 * "time and a half"). Gross pay is regular hours at the rate plus overtime
 * hours at rate × multiplier, using the same regular/overtime split shown
 * everywhere else. It is an estimate: no deductions, premiums or rounding
 * rules are applied.
 */

/** Largest hourly rate accepted. */
export const MAX_HOURLY_RATE = 10_000;
/** Overtime multipliers accepted, inclusive. */
export const MIN_OVERTIME_MULTIPLIER = 1;
export const MAX_OVERTIME_MULTIPLIER = 5;
/** Used when a member has a rate but no multiplier was given. */
export const DEFAULT_OVERTIME_MULTIPLIER = 1.5;

export type PayRate = {
  hourlyRate: number;
  overtimeMultiplier: number;
};

export type PayBreakdown = {
  regularPay: number;
  overtimePay: number;
  grossPay: number;
};

const ZERO_PAY: PayBreakdown = { regularPay: 0, overtimePay: 0, grossPay: 0 };

/** Whether an hourly rate is acceptable to store. */
export function isValidHourlyRate(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_HOURLY_RATE
  );
}

/** Whether an overtime multiplier is acceptable to store. */
export function isValidOvertimeMultiplier(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= MIN_OVERTIME_MULTIPLIER &&
    value <= MAX_OVERTIME_MULTIPLIER
  );
}

/** A stored row as a usable rate, or null when it's missing or invalid. */
export function toPayRate(row?: Partial<PayRateData> | null): PayRate | null {
  if (!row) return null;
  const hourlyRate = Number(row.hourly_rate);
  if (!isValidHourlyRate(hourlyRate)) return null;
  const multiplier = Number(
    row.overtime_multiplier ?? DEFAULT_OVERTIME_MULTIPLIER,
  );
  return {
    hourlyRate,
    overtimeMultiplier: isValidOvertimeMultiplier(multiplier)
      ? multiplier
      : DEFAULT_OVERTIME_MULTIPLIER,
  };
}

/** Rates keyed by user id; rows that aren't usable are left out. */
export function payRateMap(
  rows?: Partial<PayRateData>[] | null,
): Map<string, PayRate> {
  const map = new Map<string, PayRate>();
  for (const row of rows ?? []) {
    const rate = toPayRate(row);
    if (row.user_id && rate) map.set(row.user_id, rate);
  }
  return map;
}

/** Gross pay for some regular and overtime hours at one rate. */
export function computePay(
  hours: Pick<OvertimeSplit, "regularHours" | "overtimeHours">,
  rate: PayRate,
): PayBreakdown {
  const regularPay = Math.max(0, hours.regularHours) * rate.hourlyRate;
  const overtimePay =
    Math.max(0, hours.overtimeHours) *
    rate.hourlyRate *
    rate.overtimeMultiplier;
  return { regularPay, overtimePay, grossPay: regularPay + overtimePay };
}

/** Adds pay figures together. */
export function sumPay(items: Iterable<PayBreakdown>): PayBreakdown {
  const total = { ...ZERO_PAY };
  for (const item of items) {
    total.regularPay += item.regularPay;
    total.overtimePay += item.overtimePay;
    total.grossPay += item.grossPay;
  }
  return total;
}

const currency = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "$1,234.56" — currency-neutral, since orgs pay in their own currency. */
export const formatMoney = (amount: number) => `$${currency.format(amount)}`;

/** "1.5x" — a multiplier as admins typed it. */
export const formatMultiplier = (multiplier: number) =>
  `${Number(multiplier.toFixed(2))}x`;
