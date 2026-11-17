import type { ScheduledShift, SiteData } from "./types";

/** Longest location an admin can type for a shift. */
export const MAX_SHIFT_LOCATION_LENGTH = 200;

/**
 * Where a shift is, as the schedule form (or the AI) sends it: a saved site
 * by id, or a location typed in. A site wins when both are given.
 */
export type ShiftLocationInput = {
  siteId?: number | null;
  location?: string | null;
};

/** The location columns stored on a scheduled shift. */
export type ShiftLocation = {
  site_id: number | null;
  location: string | null;
  location_address: string | null;
};

export const NO_SHIFT_LOCATION: ShiftLocation = {
  site_id: null,
  location: null,
  location_address: null,
};

/**
 * Turns the form's input into the columns to store: a picked site's name and
 * address are snapshotted; a typed location is trimmed; nothing clears it.
 */
export function resolveShiftLocation(
  input: ShiftLocationInput,
  sites: readonly Pick<SiteData, "id" | "name" | "address">[],
): { ok: true; value: ShiftLocation } | { ok: false; reason: string } {
  if (input.siteId !== undefined && input.siteId !== null) {
    const site = sites.find((s) => s.id === input.siteId);
    if (!site) return { ok: false, reason: "Location not found" };
    return {
      ok: true,
      value: {
        site_id: site.id,
        location: site.name,
        location_address: site.address?.trim() || null,
      },
    };
  }
  const typed = input.location?.trim() || null;
  if (!typed) return { ok: true, value: NO_SHIFT_LOCATION };
  if (typed.length > MAX_SHIFT_LOCATION_LENGTH) {
    return { ok: false, reason: "Location is too long" };
  }
  return {
    ok: true,
    value: { site_id: null, location: typed, location_address: null },
  };
}

/** The shift's current location columns, for keeping them on an update. */
export const shiftLocationOf = (
  shift: Pick<ScheduledShift, "site_id" | "location" | "location_address">,
): ShiftLocation => ({
  site_id: shift.site_id ?? null,
  location: shift.location ?? null,
  location_address: shift.location_address ?? null,
});

/**
 * One line naming where the shift is, e.g. "Main warehouse, 12 King St" — for
 * calendar events and notices. Null when the shift has no location.
 */
export function shiftLocationText(
  shift: Pick<ScheduledShift, "location" | "location_address">,
): string | null {
  const name = shift.location?.trim();
  const address = shift.location_address?.trim();
  if (!name) return address || null;
  if (!address || address === name) return name;
  return `${name}, ${address}`;
}

/** A Google Maps search link for the shift's location, if it has one. */
export function shiftLocationMapUrl(
  shift: Pick<ScheduledShift, "location" | "location_address">,
): string | null {
  const query = shift.location_address?.trim() || shiftLocationText(shift);
  if (!query) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/**
 * Finds a saved site by name, ignoring case and surrounding spaces, so the AI
 * can say "Main warehouse" and get the site rather than free text.
 */
export function findSiteByName<T extends Pick<SiteData, "name">>(
  sites: readonly T[],
  name: string,
): T | undefined {
  const wanted = name.trim().toLowerCase();
  return sites.find((site) => site.name.trim().toLowerCase() === wanted);
}
