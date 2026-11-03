"use server";

import { updateTag } from "next/cache";
import { queueShiftAlertSync } from "./alert-jobs";
import {
  deletePushSubscriptionDal,
  saveFcmTokenDal,
  savePushSubscriptionDal,
  sendTestNotificationDal,
  setMyTimezoneDal,
  updateAlertSettingsDal,
  updateNotificationPreferencesDal,
} from "./alerts-dal";
import type {
  AlertSettingsInput,
  FcmTokenInput,
  NotificationPreferencesInput,
  PushSubscriptionInput,
} from "./types";

export async function updateAlertSettingsAction(input: AlertSettingsInput) {
  const result = await updateAlertSettingsDal(input);
  return result.match(
    (row) => {
      updateTag(`alert-settings-${row.org_id}`);
      // New thresholds move (or cancel) the org's next alert.
      queueShiftAlertSync(row.org_id);
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

export async function saveFcmTokenAction(
  input: FcmTokenInput,
  userAgent?: string | null,
) {
  const result = await saveFcmTokenDal(input, userAgent);
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

export async function setMyTimezoneAction(timezone: string) {
  const result = await setMyTimezoneDal(timezone);
  return result.match(
    (row) => {
      updateTag(`notification-prefs-${row.user_id}`);
      return { success: true as const };
    },
    (e) => ({ success: false as const, error: e.reason }),
  );
}
