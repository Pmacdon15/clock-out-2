import { auth, currentUser } from "@clerk/nextjs/server";
import { err, ok, type Result } from "neverthrow";
import {
  isValidNotificationPreferences,
  isValidPushSubscription,
  normalizeAlertSettings,
  normalizeNotificationPreferences,
  validateAlertSettings,
} from "./alerts";
import {
  dbDeletePushSubscription,
  dbGetAlertSettings,
  dbGetNotificationPreferences,
  dbSavePushSubscription,
  dbUpdateAlertSettings,
  dbUpdateNotificationPreferences,
} from "./alerts-db";
import {
  type DeliveryCounts,
  deliver,
  isEmailConfigured,
  isPushConfigured,
} from "./notify";
import type {
  AlertSettingsData,
  AlertSettingsInput,
  NotificationPreferencesData,
  NotificationPreferencesInput,
  PushSubscriptionInput,
  SerializableResult,
} from "./types";

type Failure = { reason: string };

/** The org's alert rules, with defaults filled in for an org that has none. */
export async function getOrgAlertSettings(): Promise<
  SerializableResult<AlertSettingsData, Failure>
> {
  const { userId, orgId } = await auth.protect();
  if (!userId || !orgId) {
    return {
      ok: false,
      error: { reason: "Unauthorized or no organization selected" },
    };
  }
  return await dbGetAlertSettings(orgId)
    .then((row) => ({
      ok: true as const,
      value: { org_id: orgId, ...normalizeAlertSettings(row) },
    }))
    .catch((e) => {
      console.error("Error fetching alert settings: ", e);
      return {
        ok: false as const,
        error: { reason: "Error fetching alert settings" },
      };
    });
}

export async function updateAlertSettingsDal(
  input: AlertSettingsInput,
): Promise<Result<AlertSettingsData, Failure>> {
  const { userId, orgId, orgRole } = await auth.protect();
  if (!userId || !orgId || orgRole !== "org:admin") {
    return err({ reason: "Unauthorized" });
  }
  const invalid =
    input && typeof input === "object"
      ? validateAlertSettings(input)
      : "Invalid alert settings";
  if (invalid) return err({ reason: invalid });

  return await dbUpdateAlertSettings(orgId, {
    forgot_clock_out_enabled: input.forgot_clock_out_enabled,
    forgot_clock_out_hours: input.forgot_clock_out_hours,
    auto_clock_out_enabled: input.auto_clock_out_enabled,
    auto_clock_out_hours: input.auto_clock_out_hours,
    break_reminder_enabled: input.break_reminder_enabled,
    break_reminder_minutes: input.break_reminder_minutes,
    notify_admins: input.notify_admins,
  })
    .then((row) => ok(row))
    .catch((e) => {
      console.error("Update alert settings error: ", e);
      return err({ reason: "Failed to update alert settings" });
    });
}

/** What the notifications tab needs: my preferences and what's configured. */
export type NotificationSettingsView = {
  preferences: NotificationPreferencesInput;
  emailAvailable: boolean;
  pushAvailable: boolean;
  /** Public VAPID key browsers subscribe with (null when push is off). */
  vapidPublicKey: string | null;
};

export async function getMyNotificationSettings(): Promise<
  SerializableResult<NotificationSettingsView, Failure>
> {
  const { userId } = await auth.protect();
  if (!userId) {
    return { ok: false, error: { reason: "Unauthorized" } };
  }
  return await dbGetNotificationPreferences(userId)
    .then((row) => ({
      ok: true as const,
      value: {
        preferences: normalizeNotificationPreferences(row),
        emailAvailable: isEmailConfigured(),
        pushAvailable: isPushConfigured(),
        vapidPublicKey: isPushConfigured()
          ? (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY as string)
          : null,
      },
    }))
    .catch((e) => {
      console.error("Error fetching notification preferences: ", e);
      return {
        ok: false as const,
        error: { reason: "Error fetching notification preferences" },
      };
    });
}

export async function updateNotificationPreferencesDal(
  input: NotificationPreferencesInput,
): Promise<Result<NotificationPreferencesData, Failure>> {
  const { userId } = await auth.protect();
  if (!userId) return err({ reason: "Unauthorized" });
  if (!isValidNotificationPreferences(input)) {
    return err({ reason: "Invalid notification preferences" });
  }
  return await dbUpdateNotificationPreferences(userId, {
    email_enabled: input.email_enabled,
    push_enabled: input.push_enabled,
    shift_alerts: input.shift_alerts,
    break_alerts: input.break_alerts,
    admin_alerts: input.admin_alerts,
  })
    .then((row) => ok(row))
    .catch((e) => {
      console.error("Update notification preferences error: ", e);
      return err({ reason: "Failed to update notification preferences" });
    });
}

export async function savePushSubscriptionDal(
  subscription: PushSubscriptionInput,
  userAgent?: string | null,
): Promise<Result<true, Failure>> {
  const { userId } = await auth.protect();
  if (!userId) return err({ reason: "Unauthorized" });
  if (!isValidPushSubscription(subscription)) {
    return err({ reason: "Invalid push subscription" });
  }
  const agent = typeof userAgent === "string" ? userAgent.slice(0, 512) : null;
  return await dbSavePushSubscription(userId, subscription, agent)
    .then(() => ok(true as const))
    .catch((e) => {
      console.error("Save push subscription error: ", e);
      return err({ reason: "Failed to save this device" });
    });
}

export async function deletePushSubscriptionDal(
  endpoint: string,
): Promise<Result<true, Failure>> {
  const { userId } = await auth.protect();
  if (!userId) return err({ reason: "Unauthorized" });
  if (typeof endpoint !== "string" || endpoint.length === 0) {
    return err({ reason: "Invalid push subscription" });
  }
  return await dbDeletePushSubscription(userId, endpoint)
    .then(() => ok(true as const))
    .catch((e) => {
      console.error("Delete push subscription error: ", e);
      return err({ reason: "Failed to remove this device" });
    });
}

/**
 * Sends a test alert to the caller over every channel they have switched on,
 * so they (or whoever set up SES/VAPID) can see it arrive.
 */
export async function sendTestNotificationDal(): Promise<
  Result<DeliveryCounts, Failure>
> {
  const { userId } = await auth.protect();
  if (!userId) return err({ reason: "Unauthorized" });
  try {
    const user = await currentUser();
    const email = user?.primaryEmailAddress?.emailAddress ?? null;
    const counts = await deliver([
      {
        recipient: { userId, email },
        category: "shift_alerts",
        message: {
          title: "Test notification",
          body: "Shift alerts are working. You'll be notified like this if you forget to clock out or end a break.",
          url: "/?defaultTab=notifications",
          tag: "test",
        },
      },
    ]);
    return ok(counts);
  } catch (e) {
    console.error("Test notification error: ", e);
    return err({ reason: "Failed to send test notification" });
  }
}
