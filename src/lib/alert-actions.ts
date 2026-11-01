"use server";

import { updateTag } from "next/cache";
import {
  deletePushSubscriptionDal,
  savePushSubscriptionDal,
  sendTestNotificationDal,
  updateAlertSettingsDal,
  updateNotificationPreferencesDal,
} from "./alerts-dal";
import type {
  AlertSettingsInput,
  NotificationPreferencesInput,
  PushSubscriptionInput,
} from "./types";

export async function updateAlertSettingsAction(input: AlertSettingsInput) {
  const result = await updateAlertSettingsDal(input);
  return result.match(
    (row) => {
      updateTag(`alert-settings-${row.org_id}`);
      return { success: true as const, data: row };
    },
    (e) => ({ success: false as const, error: e.reason }),
  );
}

export async function updateNotificationPreferencesAction(
  input: NotificationPreferencesInput,
) {
  const result = await updateNotificationPreferencesDal(input);
  return result.match(
    (row) => {
      updateTag(`notification-prefs-${row.user_id}`);
      return { success: true as const, data: row };
    },
    (e) => ({ success: false as const, error: e.reason }),
  );
}

export async function savePushSubscriptionAction(
  subscription: PushSubscriptionInput,
  userAgent?: string | null,
) {
  const result = await savePushSubscriptionDal(subscription, userAgent);
  return result.match(
    () => ({ success: true as const }),
    (e) => ({ success: false as const, error: e.reason }),
  );
}

export async function deletePushSubscriptionAction(endpoint: string) {
  const result = await deletePushSubscriptionDal(endpoint);
  return result.match(
    () => ({ success: true as const }),
    (e) => ({ success: false as const, error: e.reason }),
  );
}

export async function sendTestNotificationAction() {
  const result = await sendTestNotificationDal();
  return result.match(
    (counts) => ({ success: true as const, data: counts }),
    (e) => ({ success: false as const, error: e.reason }),
  );
}
