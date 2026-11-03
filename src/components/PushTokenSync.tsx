"use client";

import { use, useEffect } from "react";
import { saveFcmTokenAction } from "@/lib/alert-actions";
import type { NotificationSettingsView } from "@/lib/alerts-dal";
import { isFcmSupported, registerFcm } from "@/lib/fcm-client";
import { getCurrentSubscription, getPushSupport } from "@/lib/push-client";
import type { SerializableResult } from "@/lib/types";

/**
 * Keeps this device's FCM token fresh. On each visit, if push is on for this
 * device, it asks Firebase for the current token (Firebase rotates them) and
 * tells the server, which also marks the device as recently seen. A device
 * still on legacy Web Push is moved to FCM the same way, without a prompt.
 *
 * Push stays off for a device that was turned off: with no subscription
 * there is nothing to refresh, even when permission is still granted.
 */
export default function PushTokenSync({
  settingsPromise,
}: {
  settingsPromise: Promise<
    SerializableResult<NotificationSettingsView, { reason: string }>
  >;
}) {
  const result = use(settingsPromise);
  const firebase = result.ok ? result.value.firebase : null;

  useEffect(() => {
    if (!firebase || getPushSupport() !== "supported") return;
    let cancelled = false;
    (async () => {
      if (Notification.permission !== "granted") return;
      if (!(await getCurrentSubscription())) return;
      if (!(await isFcmSupported())) return;
      const registration = await registerFcm(firebase, {
        requestPermission: false,
      });
      if (!registration || cancelled) return;
      await saveFcmTokenAction(registration, navigator.userAgent);
    })().catch((error) => {
      console.error("Push token refresh failed:", error);
    });
    return () => {
      cancelled = true;
    };
  }, [firebase]);

  return null;
}
