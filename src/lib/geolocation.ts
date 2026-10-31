import type { Coordinates } from "./geo";

/**
 * Browser-side location capture.
 *
 * The Geolocation API fails in a handful of mundane ways — the person said no,
 * the device has no fix, the page isn't on https, the browser has no
 * geolocation at all — and each one needs a message that tells the member what
 * to do about it. Nothing here decides whether a punch is allowed; that is the
 * server's job.
 */

export type GeolocationFailureCode =
  | "unsupported"
  | "insecure"
  | "denied"
  | "unavailable"
  | "timeout";

export type GeolocationFailure = {
  code: GeolocationFailureCode;
  message: string;
};

export type GeolocationCapture =
  | { ok: true; coordinates: Coordinates }
  | { ok: false; failure: GeolocationFailure };

const MESSAGES: Record<GeolocationFailureCode, string> = {
  unsupported:
    "This browser can't share your location. Try another browser, or ask an admin to turn off location capture.",
  insecure:
    "Location sharing needs a secure (https) connection. Open Clock Out over https and try again.",
  denied:
    "Location access is blocked. Allow location for this site in your browser settings, then try again.",
  unavailable:
    "Your device couldn't work out where you are. Move somewhere with a clearer signal and try again.",
  timeout:
    "Getting your location took too long. Check your signal and try again.",
};

const failure = (code: GeolocationFailureCode): GeolocationCapture => ({
  ok: false,
  failure: { code, message: MESSAGES[code] },
});

/** Matches `GeolocationPositionError` without depending on the DOM class. */
const failureFromPositionError = (error: {
  code?: number;
  message?: string;
}): GeolocationCapture => {
  if (error.code === 1) return failure("denied");
  if (error.code === 3) return failure("timeout");
  return failure("unavailable");
};

export const DEFAULT_GEOLOCATION_OPTIONS = {
  enableHighAccuracy: true,
  timeout: 10_000,
  maximumAge: 30_000,
} satisfies PositionOptions;

/**
 * Asks the browser for the current position. Never rejects: every outcome is
 * an `ok` flag plus either coordinates or an actionable failure.
 */
export function captureCurrentPosition(
  options: PositionOptions = DEFAULT_GEOLOCATION_OPTIONS,
): Promise<GeolocationCapture> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve(failure("unsupported"));
  }

  // Browsers only expose geolocation in a secure context; without this check
  // the call fails as a bare "permission denied", which is misleading.
  if (typeof window !== "undefined" && window.isSecureContext === false) {
    return Promise.resolve(failure("insecure"));
  }

  return new Promise<GeolocationCapture>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          ok: true,
          coordinates: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy ?? null,
          },
        }),
      (error) => resolve(failureFromPositionError(error)),
      options,
    );
  });
}
