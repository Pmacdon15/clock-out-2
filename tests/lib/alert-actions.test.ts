// @vitest-environment node
import { err, ok } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateTag: vi.fn(),
  deletePushSubscriptionDal: vi.fn(),
  savePushSubscriptionDal: vi.fn(),
  sendTestNotificationDal: vi.fn(),
  setMyTimezoneDal: vi.fn(),
  updateAlertSettingsDal: vi.fn(),
  updateNotificationPreferencesDal: vi.fn(),
  saveFcmTokenDal: vi.fn(),
  queueShiftAlertSync: vi.fn(),
}));

vi.mock("next/cache", () => ({ updateTag: mocks.updateTag }));
vi.mock("@/lib/alert-jobs", () => ({
  queueShiftAlertSync: mocks.queueShiftAlertSync,
}));
vi.mock("@/lib/alerts-dal", () => ({
  saveFcmTokenDal: mocks.saveFcmTokenDal,
  deletePushSubscriptionDal: mocks.deletePushSubscriptionDal,
  savePushSubscriptionDal: mocks.savePushSubscriptionDal,
  sendTestNotificationDal: mocks.sendTestNotificationDal,
  setMyTimezoneDal: mocks.setMyTimezoneDal,
  updateAlertSettingsDal: mocks.updateAlertSettingsDal,
  updateNotificationPreferencesDal: mocks.updateNotificationPreferencesDal,
}));

import {
  deletePushSubscriptionAction,
  saveFcmTokenAction,
  savePushSubscriptionAction,
  sendTestNotificationAction,
  setMyTimezoneAction,
  updateAlertSettingsAction,
  updateNotificationPreferencesAction,
} from "@/lib/alert-actions";
import {
  DEFAULT_ALERT_SETTINGS,
  DEFAULT_NOTIFICATION_PREFERENCES,
} from "@/lib/alerts";

const failure = err({ reason: "nope" });
const sub = { endpoint: "https://p/1", keys: { p256dh: "p", auth: "a" } };

describe("alert actions", () => {
  it("updates alert settings and refreshes the org's cache", async () => {
    mocks.updateAlertSettingsDal.mockResolvedValueOnce(ok({ org_id: "org_1" }));
    await expect(
      updateAlertSettingsAction(DEFAULT_ALERT_SETTINGS),
    ).resolves.toEqual({ success: true, data: { org_id: "org_1" } });
    expect(mocks.updateTag).toHaveBeenCalledWith("alert-settings-org_1");
    // New thresholds reschedule the org's next alert.
    expect(mocks.queueShiftAlertSync).toHaveBeenCalledWith("org_1");

    mocks.updateAlertSettingsDal.mockResolvedValueOnce(failure);
    await expect(
      updateAlertSettingsAction(DEFAULT_ALERT_SETTINGS),
    ).resolves.toEqual({ success: false, error: "nope" });
  });

  it("updates preferences and refreshes the user's cache", async () => {
    mocks.updateNotificationPreferencesDal.mockResolvedValueOnce(
      ok({ user_id: "u1" }),
    );
    await expect(
      updateNotificationPreferencesAction(DEFAULT_NOTIFICATION_PREFERENCES),
    ).resolves.toEqual({ success: true, data: { user_id: "u1" } });
    expect(mocks.updateTag).toHaveBeenCalledWith("notification-prefs-u1");

    mocks.updateNotificationPreferencesDal.mockResolvedValueOnce(failure);
    await expect(
      updateNotificationPreferencesAction(DEFAULT_NOTIFICATION_PREFERENCES),
    ).resolves.toEqual({ success: false, error: "nope" });
  });

  it("saves FCM registrations", async () => {
    const reg = { token: "t".repeat(40), endpoint: "https://fcm/1" };
    mocks.saveFcmTokenDal.mockResolvedValueOnce(ok(true));
    await expect(saveFcmTokenAction(reg, "UA")).resolves.toEqual({
      success: true,
    });
    expect(mocks.saveFcmTokenDal).toHaveBeenCalledWith(reg, "UA");
    mocks.saveFcmTokenDal.mockResolvedValueOnce(failure);
    await expect(saveFcmTokenAction(reg)).resolves.toEqual({
      success: false,
      error: "nope",
    });
  });

  it("saves and removes devices", async () => {
    mocks.savePushSubscriptionDal.mockResolvedValueOnce(ok(true));
    await expect(savePushSubscriptionAction(sub, "UA")).resolves.toEqual({
      success: true,
    });
    expect(mocks.savePushSubscriptionDal).toHaveBeenCalledWith(sub, "UA");
    mocks.savePushSubscriptionDal.mockResolvedValueOnce(failure);
    await expect(savePushSubscriptionAction(sub)).resolves.toEqual({
      success: false,
      error: "nope",
    });

    mocks.deletePushSubscriptionDal.mockResolvedValueOnce(ok(true));
    await expect(deletePushSubscriptionAction(sub.endpoint)).resolves.toEqual({
      success: true,
    });
    mocks.deletePushSubscriptionDal.mockResolvedValueOnce(failure);
    await expect(deletePushSubscriptionAction(sub.endpoint)).resolves.toEqual({
      success: false,
      error: "nope",
    });
  });

  it("sends a test notification", async () => {
    mocks.sendTestNotificationDal.mockResolvedValueOnce(
      ok({ email: 1, push: 0 }),
    );
    await expect(sendTestNotificationAction()).resolves.toEqual({
      success: true,
      data: { email: 1, push: 0 },
    });
    mocks.sendTestNotificationDal.mockResolvedValueOnce(failure);
    await expect(sendTestNotificationAction()).resolves.toEqual({
      success: false,
      error: "nope",
    });
  });

  it("remembers my time zone and refreshes my preferences", async () => {
    mocks.setMyTimezoneDal.mockResolvedValueOnce(ok({ user_id: "u1" }));
    await expect(setMyTimezoneAction("UTC")).resolves.toEqual({
      success: true,
    });
    expect(mocks.updateTag).toHaveBeenCalledWith("notification-prefs-u1");
    mocks.setMyTimezoneDal.mockResolvedValueOnce(failure);
    await expect(setMyTimezoneAction("x")).resolves.toEqual({
      success: false,
      error: "nope",
    });
  });
});
