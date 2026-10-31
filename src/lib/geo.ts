import type { LocationSettingsData, SiteData } from "./types";

/**
 * Geofencing maths and the clock-in/clock-out location decision.
 *
 * Everything here is pure: no database, no `navigator`, no clock. The server
 * is the only place the decision is made (the DAL calls
 * `evaluateClockLocation`); the client just hands over whatever the browser's
 * Geolocation API gave it.
 */

/** What the browser hands us (a subset of `GeolocationCoordinates`). */
export type Coordinates = {
  latitude: number;
  longitude: number;
  /** Radius of 68% confidence in metres, when the browser reports one. */
  accuracy?: number | null;
};

/** A site as stored, tolerating the strings Postgres `numeric` can return. */
export type SiteLike = {
  name: string;
  latitude: number | string;
  longitude: number | string;
  radius_meters: number | string;
  address?: string | null;
};

/** The location columns written onto a time entry. */
export type StoredLocation = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  /**
   * Name of the site the punch fell inside, snapshotted at punch time so
   * renaming or deleting a site never rewrites history. Null when the punch
   * matched no site (or no sites are configured).
   */
  siteName: string | null;
  /** Human-readable address resolved via reverse geocoding. */
  address?: string | null;
};

export type LocationDecision =
  | { allowed: true; location: StoredLocation | null }
  | { allowed: false; reason: string };

/** How precise capture must be. Mirrors `location_settings.capture_mode`. */
export type LocationCaptureMode = "off" | "optional" | "required";

/** Mean Earth radius (IUGG), in metres. */
const EARTH_RADIUS_METERS = 6_371_008.8;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

const toFiniteNumber = (value: number | string | null | undefined) => {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

/**
 * Great-circle distance between two points in metres, via the haversine
 * formula. Wrapping across the antimeridian is handled by the trigonometry
 * itself — no special-casing of longitudes near ±180 is needed.
 */
export function haversineDistanceMeters(
  from: Coordinates,
  to: Coordinates,
): number {
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);
  const deltaLat = lat2 - lat1;
  const deltaLon = toRadians(to.longitude - from.longitude);

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  // `min(1, …)` guards against floating-point drift pushing `a` over 1.
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** True when the coordinates are real numbers inside the WGS84 ranges. */
export function isValidCoordinates(
  coordinates: Coordinates | null | undefined,
): coordinates is Coordinates {
  if (!coordinates) return false;
  const { latitude, longitude } = coordinates;
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

/** A site is usable for geofencing only if its three numbers parse. */
function siteCenter(site: SiteLike) {
  const latitude = toFiniteNumber(site.latitude);
  const longitude = toFiniteNumber(site.longitude);
  const radius = toFiniteNumber(site.radius_meters);
  if (
    latitude === null ||
    longitude === null ||
    radius === null ||
    !isValidCoordinates({ latitude, longitude })
  ) {
    return null;
  }
  return { latitude, longitude, radius: Math.max(0, radius) };
}

export type SiteMatch<T extends SiteLike = SiteLike> = {
  site: T;
  distanceMeters: number;
  /** True when the point is inside (or exactly on) the site's radius. */
  within: boolean;
};

/**
 * Nearest site to the given point, or null when there is nothing to compare
 * against. A point exactly on the radius counts as inside.
 */
export function findNearestSite<T extends SiteLike>(
  coordinates: Coordinates | null | undefined,
  sites: readonly T[] | null | undefined,
): SiteMatch<T> | null {
  if (!isValidCoordinates(coordinates) || !sites?.length) return null;

  let best: SiteMatch<T> | null = null;
  for (const site of sites) {
    const center = siteCenter(site);
    if (!center) continue;
    const distanceMeters = haversineDistanceMeters(coordinates, center);
    if (!best || distanceMeters < best.distanceMeters) {
      best = {
        site,
        distanceMeters,
        within: distanceMeters <= center.radius,
      };
    }
  }
  return best;
}

/**
 * The site the point falls inside, preferring the closest such site. Sites are
 * filtered before the nearest is picked, because a distant site with a large
 * radius can contain a point that a closer, tighter site does not.
 */
export function findMatchingSite<T extends SiteLike>(
  coordinates: Coordinates | null | undefined,
  sites: readonly T[] | null | undefined,
): T | null {
  if (!isValidCoordinates(coordinates)) return null;
  const matches = (sites ?? []).filter((site) => {
    const center = siteCenter(site);
    return (
      center !== null &&
      haversineDistanceMeters(coordinates, center) <= center.radius
    );
  });
  return findNearestSite(coordinates, matches)?.site ?? null;
}

export const captureMode = (
  settings: LocationSettingsData | null | undefined,
): LocationCaptureMode =>
  (settings?.capture_mode as LocationCaptureMode | undefined) ?? "off";

/** True when clock-in is limited to the configured sites. */
export const isRestricted = (
  settings: LocationSettingsData | null | undefined,
) => settings?.restrict_clock_in === true;

/** True when the org has asked for coordinates at all. */
export const isCaptureEnabled = (
  settings: LocationSettingsData | null | undefined,
) => captureMode(settings) !== "off" || isRestricted(settings);

/** True when a punch without coordinates must be refused. */
export const isLocationRequired = (
  settings: LocationSettingsData | null | undefined,
) => captureMode(settings) === "required" || isRestricted(settings);

export const formatMeters = (meters: number) =>
  meters >= 1000
    ? `${(meters / 1000).toFixed(meters >= 10_000 ? 0 : 1)} km`
    : `${Math.round(meters)} m`;

/** "45.42100, -75.69000" — used in the UI and the exports. */
export const formatCoordinates = (
  latitude: number | string,
  longitude: number | string,
) => {
  const lat = toFiniteNumber(latitude);
  const lon = toFiniteNumber(longitude);
  if (lat === null || lon === null) return "";
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
};

/**
 * Decides whether a punch is allowed and what should be stored with it.
 *
 * `enforceGeofence` is false for clock-out: leaving a site should never trap
 * someone on the clock, so a clock-out records where it happened but is never
 * refused for being outside.
 *
 * When capture is off the coordinates are dropped on the floor — an org that
 * never turns this on stores nothing, which is the whole point.
 */
export function evaluateClockLocation({
  coordinates,
  sites,
  settings,
  enforceGeofence = true,
}: {
  coordinates?: Coordinates | null;
  sites?: readonly SiteData[] | null;
  settings?: LocationSettingsData | null;
  enforceGeofence?: boolean;
}): LocationDecision {
  if (!isCaptureEnabled(settings)) {
    return { allowed: true, location: null };
  }

  if (!isValidCoordinates(coordinates)) {
    if (isLocationRequired(settings) && enforceGeofence) {
      return {
        allowed: false,
        reason:
          "Your organization requires your location to clock in. Allow location access in your browser and try again.",
      };
    }
    // Capture is optional, or this is a clock-out: carry on without it.
    return { allowed: true, location: null };
  }

  const usableSites = (sites ?? []).filter((site) => siteCenter(site) !== null);
  const matchedSite = findMatchingSite(coordinates, usableSites);
  const nearest = findNearestSite(coordinates, usableSites);

  // `nearest` is null exactly when no usable site exists, and a restriction
  // with no sites would lock out the whole org — so it only bites once an
  // admin has defined at least one.
  if (enforceGeofence && isRestricted(settings) && nearest && !matchedSite) {
    return {
      allowed: false,
      reason:
        "You are not at an approved work site, so you cannot clock in." +
        ` You are ${formatMeters(nearest.distanceMeters)} from ${nearest.site.name}.`,
    };
  }

  const accuracy = toFiniteNumber(coordinates.accuracy);
  return {
    allowed: true,
    location: {
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      accuracy: accuracy === null ? null : Math.max(0, accuracy),
      siteName: matchedSite ? matchedSite.name : null,
    },
  };
}
