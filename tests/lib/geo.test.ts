import { describe, expect, it } from "vitest";
import {
  captureMode,
  evaluateClockLocation,
  findMatchingSite,
  findNearestSite,
  formatCoordinates,
  haversineDistanceMeters,
  isCaptureEnabled,
  isLocationRequired,
  isRestricted,
  isValidCoordinates,
} from "@/lib/geo";
import type { LocationSettingsData, SiteData } from "@/lib/types";

const site = (overrides: Partial<SiteData> = {}): SiteData => ({
  id: 1,
  org_id: "org_1",
  name: "Depot",
  latitude: 45.4215,
  longitude: -75.6972,
  radius_meters: 150,
  ...overrides,
});

const settings = (
  overrides: Partial<LocationSettingsData> = {},
): LocationSettingsData => ({
  org_id: "org_1",
  capture_mode: "off",
  restrict_clock_in: false,
  ...overrides,
});

const OTTAWA = { latitude: 45.4215, longitude: -75.6972 };
const TORONTO = { latitude: 43.6532, longitude: -79.3832 };

describe("haversineDistanceMeters", () => {
  it("is zero for the same point", () => {
    expect(haversineDistanceMeters(OTTAWA, OTTAWA)).toBe(0);
  });

  it("measures a known city-to-city distance", () => {
    // Ottawa to Toronto is roughly 350 km as the crow flies.
    expect(haversineDistanceMeters(OTTAWA, TORONTO)).toBeCloseTo(350_000, -4);
  });

  it("is symmetric", () => {
    expect(haversineDistanceMeters(OTTAWA, TORONTO)).toBeCloseTo(
      haversineDistanceMeters(TORONTO, OTTAWA),
      6,
    );
  });

  it("measures one degree of longitude at the equator", () => {
    const meters = haversineDistanceMeters(
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 1 },
    );
    expect(meters).toBeCloseTo(111_195, -2);
  });

  it("measures across the antimeridian as a short hop, not half the globe", () => {
    const meters = haversineDistanceMeters(
      { latitude: 0, longitude: 179.999 },
      { latitude: 0, longitude: -179.999 },
    );
    // 0.002° of longitude at the equator, ~222 m — not ~40,000 km.
    expect(meters).toBeCloseTo(222, 0);
  });

  it("measures pole to pole as half the meridian", () => {
    const meters = haversineDistanceMeters(
      { latitude: 90, longitude: 0 },
      { latitude: -90, longitude: 0 },
    );
    expect(meters).toBeCloseTo(20_015_000, -4);
  });

  it("measures antipodal points on the equator as half the circumference", () => {
    const meters = haversineDistanceMeters(
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 180 },
    );
    expect(meters).toBeCloseTo(20_015_000, -4);
  });
});

describe("isValidCoordinates", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["NaN latitude", { latitude: Number.NaN, longitude: 0 }],
    [
      "infinite longitude",
      { latitude: 0, longitude: Number.POSITIVE_INFINITY },
    ],
    ["latitude over 90", { latitude: 90.1, longitude: 0 }],
    ["latitude under -90", { latitude: -90.1, longitude: 0 }],
    ["longitude over 180", { latitude: 0, longitude: 180.1 }],
    ["longitude under -180", { latitude: 0, longitude: -180.1 }],
  ])("rejects %s", (_label, value) => {
    expect(isValidCoordinates(value)).toBe(false);
  });

  it.each([
    ["the null island", { latitude: 0, longitude: 0 }],
    ["the poles", { latitude: -90, longitude: 180 }],
    ["an ordinary point", OTTAWA],
  ])("accepts %s", (_label, value) => {
    expect(isValidCoordinates(value)).toBe(true);
  });
});

describe("findNearestSite", () => {
  const near = site({ id: 1, name: "Near", radius_meters: 10 });
  const far = site({
    id: 2,
    name: "Far",
    latitude: 45.5,
    longitude: -75.7,
    radius_meters: 10_000,
  });

  it("returns null without coordinates or sites", () => {
    expect(findNearestSite(null, [near])).toBeNull();
    expect(findNearestSite(OTTAWA, [])).toBeNull();
    expect(findNearestSite(OTTAWA, null)).toBeNull();
  });

  it("picks the closest site and says whether the point is inside it", () => {
    const match = findNearestSite(OTTAWA, [far, near]);
    expect(match?.site.name).toBe("Near");
    expect(match?.distanceMeters).toBeCloseTo(0, 6);
    expect(match?.within).toBe(true);
  });

  it("reports a point outside the closest site", () => {
    // ~0.01° of latitude is a little over 1 km.
    const match = findNearestSite({ latitude: 45.4315, longitude: -75.6972 }, [
      near,
    ]);
    expect(match?.within).toBe(false);
    expect(match?.distanceMeters).toBeGreaterThan(1000);
  });

  it("keeps the first site when a later one is farther away", () => {
    const match = findNearestSite(OTTAWA, [near, far]);
    expect(match?.site.name).toBe("Near");
  });

  it("skips sites whose numbers do not parse", () => {
    const broken = site({ id: 3, name: "Broken", latitude: Number.NaN });
    expect(findNearestSite(OTTAWA, [broken])).toBeNull();
    expect(findNearestSite(OTTAWA, [broken, near])?.site.name).toBe("Near");
  });

  it("accepts the numeric strings Postgres can hand back", () => {
    const stringy = {
      name: "Stringy",
      latitude: "45.4215",
      longitude: "-75.6972",
      radius_meters: "150",
    };
    expect(findNearestSite(OTTAWA, [stringy])?.within).toBe(true);
  });
});

describe("findMatchingSite", () => {
  it("counts a point exactly on the radius as inside", () => {
    const point = { latitude: 45.4315, longitude: -75.6972 };
    const exact = haversineDistanceMeters(point, OTTAWA);
    expect(
      findMatchingSite(point, [site({ radius_meters: exact })])?.name,
    ).toBe("Depot");
    // A hair tighter and the same point is outside.
    expect(
      findMatchingSite(point, [site({ radius_meters: exact - 0.001 })]),
    ).toBeNull();
  });

  it("treats a zero radius as matching only the exact point", () => {
    expect(findMatchingSite(OTTAWA, [site({ radius_meters: 0 })])?.name).toBe(
      "Depot",
    );
    expect(
      findMatchingSite({ latitude: 45.4216, longitude: -75.6972 }, [
        site({ radius_meters: 0 }),
      ]),
    ).toBeNull();
  });

  it("treats a negative radius as zero rather than matching everything", () => {
    expect(
      findMatchingSite({ latitude: 45.43, longitude: -75.6972 }, [
        site({ radius_meters: -500 }),
      ]),
    ).toBeNull();
  });

  it("prefers a containing site even when a closer site does not contain the point", () => {
    const tightAndClose = site({
      id: 1,
      name: "Tight",
      latitude: 45.4215,
      longitude: -75.6972,
      radius_meters: 1,
    });
    const wideAndFar = site({
      id: 2,
      name: "Wide",
      latitude: 45.5,
      longitude: -75.6972,
      radius_meters: 20_000,
    });
    // 50 m north of "Tight": outside it, but well inside "Wide".
    const point = { latitude: 45.42195, longitude: -75.6972 };
    expect(findMatchingSite(point, [tightAndClose, wideAndFar])?.name).toBe(
      "Wide",
    );
  });

  it("returns null when the site list is missing", () => {
    expect(findMatchingSite(OTTAWA, null)).toBeNull();
  });

  it("returns null without usable coordinates", () => {
    expect(findMatchingSite(undefined, [site()])).toBeNull();
    expect(
      findMatchingSite({ latitude: 999, longitude: 0 }, [site()]),
    ).toBeNull();
  });
});

describe("settings helpers", () => {
  it("defaults to capture off when there are no settings", () => {
    expect(captureMode(null)).toBe("off");
    expect(captureMode(undefined)).toBe("off");
    expect(isCaptureEnabled(null)).toBe(false);
    expect(isRestricted(null)).toBe(false);
    expect(isLocationRequired(null)).toBe(false);
  });

  it("reads the stored mode", () => {
    expect(captureMode(settings({ capture_mode: "required" }))).toBe(
      "required",
    );
    expect(isCaptureEnabled(settings({ capture_mode: "optional" }))).toBe(true);
    expect(isLocationRequired(settings({ capture_mode: "optional" }))).toBe(
      false,
    );
    expect(isLocationRequired(settings({ capture_mode: "required" }))).toBe(
      true,
    );
  });

  it("treats a restriction as implying capture, whatever the mode says", () => {
    const restricted = settings({ restrict_clock_in: true });
    expect(isRestricted(restricted)).toBe(true);
    expect(isCaptureEnabled(restricted)).toBe(true);
    expect(isLocationRequired(restricted)).toBe(true);
  });
});

describe("formatCoordinates", () => {
  it("formats to five decimal places", () => {
    expect(formatCoordinates(45.4215, -75.6972)).toBe("45.42150, -75.69720");
  });

  it("accepts numeric strings", () => {
    expect(formatCoordinates("45.4215", "-75.6972")).toBe(
      "45.42150, -75.69720",
    );
  });

  it("returns an empty string for junk", () => {
    expect(formatCoordinates(Number.NaN, 0)).toBe("");
    expect(formatCoordinates(0, "abc")).toBe("");
  });
});

describe("evaluateClockLocation", () => {
  it("stores nothing and allows the punch when capture is off", () => {
    expect(
      evaluateClockLocation({
        coordinates: OTTAWA,
        sites: [site()],
        settings: settings(),
      }),
    ).toEqual({ allowed: true, location: null });
  });

  it("allows the punch and stores nothing when there are no settings at all", () => {
    expect(evaluateClockLocation({ coordinates: OTTAWA })).toEqual({
      allowed: true,
      location: null,
    });
  });

  it("stores coordinates and the matched site when capture is optional", () => {
    expect(
      evaluateClockLocation({
        coordinates: { ...OTTAWA, accuracy: 12.4 },
        sites: [site()],
        settings: settings({ capture_mode: "optional" }),
      }),
    ).toEqual({
      allowed: true,
      location: {
        latitude: OTTAWA.latitude,
        longitude: OTTAWA.longitude,
        accuracy: 12.4,
        siteName: "Depot",
      },
    });
  });

  it("stores a null site name when the punch matches no site", () => {
    const decision = evaluateClockLocation({
      coordinates: TORONTO,
      sites: [site()],
      settings: settings({ capture_mode: "optional" }),
    });
    expect(decision).toEqual({
      allowed: true,
      location: {
        latitude: TORONTO.latitude,
        longitude: TORONTO.longitude,
        accuracy: null,
        siteName: null,
      },
    });
  });

  it("normalises a missing or nonsensical accuracy", () => {
    const decision = evaluateClockLocation({
      coordinates: { ...OTTAWA, accuracy: -5 },
      settings: settings({ capture_mode: "optional" }),
    });
    expect(decision).toEqual({
      allowed: true,
      location: {
        latitude: OTTAWA.latitude,
        longitude: OTTAWA.longitude,
        accuracy: 0,
        siteName: null,
      },
    });
  });

  it("allows a punch with no coordinates when capture is optional", () => {
    expect(
      evaluateClockLocation({
        coordinates: null,
        settings: settings({ capture_mode: "optional" }),
      }),
    ).toEqual({ allowed: true, location: null });
  });

  it.each([
    ["missing", null],
    ["out of range", { latitude: 1000, longitude: 0 }],
    ["not a number", { latitude: Number.NaN, longitude: 0 }],
  ])("refuses a clock-in whose coordinates are %s when required", (_l, bad) => {
    const decision = evaluateClockLocation({
      coordinates: bad,
      settings: settings({ capture_mode: "required" }),
    });
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.reason).toContain(
      "requires your location",
    );
  });

  it("refuses a clock-in outside every site when clock-in is restricted", () => {
    const decision = evaluateClockLocation({
      coordinates: TORONTO,
      sites: [site()],
      settings: settings({ restrict_clock_in: true }),
    });
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.reason).toBe(
      "You are not at an approved work site, so you cannot clock in. You are 352 km from Depot.",
    );
  });

  it("reports a miss of a few hundred metres in metres", () => {
    const decision = evaluateClockLocation({
      // ~0.0035° of latitude north of the site: a few hundred metres.
      coordinates: { latitude: 45.425, longitude: -75.6972 },
      sites: [site({ radius_meters: 50 })],
      settings: settings({ restrict_clock_in: true }),
    });
    expect(decision.allowed === false && decision.reason).toMatch(
      /You are 3\d\d m from Depot\.$/,
    );
  });

  it("reports a miss of a kilometre or so in kilometres", () => {
    const decision = evaluateClockLocation({
      coordinates: { latitude: 45.4315, longitude: -75.6972 },
      sites: [site({ radius_meters: 50 })],
      settings: settings({ restrict_clock_in: true }),
    });
    expect(decision.allowed === false && decision.reason).toMatch(
      /You are 1\.1 km from Depot\.$/,
    );
  });

  it("allows a restricted clock-in inside a site", () => {
    const decision = evaluateClockLocation({
      coordinates: OTTAWA,
      sites: [site({ name: "Yard" })],
      settings: settings({ capture_mode: "required", restrict_clock_in: true }),
    });
    expect(decision).toEqual({
      allowed: true,
      location: {
        latitude: OTTAWA.latitude,
        longitude: OTTAWA.longitude,
        accuracy: null,
        siteName: "Yard",
      },
    });
  });

  it("does not lock anyone out when a restriction has no sites yet", () => {
    const decision = evaluateClockLocation({
      coordinates: TORONTO,
      sites: [],
      settings: settings({ restrict_clock_in: true }),
    });
    expect(decision).toEqual({
      allowed: true,
      location: {
        latitude: TORONTO.latitude,
        longitude: TORONTO.longitude,
        accuracy: null,
        siteName: null,
      },
    });
  });

  it("ignores sites whose coordinates are unusable when deciding", () => {
    const decision = evaluateClockLocation({
      coordinates: TORONTO,
      sites: [site({ latitude: Number.NaN })],
      settings: settings({ restrict_clock_in: true }),
    });
    // The only site is unusable, so there is effectively nothing to enforce.
    expect(decision.allowed).toBe(true);
  });

  it("never refuses a clock-out, inside a site or not", () => {
    const decision = evaluateClockLocation({
      coordinates: TORONTO,
      sites: [site()],
      settings: settings({ capture_mode: "required", restrict_clock_in: true }),
      enforceGeofence: false,
    });
    expect(decision).toEqual({
      allowed: true,
      location: {
        latitude: TORONTO.latitude,
        longitude: TORONTO.longitude,
        accuracy: null,
        siteName: null,
      },
    });
  });

  it("allows a clock-out with no coordinates even when capture is required", () => {
    expect(
      evaluateClockLocation({
        coordinates: null,
        settings: settings({ capture_mode: "required" }),
        enforceGeofence: false,
      }),
    ).toEqual({ allowed: true, location: null });
  });
});
