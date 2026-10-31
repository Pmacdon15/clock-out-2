import type { Coordinates } from "./geo";

export type AddressSuggestion = {
  formatted: string;
  latitude: number;
  longitude: number;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postcode?: string;
  country?: string;
};

const GEOAPIFY_TIMEOUT_MS = 3000;

/**
 * Reverse geocodes a latitude/longitude pair into a human-readable street address.
 * Never throws: returns null when the API key is missing, on network errors, or when
 * no address can be resolved.
 */
export async function reverseGeocode(
  coordinates: Coordinates,
  apiKey: string | undefined = process.env.GEOAPIFY_API_KEY,
): Promise<string | null> {
  if (!apiKey) return null;
  const { latitude, longitude } = coordinates;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  try {
    const url = new URL("https://api.geoapify.com/v1/geocode/reverse");
    url.searchParams.set("lat", String(latitude));
    url.searchParams.set("lon", String(longitude));
    url.searchParams.set("apiKey", apiKey);

    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(GEOAPIFY_TIMEOUT_MS),
    });
    if (!res.ok) return null;

    const data = await res.json();
    const formatted = data?.features?.[0]?.properties?.formatted;
    return typeof formatted === "string" && formatted.trim().length > 0
      ? formatted.trim()
      : null;
  } catch {
    return null;
  }
}

interface GeoapifyFeature {
  properties?: {
    lat?: number;
    lon?: number;
    formatted?: string;
    address_line1?: string;
    address_line2?: string;
    city?: string;
    state?: string;
    postcode?: string;
    country?: string;
  };
}

/**
 * Autocompletes/searches address suggestions from Geoapify.
 * Returns an array of formatted address candidates with their coordinates.
 */
export async function searchAddress(
  text: string,
  apiKey: string | undefined = process.env.GEOAPIFY_API_KEY,
): Promise<AddressSuggestion[]> {
  if (!apiKey || !text || text.trim().length < 2) return [];

  try {
    const url = new URL("https://api.geoapify.com/v1/geocode/autocomplete");
    url.searchParams.set("text", text.trim());
    url.searchParams.set("limit", "5");
    url.searchParams.set("apiKey", apiKey);

    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(GEOAPIFY_TIMEOUT_MS),
    });
    if (!res.ok) return [];

    const data = await res.json();
    if (!Array.isArray(data?.features)) return [];

    return (data.features as GeoapifyFeature[])
      .map((feat): AddressSuggestion | null => {
        const props = feat?.properties;
        const lat = props?.lat;
        const lon = props?.lon;
        const formatted = props?.formatted;
        if (
          !props ||
          typeof lat !== "number" ||
          typeof lon !== "number" ||
          typeof formatted !== "string"
        ) {
          return null;
        }
        return {
          formatted,
          latitude: lat,
          longitude: lon,
          addressLine1: props.address_line1,
          addressLine2: props.address_line2,
          city: props.city,
          state: props.state,
          postcode: props.postcode,
          country: props.country,
        };
      })
      .filter(
        (item: AddressSuggestion | null): item is AddressSuggestion =>
          item !== null,
      );
  } catch {
    return [];
  }
}
