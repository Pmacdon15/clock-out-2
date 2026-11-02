// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  protect: vi.fn(),
  currentUser: vi.fn(),
  dbDeletePushSubscription: vi.fn(),
  dbGetAlertSettings: vi.fn(),
  dbGetNotificationPreferences: vi.fn(),
  dbSavePushSubscription: vi.fn(),
  dbSetUserTimezone: vi.fn(),
  dbUpdateAlertSettings: vi.fn(),
  dbUpdateNotificationPreferences: vi.fn(),
  deliver: vi.fn(),
  isEmailConfigured: vi.fn(),
  isPushConfigured: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: { protect: mocks.protect },
  currentUser: mocks.currentUser,
}));
vi.mock("@/lib/alerts-db", () => ({
  dbDeletePushSubscription: mocks.dbDeletePushSubscription,
  dbGetAlertSettings: mocks.dbGetAlertSettings,
  dbGetNotificationPreferences: mocks.dbGetNotificationPreferences,
  dbSavePushSubscription: mocks.dbSavePushSubscription,
  dbSetUserTimezone: mocks.dbSetUserTimezone,
  dbUpdateAlertSettings: mocks.dbUpdateAlertSettings,
  dbUpdateNotificationPreferences: mocks.dbUpdateNotificationPreferences,
}));
vi.mock("@/lib/notify", () => ({
  deliver: mocks.deliver,
  isEmailConfigured: mocks.isEmailConfigured,
  isPushConfigured: mocks.isPushConfigured,
}));

import {
  DEFAULT_ALERT_SETTINGS,
  DEFAULT_NOTIFICATION_PREFERENCES,
} from "@/lib/alerts";
import {
  deletePushSubscriptionDal,
  getMyNotificationSettings,
  getOrgAlertSettings,
  savePushSubscriptionDal,
  sendTestNotificationDal,
  setMyTimezoneDal,
  updateAlertSettingsDal,
  updateNotificationPreferencesDal,
} from "@/lib/alerts-dal";
import type { AlertSettingsInput } from "@/lib/types";

const admin = { userId: "u1", orgId: "org_1", orgRole: "org:admin" };
const member = { userId: "u1", orgId: "org_1", orgRole: "org:member" };
const sub = {
  endpoint: "https://push.example/1",
  keys: { p256dh: "p", auth: "a" },
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.protect.mockResolvedValue(admin);
  mocks.isEmailConfigured.mockReturnValue(true);
  mocks.isPushConfigured.mockReturnValue(false);
});

describe("getOrgAlertSettings", () => {
  it("requires an org", async () => {
    mocks.protect.mockResolvedValue({ userId: "u1", orgId: null });
    await expect(getOrgAlertSettings()).resolves.toMatchObject({ ok: false });
  });

  it("fills defaults for an org with no row", async () => {
    mocks.dbGetAlertSettings.mockResolvedValue(undefined);
    await expect(getOrgAlertSettings()).resolves.toEqual({
      ok: true,
      value: { org_id: "org_1", ...DEFAULT_ALERT_SETTINGS },
    });
  });

  it("reports read failures", async () => {
    mocks.dbGetAlertSettings.mockRejectedValue(new Error("db"));
    await expect(getOrgAlertSettings()).resolves.toEqual({
      ok: false,
      error: { reason: "Error fetching alert settings" },
    });
  });
});

describe("updateAlertSettingsDal", () => {
  const valid: AlertSettingsInput = {
    ...DEFAULT_ALERT_SETTINGS,
    forgot_clock_out_enabled: true,
  };

  it("is admin-only", async () => {
    mocks.protect.mockResolvedValue(member);
    const result = await updateAlertSettingsDal(valid);
    expect(result._unsafeUnwrapErr()).toEqual({ reason: "Unauthorized" });
  });

  it("rejects invalid input", async () => {
    expect(
      (
        await updateAlertSettingsDal(null as unknown as AlertSettingsInput)
      )._unsafeUnwrapErr(),
    ).toEqual({ reason: "Invalid alert settings" });
    expect(
      (
        await updateAlertSettingsDal({ ...valid, break_reminder_minutes: 1 })
      )._unsafeUnwrapErr().reason,
    ).toContain("Break reminder minutes");
    expect(mocks.dbUpdateAlertSettings).not.toHaveBeenCalled();
  });

  it("saves only the known fields", async () => {
    mocks.dbUpdateAlertSettings.mockResolvedValue({ org_id: "org_1" });
    const result = await updateAlertSettingsDal({
      ...valid,
      extra: "x",
    } as AlertSettingsInput);
    expect(result._unsafeUnwrap()).toEqual({ org_id: "org_1" });
    expect(mocks.dbUpdateAlertSettings).toHaveBeenCalledWith("org_1", valid);
  });

  it("reports write failures", async () => {
    mocks.dbUpdateAlertSettings.mockRejectedValue(new Error("db"));
    expect((await updateAlertSettingsDal(valid))._unsafeUnwrapErr()).toEqual({
      reason: "Failed to update alert settings",
    });
  });
});

describe("getMyNotificationSettings", () => {
  it("requires a user", async () => {
    mocks.protect.mockResolvedValue({ userId: null });
    await expect(getMyNotificationSettings()).resolves.toMatchObject({
      ok: false,
    });
  });

  it("returns preferences and what the server can send", async () => {
    mocks.dbGetNotificationPreferences.mockResolvedValue(undefined);
    await expect(getMyNotificationSettings()).resolves.toEqual({
      ok: true,
      value: {
        preferences: DEFAULT_NOTIFICATION_PREFERENCES,
        emailAvailable: true,
        pushAvailable: false,
        vapidPublicKey: null,
        timezone: null,
      },
    });

    mocks.isPushConfigured.mockReturnValue(true);
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "pub");
    const result = await getMyNotificationSettings();
    expect(result.ok && result.value.vapidPublicKey).toBe("pub");
  });

  it("reports read failures", async () => {
    mocks.dbGetNotificationPreferences.mockRejectedValue(new Error("db"));
    await expect(getMyNotificationSettings()).resolves.toEqual({
      ok: false,
      error: { reason: "Error fetching notification preferences" },
    });
  });
});

describe("updateNotificationPreferencesDal", () => {
  it("requires a user and valid input", async () => {
    mocks.protect.mockResolvedValueOnce({ userId: null });
    expect(
      (
        await updateNotificationPreferencesDal(DEFAULT_NOTIFICATION_PREFERENCES)
      )._unsafeUnwrapErr(),
    ).toEqual({ reason: "Unauthorized" });
    expect(
      (
        await updateNotificationPreferencesDal({
          ...DEFAULT_NOTIFICATION_PREFERENCES,
          email_enabled: "no" as unknown as boolean,
        })
      )._unsafeUnwrapErr(),
    ).toEqual({ reason: "Invalid notification preferences" });
  });

  it("saves the caller's own preferences", async () => {
    mocks.dbUpdateNotificationPreferences.mockResolvedValue({ user_id: "u1" });
    const result = await updateNotificationPreferencesDal(
      DEFAULT_NOTIFICATION_PREFERENCES,
    );
    expect(result._unsafeUnwrap()).toEqual({ user_id: "u1" });
    expect(mocks.dbUpdateNotificationPreferences).toHaveBeenCalledWith(
      "u1",
      DEFAULT_NOTIFICATION_PREFERENCES,
    );
  });

  it("reports write failures", async () => {
    mocks.dbUpdateNotificationPreferences.mockRejectedValue(new Error("db"));
    expect(
      (
        await updateNotificationPreferencesDal(DEFAULT_NOTIFICATION_PREFERENCES)
      )._unsafeUnwrapErr(),
    ).toEqual({ reason: "Failed to update notification preferences" });
  });
});

describe("push subscriptions", () => {
  it("requires a user and a valid subscription", async () => {
    mocks.protect.mockResolvedValueOnce({ userId: null });
    expect((await savePushSubscriptionDal(sub))._unsafeUnwrapErr()).toEqual({
      reason: "Unauthorized",
    });
    expect(
      (
        await savePushSubscriptionDal({ ...sub, endpoint: "http://x" })
      )._unsafeUnwrapErr(),
    ).toEqual({ reason: "Invalid push subscription" });
  });

  it("saves the device with a trimmed user agent", async () => {
    mocks.dbSavePushSubscription.mockResolvedValue({ id: 1 });
    const result = await savePushSubscriptionDal(sub, "A".repeat(600));
    expect(result.isOk()).toBe(true);
    expect(mocks.dbSavePushSubscription).toHaveBeenCalledWith(
      "u1",
      sub,
      "A".repeat(512),
    );
    await savePushSubscriptionDal(sub);
    expect(mocks.dbSavePushSubscription).toHaveBeenLastCalledWith(
      "u1",
      sub,
      null,
    );
  });

  it("reports save failures", async () => {
    mocks.dbSavePushSubscription.mockRejectedValue(new Error("db"));
    expect((await savePushSubscriptionDal(sub))._unsafeUnwrapErr()).toEqual({
      reason: "Failed to save this device",
    });
  });

  it("removes one of the caller's devices", async () => {
    mocks.protect.mockResolvedValueOnce({ userId: null });
    expect(
      (await deletePushSubscriptionDal(sub.endpoint))._unsafeUnwrapErr(),
    ).toEqual({ reason: "Unauthorized" });
    expect((await deletePushSubscriptionDal(""))._unsafeUnwrapErr()).toEqual({
      reason: "Invalid push subscription",
    });
    mocks.dbDeletePushSubscription.mockResolvedValueOnce({ id: 1 });
    expect((await deletePushSubscriptionDal(sub.endpoint)).isOk()).toBe(true);
    expect(mocks.dbDeletePushSubscription).toHaveBeenCalledWith(
      "u1",
      sub.endpoint,
    );
    mocks.dbDeletePushSubscription.mockRejectedValueOnce(new Error("db"));
    expect(
      (await deletePushSubscriptionDal(sub.endpoint))._unsafeUnwrapErr(),
    ).toEqual({ reason: "Failed to remove this device" });
  });
});

describe("sendTestNotificationDal", () => {
  it("requires a user", async () => {
    mocks.protect.mockResolvedValueOnce({ userId: null });
    expect((await sendTestNotificationDal())._unsafeUnwrapErr()).toEqual({
      reason: "Unauthorized",
    });
  });

  it("sends a test to the caller's primary email and devices", async () => {
    mocks.currentUser.mockResolvedValue({
      primaryEmailAddress: { emailAddress: "me@x.test" },
    });
    mocks.deliver.mockResolvedValue({ email: 1, push: 1 });
    expect((await sendTestNotificationDal())._unsafeUnwrap()).toEqual({
      email: 1,
      push: 1,
    });
    expect(mocks.deliver.mock.calls[0][0][0]).toMatchObject({
      recipient: { userId: "u1", email: "me@x.test" },
      category: "shift_alerts",
      message: { title: "Test notification" },
    });
  });

  it("works without an email address and reports failures", async () => {
    mocks.currentUser.mockResolvedValue(null);
    mocks.deliver.mockResolvedValueOnce({ email: 0, push: 1 });
    await sendTestNotificationDal();
    expect(mocks.deliver.mock.calls[0][0][0].recipient.email).toBeNull();

    mocks.deliver.mockRejectedValueOnce(new Error("boom"));
    expect((await sendTestNotificationDal())._unsafeUnwrapErr()).toEqual({
      reason: "Failed to send test notification",
    });
  });
});

describe("setMyTimezoneDal", () => {
  it("requires a user and a real time zone", async () => {
    mocks.protect.mockResolvedValueOnce({ userId: null });
    expect((await setMyTimezoneDal("UTC"))._unsafeUnwrapErr()).toEqual({
      reason: "Unauthorized",
    });
    expect((await setMyTimezoneDal("Mars/Olympus"))._unsafeUnwrapErr()).toEqual(
      { reason: "Invalid time zone" },
    );
    expect(mocks.dbSetUserTimezone).not.toHaveBeenCalled();
  });

  it("saves the caller's zone and reports failures", async () => {
    mocks.dbSetUserTimezone.mockResolvedValueOnce(undefined);
    expect((await setMyTimezoneDal("America/Regina"))._unsafeUnwrap()).toEqual({
      user_id: "u1",
    });
    expect(mocks.dbSetUserTimezone).toHaveBeenCalledWith(
      "u1",
      "America/Regina",
    );
    mocks.dbSetUserTimezone.mockRejectedValueOnce(new Error("db"));
    expect((await setMyTimezoneDal("UTC"))._unsafeUnwrapErr()).toEqual({
      reason: "Failed to save time zone",
    });
  });
});
