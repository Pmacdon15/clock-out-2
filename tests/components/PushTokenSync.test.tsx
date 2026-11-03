import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationSettingsView } from "@/lib/alerts-dal";
import { resolved } from "../utils";

const mocks = vi.hoisted(() => ({
  saveFcmTokenAction: vi.fn(),
  isFcmSupported: vi.fn(),
  registerFcm: vi.fn(),
  getCurrentSubscription: vi.fn(),
  getPushSupport: vi.fn(),
}));
vi.mock("@/lib/alert-actions", () => ({
  saveFcmTokenAction: mocks.saveFcmTokenAction,
}));
vi.mock("@/lib/fcm-client", () => ({
  isFcmSupported: mocks.isFcmSupported,
  registerFcm: mocks.registerFcm,
}));
vi.mock("@/lib/push-client", () => ({
  getCurrentSubscription: mocks.getCurrentSubscription,
  getPushSupport: mocks.getPushSupport,
}));

import PushTokenSync from "@/components/PushTokenSync";

const firebase = {
  apiKey: "key",
  projectId: "proj",
  messagingSenderId: "123",
  appId: "app",
  vapidKey: "vapid",
};

const view = (
  fb: NotificationSettingsView["firebase"],
): NotificationSettingsView => ({
  preferences: {
    email_enabled: true,
    push_enabled: true,
    shift_alerts: true,
    break_alerts: true,
    admin_alerts: true,
    schedule_alerts: true,
  },
  emailAvailable: true,
  pushAvailable: true,
  vapidPublicKey: null,
  firebase: fb,
  timezone: null,
});

const renderWith = (fb: NotificationSettingsView["firebase"]) =>
  render(
    <PushTokenSync settingsPromise={resolved({ ok: true, value: view(fb) })} />,
  );

const reg = {
  token: "fcm-token",
  endpoint: "https://fcm/1",
  replacedEndpoint: null,
};

beforeEach(() => {
  vi.stubGlobal("Notification", { permission: "granted" });
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.getPushSupport.mockReturnValue("supported");
  mocks.getCurrentSubscription.mockResolvedValue({ endpoint: "https://fcm/1" });
  mocks.isFcmSupported.mockResolvedValue(true);
  mocks.registerFcm.mockResolvedValue(reg);
  mocks.saveFcmTokenAction.mockResolvedValue({ success: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PushTokenSync", () => {
  it("refreshes this device's token without prompting, and renders nothing", async () => {
    const { container } = renderWith(firebase);
    expect(container).toBeEmptyDOMElement();
    await waitFor(() =>
      expect(mocks.saveFcmTokenAction).toHaveBeenCalledWith(
        reg,
        navigator.userAgent,
      ),
    );
    expect(mocks.registerFcm).toHaveBeenCalledWith(firebase, {
      requestPermission: false,
    });
  });

  it("does nothing when FCM is off or this browser has no push", async () => {
    renderWith(null);
    mocks.getPushSupport.mockReturnValue("unsupported");
    renderWith(firebase);
    await act(async () => {});
    expect(mocks.getCurrentSubscription).not.toHaveBeenCalled();
  });

  it("does nothing without permission, a subscription or FCM support", async () => {
    vi.stubGlobal("Notification", { permission: "default" });
    renderWith(firebase);
    await act(async () => {});
    expect(mocks.getCurrentSubscription).not.toHaveBeenCalled();

    vi.stubGlobal("Notification", { permission: "granted" });
    mocks.getCurrentSubscription.mockResolvedValueOnce(null);
    renderWith(firebase);
    await waitFor(() =>
      expect(mocks.getCurrentSubscription).toHaveBeenCalled(),
    );
    expect(mocks.isFcmSupported).not.toHaveBeenCalled();

    mocks.isFcmSupported.mockResolvedValueOnce(false);
    renderWith(firebase);
    await waitFor(() => expect(mocks.isFcmSupported).toHaveBeenCalled());
    expect(mocks.registerFcm).not.toHaveBeenCalled();
  });

  it("skips saving when there is no token or it unmounted meanwhile", async () => {
    mocks.registerFcm.mockResolvedValueOnce(null);
    renderWith(firebase);
    await waitFor(() => expect(mocks.registerFcm).toHaveBeenCalledTimes(1));

    let finish: (value: typeof reg) => void = () => {};
    mocks.registerFcm.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { unmount } = renderWith(firebase);
    await waitFor(() => expect(mocks.registerFcm).toHaveBeenCalledTimes(2));
    unmount();
    await act(async () => finish(reg));
    expect(mocks.saveFcmTokenAction).not.toHaveBeenCalled();
  });

  it("logs failures quietly", async () => {
    mocks.registerFcm.mockRejectedValueOnce(new Error("idb blocked"));
    renderWith(firebase);
    await waitFor(() =>
      expect(console.error).toHaveBeenCalledWith(
        "Push token refresh failed:",
        expect.any(Error),
      ),
    );
  });

  it("does nothing when settings failed to load", async () => {
    render(
      <PushTokenSync
        settingsPromise={resolved({ ok: false, error: { reason: "x" } })}
      />,
    );
    await act(async () => {});
    expect(mocks.getPushSupport).not.toHaveBeenCalled();
  });
});
