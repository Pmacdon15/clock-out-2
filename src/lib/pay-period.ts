import {
  addDays,
  differenceInCalendarDays,
  endOfDay,
  format,
  isValid,
  parse,
  startOfDay,
} from "date-fns";
import { toLocalISO } from "./date-utils";
import type { PayPeriodSettingsData } from "./types";

/**
 * Pay periods: the stretch of worked days each payday pays for.
 *
 * Paydays repeat every 7 (weekly) or 14 (bi-weekly) days from a known
 * payday. With no hold-back a period ends on its payday; a hold-back pays
 * for a period that ended that many days earlier, e.g. a payday on Friday
 * with a one-week hold-back pays for the 7 or 14 days ending the Friday
 * before. Dates are calendar days in the viewer's local time.
 */

export const PAY_PERIOD_FREQUENCIES = ["weekly", "bi-weekly"] as const;
export type PayPeriodFrequency = (typeof PAY_PERIOD_FREQUENCIES)[number];

/** Longest hold-back accepted, in days. */
export const MAX_HOLDBACK_DAYS = 28;

export type PayPeriod = {
  /** First worked day, at local midnight. */
  start: Date;
  /** Last worked day, at the end of that day. */
  end: Date;
  /** The day this period is paid. */
  payday: Date;
};

const PERIOD_DAYS: Record<PayPeriodFrequency, number> = {
  weekly: 7,
  "bi-weekly": 14,
};

export function isPayPeriodFrequency(
  value: unknown,
): value is PayPeriodFrequency {
  return PAY_PERIOD_FREQUENCIES.includes(value as PayPeriodFrequency);
}

/** A `YYYY-MM-DD` calendar date as local midnight, or null when invalid. */
export function parseDateOnly(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const date = parse(value, "yyyy-MM-dd", new Date());
  return isValid(date) ? date : null;
}

export function isValidHoldbackDays(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_HOLDBACK_DAYS
  );
}

export function isValidPayPeriodInput(input: {
  enabled: unknown;
  frequency: unknown;
  anchorPayday: unknown;
  holdbackDays: unknown;
}): boolean {
  return (
    typeof input.enabled === "boolean" &&
    isPayPeriodFrequency(input.frequency) &&
    parseDateOnly(input.anchorPayday) !== null &&
    isValidHoldbackDays(input.holdbackDays)
  );
}

/** Whether the org has turned pay periods on with usable settings. */
export function isPayPeriodEnabled(
  settings: PayPeriodSettingsData | null | undefined,
): settings is PayPeriodSettingsData {
  return Boolean(
    settings?.enabled &&
      isValidPayPeriodInput({
        enabled: settings.enabled,
        frequency: settings.frequency,
        anchorPayday: settings.anchor_payday,
        holdbackDays: settings.holdback_days,
      }),
  );
}

function periodForPayday(
  payday: Date,
  periodDays: number,
  holdbackDays: number,
): PayPeriod {
  const lastDay = addDays(payday, -holdbackDays);
  return {
    start: startOfDay(addDays(lastDay, -(periodDays - 1))),
    end: endOfDay(lastDay),
    payday,
  };
}

/**
 * The pay period whose worked days include `date`, plus `offset` periods
 * after it (negative for earlier ones).
 */
export function getPayPeriod(
  settings: PayPeriodSettingsData,
  date: Date,
  offset = 0,
): PayPeriod {
  const anchor = parseDateOnly(settings.anchor_payday) as Date;
  const periodDays = PERIOD_DAYS[settings.frequency];
  // The first worked day of the period paid on the anchor payday.
  const anchorStart = addDays(
    anchor,
    -(settings.holdback_days + periodDays - 1),
  );
  const index = Math.floor(
    differenceInCalendarDays(startOfDay(date), anchorStart) / periodDays,
  );
  const payday = addDays(anchor, (index + offset) * periodDays);
  return periodForPayday(payday, periodDays, settings.holdback_days);
}

/**
 * Pay periods around `date`, newest first: `after` upcoming periods, the
 * one containing `date`, then `before` earlier ones.
 */
export function listPayPeriods(
  settings: PayPeriodSettingsData,
  date: Date,
  before: number,
  after: number,
): PayPeriod[] {
  const periods: PayPeriod[] = [];
  for (let offset = after; offset >= -before; offset--) {
    periods.push(getPayPeriod(settings, date, offset));
  }
  return periods;
}

/** The `start|end` value the Hours view's range params use. */
export function payPeriodRangeValue(period: PayPeriod): string {
  return `${toLocalISO(period.start)}|${toLocalISO(period.end)}`;
}

/** e.g. "Oct 31 – Nov 6". */
export function formatPayPeriodRange(period: PayPeriod): string {
  return `${format(period.start, "MMM d")} – ${format(period.end, "MMM d")}`;
}

/** e.g. "Fri, Nov 13". */
export function formatPayday(period: PayPeriod): string {
  return format(period.payday, "EEE, MMM d");
}

/** A hold-back in plain words, e.g. "1 week" or "3 days". */
export function describeHoldback(days: number): string {
  if (days === 0) return "No hold-back";
  if (days % 7 === 0) {
    const weeks = days / 7;
    return `${weeks} week${weeks === 1 ? "" : "s"}`;
  }
  return `${days} day${days === 1 ? "" : "s"}`;
}
