// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reverseGeocode, searchAddress } from "@/lib/geoapify";

describe("geoapify utilities", () => {
  const originalEnv = process.env.GEOAPIFY_API_KEY;

  beforeEach(() => {
    process.env.GEOAPIFY_API_KEY = "test_key";
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env.GEOAPIFY_API_KEY = originalEnv;
  });

  describe("reverseGeocode", () => {
    it("returns null when no API key is available", async () => {
      delete process.env.GEOAPIFY_API_KEY;
      const res = await reverseGeocode(
        { latitude: 45.4215, longitude: -75.6972 },
        undefined,
      );
      expect(res).toBeNull();
    });

    it("returns null for non-finite coordinates", async () => {
      const res = await reverseGeocode({
        latitude: Number.NaN,
        longitude: -75.6972,
      });
      expect(res).toBeNull();
    });

    it("resolves formatted address when Geoapify returns features", async () => {
      const mockResponse = {
        features: [
          {
            properties: {
              formatted: "111 Albert Street, Ottawa, ON K1P 1B1, Canada",
            },
          },
        ],
      };
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const res = await reverseGeocode({
        latitude: 45.4215,
        longitude: -75.6972,
      });
      expect(res).toBe("111 Albert Street, Ottawa, ON K1P 1B1, Canada");
      expect(global.fetch).toHaveBeenCalledTimes(1);
      const url = vi.mocked(global.fetch).mock.calls[0][0] as string;
      expect(url).toContain("lat=45.4215");
      expect(url).toContain("lon=-75.6972");
      expect(url).toContain("apiKey=test_key");
    });

    it("returns null when Geoapify responds with an HTTP error", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
      } as Response);

      const res = await reverseGeocode({
        latitude: 45.4215,
        longitude: -75.6972,
      });
      expect(res).toBeNull();
    });

    it("returns null when Geoapify features array is empty", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ features: [] }),
      } as Response);

      const res = await reverseGeocode({
        latitude: 45.4215,
        longitude: -75.6972,
      });
      expect(res).toBeNull();
    });

    it("returns null when fetch throws or times out", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("Network timeout"));

      const res = await reverseGeocode({
        latitude: 45.4215,
        longitude: -75.6972,
      });
      expect(res).toBeNull();
    });
  });

  describe("searchAddress", () => {
    it("returns empty array when API key is missing", async () => {
      delete process.env.GEOAPIFY_API_KEY;
      const res = await searchAddress("111 Albert", undefined);
      expect(res).toEqual([]);
    });

    it("returns empty array when query is too short", async () => {
      const res = await searchAddress("a");
      expect(res).toEqual([]);
    });

    it("returns formatted suggestions from Geoapify autocomplete", async () => {
      const mockResponse = {
        features: [
          {
            properties: {
              formatted: "111 Albert Street, Ottawa, ON, Canada",
              lat: 45.4215,
              lon: -75.6972,
              address_line1: "111 Albert Street",
              city: "Ottawa",
              state: "Ontario",
              postcode: "K1P 1B1",
              country: "Canada",
            },
          },
          {
            properties: {
              // Missing lat/lon -> should be filtered out
              formatted: "Invalid Location",
            },
          },
        ],
      };
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const res = await searchAddress("111 Albert");
      expect(res).toHaveLength(1);
      expect(res[0]).toEqual({
        formatted: "111 Albert Street, Ottawa, ON, Canada",
        latitude: 45.4215,
        longitude: -75.6972,
        addressLine1: "111 Albert Street",
        addressLine2: undefined,
        city: "Ottawa",
        state: "Ontario",
        postcode: "K1P 1B1",
        country: "Canada",
      });
      const url = vi.mocked(global.fetch).mock.calls[0][0] as string;
      expect(url).toContain("text=111+Albert");
      expect(url).toContain("apiKey=test_key");
    });

    it("returns empty array when Geoapify responds with HTTP error", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      } as Response);

      const res = await searchAddress("111 Albert");
      expect(res).toEqual([]);
    });

    it("returns empty array when fetch throws", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("Connection failed"));

      const res = await searchAddress("111 Albert");
      expect(res).toEqual([]);
    });

    it("returns empty array when data.features is not an array", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ features: null }),
      } as unknown as Response);

      const res = await searchAddress("111 Albert");
      expect(res).toEqual([]);
    });
  });
});
