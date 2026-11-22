import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArrivalWatchConfig } from "@/lib/arrival-dal";
import { resolved } from "../utils";

const mocks = vi.hoisted(() => ({
  reportSiteArrivalAction: vi.fn(),
  toast: vi.fn(),
  push: vi.fn(),
}));
vi.mock("@/lib/arrival-actions", () => ({
  reportSiteArrivalAction: mocks.reportSiteArrivalAction,
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));

import ArrivalPromptSync, {
  ARRIVAL_TOAST_ID,
  ARRIVAL_WATCH_OPTIONS,
} from "@/components/ArrivalPromptSync";

const siteA = {
  id: 1,
  name: "Site A",
  latitude: 45,
  longitude: -75,
  radius_meters: 150,
};
const on: ArrivalWatchConfig = { enabled: true, sites: [siteA] };

const fix = (latitude: number, longitude: number, accuracy = 10) =>
  ({ coords: { latitude, longitude, accuracy } }) as GeolocationPosition;
const atA = fix(45, -75);
const away = fix(46, -75);

type Listener = () => void;

let onPosition: ((p: GeolocationPosition) => void) | null;
let onError: (() => void) | null;
let geolocation: {
  watchPosition: ReturnType<typeof vi.fn>;
  clearWatch: ReturnType<typeof vi.fn>;
};
let permission: {
  state: PermissionState;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  fire: () => void;
};
let query: ReturnType<typeof vi.fn>;

const stubNavigator = (overrides: Record<string, unknown> = {}) => {
  vi.stubGlobal("navigator", {
    ...navigator,
    geolocation,
    permissions: { query },
    ...overrides,
  });
};

const renderWith = (config: ArrivalWatchConfig | null = on) =>
  render(
    <ArrivalPromptSync
      configPromise={resolved(
        config
          ? { ok: true as const, value: config }
          : { ok: false as const, error: { reason: "x" } },
      )}
    />,
  );

/** Waits for the permission check, then for the watch to start. */
const watching = () =>
  waitFor(() => expect(geolocation.watchPosition).toHaveBeenCalled());

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  onPosition = null;
  onError = null;
  geolocation = {
    watchPosition: vi.fn((success, error) => {
      onPosition = success;
      onError = error;
      return 42;
    }),
    clearWatch: vi.fn(),
  };
  const listeners = new Set<Listener>();
  permission = {
    state: "granted",
    addEventListener: vi.fn((_: string, l: Listener) => listeners.add(l)),
    removeEventListener: vi.fn((_: string, l: Listener) => listeners.delete(l)),
    fire: () => {
      for (const l of listeners) l();
    },
  };
  query = vi.fn(async () => permission);
  stubNavigator();
  mocks.reportSiteArrivalAction.mockResolvedValue({
    success: true,
    data: { status: "prompted", siteName: "Site A", pushed: 1 },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ArrivalPromptSync", () => {
  it("watches location once granted, and reports an arrival", async () => {
    const { container } = renderWith();
    expect(container).toBeEmptyDOMElement();
    await watching();
    expect(query).toHaveBeenCalledWith({ name: "geolocation" });
    expect(geolocation.watchPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      ARRIVAL_WATCH_OPTIONS,
    );
    // A failed fix is ignored.
    onError?.();

    await act(async () => onPosition?.(atA));
    expect(mocks.reportSiteArrivalAction).toHaveBeenCalledWith({
      latitude: 45,
      longitude: -75,
      accuracy: 10,
    });
    // The push reached a device, so there's no in-page prompt.
    expect(mocks.toast).not.toHaveBeenCalled();

    // Staying put doesn't report again; leaving and coming back does.
    await act(async () => onPosition?.(atA));
    expect(mocks.reportSiteArrivalAction).toHaveBeenCalledTimes(1);
    await act(async () => onPosition?.(away));
    expect(mocks.reportSiteArrivalAction).toHaveBeenCalledTimes(1);
    await act(async () => onPosition?.(atA));
    expect(mocks.reportSiteArrivalAction).toHaveBeenCalledTimes(2);
  });

  it("asks in-page when no push device took the prompt", async () => {
    mocks.reportSiteArrivalAction.mockResolvedValue({
      success: true,
      data: { status: "prompted", siteName: "Site A", pushed: 0 },
    });
    renderWith();
    await watching();
    await act(async () => onPosition?.(atA));
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        "You've arrived at Site A. Clock in?",
        expect.objectContaining({ id: ARRIVAL_TOAST_ID }),
      ),
    );
    const options = mocks.toast.mock.calls[0][1];
    options.action.onClick();
    expect(mocks.push).toHaveBeenCalledWith("/");
  });

  it.each([
    [{ success: true, data: { status: "skipped", why: "clocked_in" } }],
    [{ success: false, error: "nope" }],
  ])("stays quiet when the server didn't prompt (%o)", async (res) => {
    mocks.reportSiteArrivalAction.mockResolvedValue(res);
    renderWith();
    await watching();
    await act(async () => onPosition?.(atA));
    await waitFor(() =>
      expect(mocks.reportSiteArrivalAction).toHaveBeenCalled(),
    );
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("logs a failed report", async () => {
    mocks.reportSiteArrivalAction.mockRejectedValue(new Error("offline"));
    renderWith();
    await watching();
    await act(async () => onPosition?.(atA));
    await waitFor(() =>
      expect(console.error).toHaveBeenCalledWith(
        "Arrival report failed:",
        expect.any(Error),
      ),
    );
  });

  it("drops a report that comes back after unmount", async () => {
    let finish: (v: unknown) => void = () => {};
    mocks.reportSiteArrivalAction.mockReturnValue(
      new Promise((r) => {
        finish = r;
      }),
    );
    const { unmount } = renderWith();
    await watching();
    await act(async () => onPosition?.(atA));
    unmount();
    expect(geolocation.clearWatch).toHaveBeenCalledWith(42);
    expect(permission.removeEventListener).toHaveBeenCalled();
    await act(async () =>
      finish({
        success: true,
        data: { status: "prompted", siteName: "Site A", pushed: 0 },
      }),
    );
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("never asks for location: waits for permission, stops when revoked", async () => {
    permission.state = "prompt";
    renderWith();
    await waitFor(() =>
      expect(permission.addEventListener).toHaveBeenCalledWith(
        "change",
        expect.any(Function),
      ),
    );
    expect(geolocation.watchPosition).not.toHaveBeenCalled();
    // Revoking before anything started is a no-op.
    act(() => permission.fire());
    expect(geolocation.clearWatch).not.toHaveBeenCalled();

    permission.state = "granted";
    act(() => permission.fire());
    expect(geolocation.watchPosition).toHaveBeenCalledTimes(1);
    // A repeat "granted" doesn't start a second watch.
    act(() => permission.fire());
    expect(geolocation.watchPosition).toHaveBeenCalledTimes(1);

    // Inside a site, then revoked and granted again: a fresh arrival.
    await act(async () => onPosition?.(atA));
    permission.state = "denied";
    act(() => permission.fire());
    expect(geolocation.clearWatch).toHaveBeenCalledWith(42);
    permission.state = "granted";
    act(() => permission.fire());
    await act(async () => onPosition?.(atA));
    expect(mocks.reportSiteArrivalAction).toHaveBeenCalledTimes(2);
  });

  it("ignores a permission answer that arrives after unmount", async () => {
    let answer: (p: unknown) => void = () => {};
    query.mockReturnValue(
      new Promise((r) => {
        answer = r;
      }),
    );
    const { unmount } = renderWith();
    unmount();
    await act(async () => answer(permission));
    expect(permission.addEventListener).not.toHaveBeenCalled();
    expect(geolocation.watchPosition).not.toHaveBeenCalled();
  });

  it("logs a failed permission check", async () => {
    query.mockRejectedValue(new Error("no"));
    renderWith();
    await waitFor(() =>
      expect(console.error).toHaveBeenCalledWith(
        "Location permission check failed:",
        expect.any(Error),
      ),
    );
    expect(geolocation.watchPosition).not.toHaveBeenCalled();
  });

  it.each([
    ["the config failed to load", null],
    ["prompts are off", { enabled: false, sites: [siteA] }],
    ["there are no sites", { enabled: true, sites: [] }],
  ])("does nothing when %s", async (_label, config) => {
    renderWith(config as ArrivalWatchConfig | null);
    await act(async () => {});
    expect(query).not.toHaveBeenCalled();
  });

  it.each([
    ["no geolocation", { geolocation: undefined }],
    ["no permissions API", { permissions: undefined }],
    ["a permissions API without query", { permissions: {} }],
  ])("does nothing in a browser with %s", async (_label, overrides) => {
    stubNavigator(overrides);
    renderWith();
    await act(async () => {});
    expect(query).not.toHaveBeenCalled();
    expect(geolocation.watchPosition).not.toHaveBeenCalled();
  });

  it("reads a missing accuracy as null", async () => {
    renderWith();
    await watching();
    await act(async () =>
      onPosition?.({
        coords: { latitude: 45, longitude: -75 },
      } as unknown as GeolocationPosition),
    );
    expect(mocks.reportSiteArrivalAction).toHaveBeenCalledWith({
      latitude: 45,
      longitude: -75,
      accuracy: null,
    });
  });
});
