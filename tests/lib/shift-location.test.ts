import { describe, expect, it } from "vitest";
import {
  findSiteByName,
  MAX_SHIFT_LOCATION_LENGTH,
  NO_SHIFT_LOCATION,
  resolveShiftLocation,
  shiftLocationMapUrl,
  shiftLocationOf,
  shiftLocationText,
} from "@/lib/shift-location";

const sites = [
  { id: 1, name: "Warehouse", address: " 1 King St " },
  { id: 2, name: "Shop", address: null },
  { id: 3, name: "Depot" },
];

describe("resolveShiftLocation", () => {
  it("snapshots a saved site's name and address", () => {
    expect(resolveShiftLocation({ siteId: 1 }, sites)).toEqual({
      ok: true,
      value: {
        site_id: 1,
        location: "Warehouse",
        location_address: "1 King St",
      },
    });
    expect(resolveShiftLocation({ siteId: 2, location: "x" }, sites)).toEqual({
      ok: true,
      value: { site_id: 2, location: "Shop", location_address: null },
    });
    expect(resolveShiftLocation({ siteId: 3 }, sites)).toEqual({
      ok: true,
      value: { site_id: 3, location: "Depot", location_address: null },
    });
  });

  it("rejects a site that isn't in the list", () => {
    expect(resolveShiftLocation({ siteId: 9 }, sites)).toEqual({
      ok: false,
      reason: "Location not found",
    });
  });

  it("keeps a typed location trimmed, and clears on nothing", () => {
    expect(resolveShiftLocation({ location: "  Client " }, [])).toEqual({
      ok: true,
      value: { site_id: null, location: "Client", location_address: null },
    });
    expect(resolveShiftLocation({ siteId: null, location: "  " }, [])).toEqual({
      ok: true,
      value: NO_SHIFT_LOCATION,
    });
    expect(resolveShiftLocation({}, [])).toEqual({
      ok: true,
      value: NO_SHIFT_LOCATION,
    });
  });

  it("rejects a typed location that is too long", () => {
    expect(
      resolveShiftLocation(
        { location: "x".repeat(MAX_SHIFT_LOCATION_LENGTH + 1) },
        [],
      ),
    ).toEqual({ ok: false, reason: "Location is too long" });
  });
});

describe("shiftLocationOf", () => {
  it("reads the columns, defaulting missing ones to null", () => {
    expect(shiftLocationOf({})).toEqual(NO_SHIFT_LOCATION);
    expect(
      shiftLocationOf({ site_id: 1, location: "A", location_address: "B" }),
    ).toEqual({ site_id: 1, location: "A", location_address: "B" });
  });
});

describe("shiftLocationText", () => {
  it("joins the name and address", () => {
    expect(
      shiftLocationText({ location: "Warehouse", location_address: "1 King" }),
    ).toBe("Warehouse, 1 King");
    expect(shiftLocationText({ location: "Shop" })).toBe("Shop");
    expect(shiftLocationText({ location: "A", location_address: "A" })).toBe(
      "A",
    );
    expect(
      shiftLocationText({ location: " ", location_address: "1 King" }),
    ).toBe("1 King");
    expect(shiftLocationText({})).toBeNull();
  });
});

describe("shiftLocationMapUrl", () => {
  it("searches the address, else the name", () => {
    expect(
      shiftLocationMapUrl({ location: "W", location_address: "1 King St" }),
    ).toBe("https://www.google.com/maps/search/?api=1&query=1%20King%20St");
    expect(shiftLocationMapUrl({ location: "Client & Co" })).toBe(
      "https://www.google.com/maps/search/?api=1&query=Client%20%26%20Co",
    );
    expect(shiftLocationMapUrl({})).toBeNull();
  });
});

describe("findSiteByName", () => {
  it("matches ignoring case and spaces", () => {
    expect(findSiteByName(sites, "  warehouse ")?.id).toBe(1);
    expect(findSiteByName(sites, "nowhere")).toBeUndefined();
  });
});
