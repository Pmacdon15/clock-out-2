import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureCurrentPosition,
  DEFAULT_GEOLOCATION_OPTIONS,
} from "@/lib/geolocation";

type PositionCallback = (position: {
  coords: { latitude: number; longitude: number; accuracy?: number };
}) => void;
type ErrorCallback = (error: { code?: number; message?: string }) => void;

/** Installs a `navigator.geolocation` double and returns its spy. */
function stubGeolocation(
  impl: (
    onSuccess: PositionCallback,
    onError: ErrorCallback,
    options?: PositionOptions,
  ) => void,
) {
  const getCurrentPosition = vi.fn(impl);
  vi.stubGlobal("navigator", { geolocation: { getCurrentPosition } });
  return getCurrentPosition;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("captureCurrentPosition", () => {
  it("returns the browser's coordinates and accuracy", async () => {
    const spy = stubGeolocation((onSuccess) =>
      onSuccess({
        coords: { latitude: 45.4215, longitude: -75.6972, accuracy: 9.5 },
      }),
    );

    await expect(captureCurrentPosition()).resolves.toEqual({
      ok: true,
      coordinates: { latitude: 45.4215, longitude: -75.6972, accuracy: 9.5 },
    });
    expect(spy).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      DEFAULT_GEOLOCATION_OPTIONS,
    );
  });

  it("passes through caller-supplied position options", async () => {
    const spy = stubGeolocation((onSuccess) =>
      onSuccess({ coords: { latitude: 0, longitude: 0 } }),
    );
    const options = { timeout: 1 };

    await captureCurrentPosition(options);
    expect(spy).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      options,
    );
  });

  it("reports a null accuracy when the browser omits one", async () => {
    stubGeolocation((onSuccess) =>
      onSuccess({ coords: { latitude: 1, longitude: 2 } }),
    );

    await expect(captureCurrentPosition()).resolves.toEqual({
      ok: true,
      coordinates: { latitude: 1, longitude: 2, accuracy: null },
    });
  });

  it("explains an unsupported browser", async () => {
    vi.stubGlobal("navigator", {});
    const result = await captureCurrentPosition();
    expect(result).toEqual({
      ok: false,
      failure: {
        code: "unsupported",
        message: expect.stringContaining("can't share your location"),
      },
    });
  });

  it("explains an insecure context before asking for permission", async () => {
    const spy = stubGeolocation(() => {
      throw new Error("should not be called");
    });
    vi.stubGlobal("window", { isSecureContext: false });

    const result = await captureCurrentPosition();
    expect(result).toEqual({
      ok: false,
      failure: {
        code: "insecure",
        message: expect.stringContaining("secure (https) connection"),
      },
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    [1, "denied", "blocked"],
    [2, "unavailable", "couldn't work out where you are"],
    [3, "timeout", "took too long"],
    [undefined, "unavailable", "couldn't work out where you are"],
  ])(
    "turns position error code %s into an actionable %s message",
    async (code, expectedCode, fragment) => {
      stubGeolocation((_onSuccess, onError) => onError({ code }));

      const result = await captureCurrentPosition();
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.failure.code).toBe(expectedCode);
      expect(result.ok === false && result.failure.message).toContain(fragment);
    },
  );
});
