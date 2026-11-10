import { z } from "zod";

/**
 * Runtime checks for values that reach the DAL from server actions. Server
 * actions are public endpoints and TypeScript types are not enforced at
 * runtime, so anything a caller sends has to be checked here before it is
 * stored or used.
 */

export const REPORT_FREQUENCIES = [
  "off",
  "pay-period",
  "weekly",
  "twice-monthly",
  "custom",
  "bi-weekly",
  // Older rows and clients use this spelling; the cron reads both.
  "biweekly",
] as const;

export const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export const reportingSettingsSchema = z.object({
  frequency: z.enum(REPORT_FREQUENCIES),
  day: z.enum(WEEKDAYS).nullable(),
  interval: z.number().int().min(1).max(2),
});

export const MAX_SITE_NAME_LENGTH = 100;
export const MAX_SITE_ADDRESS_LENGTH = 500;

/** Returns why a site name or address is unacceptable, or null when fine. */
export function invalidSiteTextReason(
  name: unknown,
  address: unknown,
): string | null {
  if (typeof name !== "string" || !name.trim()) {
    return "Site name is required";
  }
  if (name.trim().length > MAX_SITE_NAME_LENGTH) {
    return `Site name must be ${MAX_SITE_NAME_LENGTH} characters or fewer`;
  }
  if (address !== undefined && address !== null) {
    if (typeof address !== "string") return "Invalid site address";
    if (address.length > MAX_SITE_ADDRESS_LENGTH) {
      return `Site address must be ${MAX_SITE_ADDRESS_LENGTH} characters or fewer`;
    }
  }
  return null;
}

/** Earliest time a recorded shift or break may be moved to. */
export const EARLIEST_RECORDED_TIME = new Date("2000-01-01T00:00:00Z");
/** How far past now a recorded shift or break may end (clock-skew slack). */
export const MAX_FUTURE_RECORDED_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Whether a time is a plausible moment for an already-worked shift or break:
 * a real date, not before 2000 and no more than a week from now.
 */
export function isWithinRecordedWindow(
  date: Date,
  now: Date = new Date(),
): boolean {
  const t = date.getTime();
  return (
    !Number.isNaN(t) &&
    t >= EARLIEST_RECORDED_TIME.getTime() &&
    t <= now.getTime() + MAX_FUTURE_RECORDED_MS
  );
}

/** Parses a date string from a client, or returns null when it is not one. */
export function parseClientDate(value: unknown): Date | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) {
    return null;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
