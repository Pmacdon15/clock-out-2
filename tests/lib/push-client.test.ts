import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCurrentSubscription,
  getPushSupport,
  isIOS,
  isStandalone,
  subscribeThisDevice,
  toSubscriptionInput,
  urlBase64ToUint8Array,
} from "@/lib/push-client";

const pushManager = { getSubscription: vi.fn(), subscribe: vi.fn() };
const requestPermission = vi.fn();
const originalUA = navigator.userAgent;

function setUserAgent(ua: string) {
  Object.defineProperty(window.navigator, "userAgent", {
    value: ua,
    configurable: true,
  });
}

function installPushApis() {
  Object.defineProperty(navigator, "serviceWorker", {
    value: { ready: Promise.resolve({ pushManager }) },
    configurable: true,
  });
  vi.stubGlobal("PushManager", class {});
  vi.stubGlobal("Notification", { requestPermission });
}

beforeEach(() => {
  setUserAgent("Mozilla/5.0 (X11; Linux x86_64) Chrome/130");
  installPushApis();
  window.matchMedia = vi.fn(() => ({ matches: false })) as never;
});

afterEach(() => {
  setUserAgent(originalUA);
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, "standalone", {
    value: undefined,
    configurable: true,
  });
  // @ts-expect-error -- remove the stub again
  delete navigator.serviceWorker;
});

describe("urlBase64ToUint8Array", () => {
  it("decodes base64url with or without padding", () => {
    expect(Array.from(urlBase64ToUint8Array("AQID"))).toEqual([1, 2, 3]);
    expect(Array.from(urlBase64ToUint8Array("-_8"))).toEqual([251, 255]);
  });
});

describe("platform detection", () => {
  it("detects standalone mode from the media query or iOS flag", () => {
    expect(isStandalone()).toBe(false);
    window.matchMedia = vi.fn(() => ({ matches: true })) as never;
    expect(isStandalone()).toBe(true);
    window.matchMedia = undefined as never;
    Object.defineProperty(navigator, "standalone", {
      value: true,
      configurable: true,
    });
    expect(isStandalone()).toBe(true);
  });

  it("detects iOS", () => {
    expect(isIOS()).toBe(false);
    setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)");
    expect(isIOS()).toBe(true);
  });

  it("reports push support", () => {
    expect(getPushSupport()).toBe("supported");
    setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)");
    expect(getPushSupport()).toBe("ios-needs-install");
    window.matchMedia = vi.fn(() => ({ matches: true })) as never;
    expect(getPushSupport()).toBe("supported");
    vi.unstubAllGlobals();
    expect(getPushSupport()).toBe("unsupported");
  });
});

describe("subscriptions", () => {
  it("reads the current subscription", async () => {
    pushManager.getSubscription.mockResolvedValue("sub");
    await expect(getCurrentSubscription()).resolves.toBe("sub");
  });

  it("returns null when permission is refused", async () => {
    requestPermission.mockResolvedValue("denied");
    await expect(subscribeThisDevice("AQID")).resolves.toBeNull();
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });

  it("reuses an existing subscription or creates one", async () => {
    requestPermission.mockResolvedValue("granted");
    pushManager.getSubscription.mockResolvedValueOnce("existing");
    await expect(subscribeThisDevice("AQID")).resolves.toBe("existing");

    pushManager.getSubscription.mockResolvedValueOnce(null);
    pushManager.subscribe.mockResolvedValueOnce("fresh");
    await expect(subscribeThisDevice("AQID")).resolves.toBe("fresh");
    const options = pushManager.subscribe.mock.calls[0][0];
    expect(options.userVisibleOnly).toBe(true);
    expect(Array.from(options.applicationServerKey)).toEqual([1, 2, 3]);
  });

  it("serialises a subscription, tolerating missing fields", () => {
    const full = {
      endpoint: "https://p/1",
      toJSON: () => ({
        endpoint: "https://p/1",
        keys: { p256dh: "k", auth: "a" },
      }),
    } as unknown as PushSubscription;
    expect(toSubscriptionInput(full)).toEqual({
      endpoint: "https://p/1",
      keys: { p256dh: "k", auth: "a" },
    });
    const bare = {
      endpoint: "https://p/2",
      toJSON: () => ({}),
    } as unknown as PushSubscription;
    expect(toSubscriptionInput(bare)).toEqual({
      endpoint: "https://p/2",
      keys: { p256dh: "", auth: "" },
    });
  });
});
