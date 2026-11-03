import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isSupported: vi.fn(),
  getMessaging: vi.fn(),
  getToken: vi.fn(),
  deleteToken: vi.fn(),
  getApps: vi.fn(),
  initializeApp: vi.fn(),
}));

vi.mock("@firebase/messaging", () => ({
  isSupported: mocks.isSupported,
  getMessaging: mocks.getMessaging,
  getToken: mocks.getToken,
  deleteToken: mocks.deleteToken,
}));
vi.mock("@firebase/app", () => ({
  getApps: mocks.getApps,
  initializeApp: mocks.initializeApp,
}));

import {
  isFcmSupported,
  registerFcm,
  unregisterFcm,
  usesKey,
} from "@/lib/fcm-client";

// "AQID" is base64url for [1, 2, 3].
const config = {
  apiKey: "key",
  projectId: "proj",
  messagingSenderId: "123",
  appId: "app",
  vapidKey: "AQID",
};

const pushManager = { getSubscription: vi.fn() };
const registration = { pushManager };
const requestPermission = vi.fn();

const subscription = (endpoint: string, key: number[] | null) => ({
  endpoint,
  options: { applicationServerKey: key ? new Uint8Array(key).buffer : null },
  unsubscribe: vi.fn().mockResolvedValue(true),
});

beforeEach(() => {
  Object.defineProperty(navigator, "serviceWorker", {
    value: { ready: Promise.resolve(registration) },
    configurable: true,
  });
  vi.stubGlobal(
    "Notification",
    Object.assign(vi.fn(), { requestPermission, permission: "granted" }),
  );
  requestPermission.mockResolvedValue("granted");
  mocks.isSupported.mockResolvedValue(true);
  mocks.getApps.mockReturnValue([]);
  mocks.initializeApp.mockReturnValue({ name: "clock-out" });
  mocks.getMessaging.mockReturnValue({ messaging: true });
  mocks.getToken.mockResolvedValue("fcm-token");
  mocks.deleteToken.mockResolvedValue(true);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  // @ts-expect-error -- remove the stub again
  delete navigator.serviceWorker;
});

describe("isFcmSupported", () => {
  it("asks the Firebase SDK, and is false if that fails", async () => {
    await expect(isFcmSupported()).resolves.toBe(true);
    mocks.isSupported.mockResolvedValueOnce(false);
    await expect(isFcmSupported()).resolves.toBe(false);
    mocks.isSupported.mockRejectedValueOnce(new Error("no idb"));
    await expect(isFcmSupported()).resolves.toBe(false);
  });
});

describe("usesKey", () => {
  it("compares the subscription's key with a VAPID key", () => {
    expect(usesKey(subscription("e", [1, 2, 3]) as never, "AQID")).toBe(true);
    expect(usesKey(subscription("e", [1, 2, 4]) as never, "AQID")).toBe(false);
    expect(usesKey(subscription("e", [1, 2]) as never, "AQID")).toBe(false);
    expect(usesKey(subscription("e", null) as never, "AQID")).toBe(false);
    expect(usesKey({ endpoint: "e" } as never, "AQID")).toBe(false);
  });
});

describe("registerFcm", () => {
  it("returns null when permission isn't granted", async () => {
    requestPermission.mockResolvedValueOnce("denied");
    await expect(
      registerFcm(config, { requestPermission: true }),
    ).resolves.toBeNull();
    vi.stubGlobal("Notification", { permission: "default" });
    await expect(
      registerFcm(config, { requestPermission: false }),
    ).resolves.toBeNull();
    expect(mocks.getToken).not.toHaveBeenCalled();
  });

  it("gets a token through the app's own service worker", async () => {
    const sub = subscription("https://fcm/ep", [1, 2, 3]);
    pushManager.getSubscription.mockResolvedValue(null);
    pushManager.getSubscription
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(sub);
    await expect(
      registerFcm(config, { requestPermission: true }),
    ).resolves.toEqual({
      token: "fcm-token",
      endpoint: "https://fcm/ep",
      replacedEndpoint: null,
    });
    expect(requestPermission).toHaveBeenCalled();
    expect(mocks.initializeApp).toHaveBeenCalledWith(
      {
        apiKey: "key",
        projectId: "proj",
        messagingSenderId: "123",
        appId: "app",
      },
      "clock-out",
    );
    expect(mocks.getToken).toHaveBeenCalledWith(
      { messaging: true },
      { vapidKey: "AQID", serviceWorkerRegistration: registration },
    );
  });

  it("reuses a subscription made with the same key, and the existing app", async () => {
    const sub = subscription("https://same/ep", [1, 2, 3]);
    pushManager.getSubscription.mockResolvedValue(sub);
    mocks.getApps.mockReturnValue([{ name: "other" }, { name: "clock-out" }]);
    await expect(
      registerFcm(config, { requestPermission: false }),
    ).resolves.toEqual({
      token: "fcm-token",
      endpoint: "https://same/ep",
      replacedEndpoint: null,
    });
    expect(sub.unsubscribe).not.toHaveBeenCalled();
    expect(mocks.initializeApp).not.toHaveBeenCalled();
    expect(mocks.getMessaging).toHaveBeenCalledWith({ name: "clock-out" });
  });

  it("replaces a legacy subscription made with another key", async () => {
    const legacy = subscription("https://legacy/ep", [9, 9, 9]);
    pushManager.getSubscription
      .mockResolvedValueOnce(legacy)
      .mockResolvedValueOnce(null);
    await expect(
      registerFcm(config, { requestPermission: false }),
    ).resolves.toEqual({
      token: "fcm-token",
      endpoint: null,
      replacedEndpoint: "https://legacy/ep",
    });
    expect(legacy.unsubscribe).toHaveBeenCalled();
  });
});

describe("unregisterFcm", () => {
  it("deletes the token, logging failures", async () => {
    await unregisterFcm(config);
    expect(mocks.deleteToken).toHaveBeenCalledWith({ messaging: true });
    mocks.deleteToken.mockRejectedValueOnce(new Error("offline"));
    await unregisterFcm(config);
    expect(console.error).toHaveBeenCalledWith(
      "FCM unregister failed:",
      expect.any(Error),
    );
  });
});
