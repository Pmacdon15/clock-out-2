import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  reverseGeocode: vi.fn(),
  searchAddress: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  PUNCH_GEOCODE_LIMIT: { name: "punch-geocode", limit: 30, windowSeconds: 600 },
}));
vi.mock("@/lib/geoapify", () => ({
  reverseGeocode: mocks.reverseGeocode,
  searchAddress: mocks.searchAddress,
}));

import { punchReverseGeocode, punchSearchAddress } from "@/lib/punch-geocode";

const coords = { latitude: 51.05, longitude: -114.07 };

describe("punch geocoding quota", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("geocodes when the user is under the limit", async () => {
    mocks.checkRateLimit.mockResolvedValue({ ok: true, remaining: 5 });
    mocks.reverseGeocode.mockResolvedValue("1 Main St");
    mocks.searchAddress.mockResolvedValue([{ formatted: "1 Main St" }]);

    expect(await punchReverseGeocode("user_1", coords)).toBe("1 Main St");
    expect(await punchSearchAddress("user_1", "1 Main")).toEqual([
      { formatted: "1 Main St" },
    ]);
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ name: "punch-geocode" }),
      "user_1",
    );
  });

  it("skips Geoapify when the user is over the limit", async () => {
    mocks.checkRateLimit.mockResolvedValue({ ok: false, retryAfterSeconds: 9 });

    expect(await punchReverseGeocode("user_1", coords)).toBeNull();
    expect(await punchSearchAddress("user_1", "1 Main")).toEqual([]);
    expect(mocks.reverseGeocode).not.toHaveBeenCalled();
    expect(mocks.searchAddress).not.toHaveBeenCalled();
  });
});
