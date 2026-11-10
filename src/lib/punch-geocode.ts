import type { Coordinates } from "./geo";
import {
  type AddressSuggestion,
  reverseGeocode,
  searchAddress,
} from "./geoapify";
import { checkRateLimit, PUNCH_GEOCODE_LIMIT } from "./rate-limit";

/*
 * Geoapify lookups made while punching in or out, metered per user with
 * PUNCH_GEOCODE_LIMIT so looping punches or MCP clock-in calls can't burn
 * the shared quota. Over the limit, the lookup is skipped (no address, no
 * suggestions); the punch itself is never blocked by it.
 */

async function allowed(userId: string) {
  const limited = await checkRateLimit(PUNCH_GEOCODE_LIMIT, userId);
  if (!limited.ok) {
    console.warn(`Punch geocoding skipped for ${userId}: rate limited`);
  }
  return limited.ok;
}

/** Like {@link reverseGeocode}, but null when the user is over the limit. */
export async function punchReverseGeocode(
  userId: string,
  coordinates: Coordinates,
): Promise<string | null> {
  if (!(await allowed(userId))) return null;
  return reverseGeocode(coordinates);
}

/** Like {@link searchAddress}, but empty when the user is over the limit. */
export async function punchSearchAddress(
  userId: string,
  text: string,
): Promise<AddressSuggestion[]> {
  if (!(await allowed(userId))) return [];
  return searchAddress(text);
}
