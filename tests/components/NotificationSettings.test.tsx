import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "@/lib/alerts";
import type { NotificationSettingsView } from "@/lib/alerts-dal";
import { resolved } from "../utils";

const mocks = vi.hoisted(() => ({
  deletePushSubscriptionAction: vi.fn(),
  savePushSubscriptionAction: vi.fn(),
  sendTestNotificationAction: vi.fn(),
  updateNotificationPreferencesAction: vi.fn(),
  getCurrentSubscription: vi.fn(),
  getPushSupport: vi.fn(),
  subscribeThisDevice: vi.fn(),
  toSubscriptionInput: vi.fn((sub: { endpoint: string }) => ({
    endpoint: sub.endpoint,
    keys: { p256dh: "p", auth: "a" },
  })),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/alert-actions", () => ({
  deletePushSubscriptionAction: mocks.deletePushSubscriptionAction,
  savePushSubscriptionAction: mocks.savePushSubscriptionAction,
  sendTestNotificationAction: mocks.sendTestNotificationAction,
  updateNotificationPreferencesAction:
    mocks.updateNotificationPreferencesAction,
}));
vi.mock("@/lib/push-client", () => ({
  getCurrentSubscription: mocks.getCurrentSubscription,
  getPushSupport: mocks.getPushSupport,
  subscribeThisDevice: mocks.subscribeThisDevice,
  toSubscriptionInput: mocks.toSubscriptionInput,
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import NotificationSettings from "@/components/NotificationSettings";

const view = (
  overrides: Partial<NotificationSettingsView> = {},
): NotificationSettingsView => ({
  preferences: DEFAULT_NOTIFICATION_PREFERENCES,
  emailAvailable: true,
  pushAvailable: true,
  vapidPublicKey: "vapid",
  ...overrides,
});

function renderSettings(
  overrides: Partial<NotificationSettingsView> = {},
  isAdmin = false,
) {
  return render(
    <NotificationSettings
      isAdmin={isAdmin}
      settingsPromise={resolved({ ok: true as const, value: view(overrides) })}
    />,
  );
}

const fakeSub = (endpoint = "https://push.example/1") => ({
  endpoint,
  unsubscribe: vi.fn().mockResolvedValue(true),
});

const button = (name: RegExp | string) => screen.getByRole("button", { name });

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.getPushSupport.mockReturnValue("supported");
  mocks.getCurrentSubscription.mockResolvedValue(null);
});

describe("NotificationSettings", () => {
  it("shows the load error", () => {
    render(
      <NotificationSettings
        isAdmin={false}
        settingsPromise={resolved({
          ok: false as const,
          error: { reason: "Error fetching notification preferences" },
        })}
      />,
    );
    expect(
      screen.getByText("Error fetching notification preferences"),
    ).toBeInTheDocument();
  });

  it("lets a member pick channels and topics, without team alerts", async () => {
    mocks.updateNotificationPreferencesAction.mockResolvedValue({
      success: true,
      data: {},
    });
    renderSettings();
    expect(screen.queryByLabelText(/Team alerts/)).toBeNull();
    expect(button("Save Preferences")).toBeDisabled();

    fireEvent.click(screen.getByLabelText(/^Email/));
    fireEvent.click(screen.getByLabelText(/Forgot to end break/));
    fireEvent.click(button("Save Preferences"));

    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith(
        "Notification preferences saved",
      ),
    );
    expect(mocks.updateNotificationPreferencesAction).toHaveBeenCalledWith({
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      email_enabled: false,
      break_alerts: false,
    });
    await waitFor(() => expect(button("Save Preferences")).toBeDisabled());
  });

  it("offers admins team alerts and reports save errors", async () => {
    mocks.updateNotificationPreferencesAction
      .mockResolvedValueOnce({ success: false, error: "Nope" })
      .mockResolvedValueOnce({ success: false, error: "" });
    renderSettings({ emailAvailable: false }, true);
    expect(
      screen.getByText(/Email isn't configured on this server yet/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Team alerts/));
    fireEvent.click(button("Save Preferences"));
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith("Nope"));
    fireEvent.click(button("Save Preferences"));
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("Update failed"),
    );
  });

  it("explains when push isn't configured on the server", () => {
    renderSettings({ pushAvailable: false, vapidPublicKey: null });
    expect(screen.getByTestId("this-device")).toHaveTextContent(
      "aren't configured on this server",
    );
    expect(mocks.getCurrentSubscription).not.toHaveBeenCalled();
  });

  it("tells iPhone users to add the app to the Home Screen", () => {
    mocks.getPushSupport.mockReturnValue("ios-needs-install");
    renderSettings();
    expect(screen.getByTestId("this-device")).toHaveTextContent(
      "Add to Home Screen",
    );
  });

  it("says when the browser can't do push", () => {
    mocks.getPushSupport.mockReturnValue("unsupported");
    renderSettings();
    expect(screen.getByTestId("this-device")).toHaveTextContent(
      "can't receive push notifications",
    );
  });

  it("treats a failed subscription lookup as not subscribed", async () => {
    mocks.getCurrentSubscription.mockRejectedValue(new Error("no sw"));
    renderSettings();
    expect(await screen.findByText(/off for this device/)).toBeInTheDocument();
  });

  it("turns push on for this device", async () => {
    const sub = fakeSub();
    mocks.subscribeThisDevice.mockResolvedValue(sub);
    mocks.savePushSubscriptionAction.mockResolvedValue({ success: true });
    renderSettings();
    fireEvent.click(await screen.findByRole("button", { name: /Turn on/ }));
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith(
        "Push notifications are on for this device",
      ),
    );
    expect(mocks.subscribeThisDevice).toHaveBeenCalledWith("vapid");
    expect(mocks.savePushSubscriptionAction).toHaveBeenCalledWith(
      { endpoint: sub.endpoint, keys: { p256dh: "p", auth: "a" } },
      navigator.userAgent,
    );
    expect(await screen.findByText(/on for this device\./)).toBeInTheDocument();
  });

  it("handles a refused permission, a failed save and an exception", async () => {
    renderSettings();
    const turnOn = await screen.findByRole("button", { name: /Turn on/ });

    mocks.subscribeThisDevice.mockResolvedValueOnce(null);
    fireEvent.click(turnOn);
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(
        expect.stringContaining("Notifications are blocked"),
      ),
    );

    mocks.subscribeThisDevice.mockResolvedValue(fakeSub());
    mocks.savePushSubscriptionAction.mockResolvedValueOnce({
      success: false,
      error: "Invalid push subscription",
    });
    fireEvent.click(turnOn);
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(
        "Invalid push subscription",
      ),
    );

    mocks.savePushSubscriptionAction.mockResolvedValueOnce({
      success: false,
      error: "",
    });
    fireEvent.click(turnOn);
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(
        "Could not save this device",
      ),
    );

    mocks.subscribeThisDevice.mockRejectedValueOnce(new Error("boom"));
    fireEvent.click(turnOn);
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(
        "Could not turn on push notifications here",
      ),
    );
  });

  it("turns push off for this device, even if the browser unsubscribe fails", async () => {
    const sub = fakeSub();
    sub.unsubscribe.mockRejectedValueOnce(new Error("gone"));
    mocks.getCurrentSubscription.mockResolvedValue(sub);
    mocks.deletePushSubscriptionAction.mockResolvedValue({ success: true });
    renderSettings();
    fireEvent.click(await screen.findByRole("button", { name: /Turn off/ }));
    await waitFor(() =>
      expect(mocks.deletePushSubscriptionAction).toHaveBeenCalledWith(
        sub.endpoint,
      ),
    );
    expect(await screen.findByText(/off for this device/)).toBeInTheDocument();

    // A clean unsubscribe works too.
    const second = fakeSub("https://push.example/2");
    mocks.subscribeThisDevice.mockResolvedValue(second);
    mocks.savePushSubscriptionAction.mockResolvedValue({ success: true });
    fireEvent.click(button(/Turn on/));
    fireEvent.click(await screen.findByRole("button", { name: /Turn off/ }));
    await waitFor(() => expect(second.unsubscribe).toHaveBeenCalled());
  });

  it("sends a test notification and summarises what went out", async () => {
    renderSettings();
    const test = button(/Send test notification/);

    mocks.sendTestNotificationAction.mockResolvedValueOnce({
      success: true,
      data: { email: 1, push: 1 },
    });
    fireEvent.click(test);
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith(
        "Test sent: 1 email, 1 push",
      ),
    );

    mocks.sendTestNotificationAction.mockResolvedValueOnce({
      success: true,
      data: { email: 2, push: 3 },
    });
    fireEvent.click(test);
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith(
        "Test sent: 2 emails, 3 pushes",
      ),
    );

    mocks.sendTestNotificationAction.mockResolvedValueOnce({
      success: true,
      data: { email: 0, push: 0 },
    });
    fireEvent.click(test);
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(
        expect.stringContaining("Nothing was sent"),
      ),
    );

    mocks.sendTestNotificationAction.mockResolvedValueOnce({
      success: false,
      error: "Unauthorized",
    });
    fireEvent.click(test);
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("Unauthorized"),
    );

    mocks.sendTestNotificationAction.mockResolvedValueOnce({
      success: false,
      error: "",
    });
    fireEvent.click(test);
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("Test failed"),
    );
  });
});
