import type { Metadata } from "next";
import { Suspense } from "react";
import { SettingsFallback } from "@/components/fallbacks/settings-fallback";
import NotificationSettings from "@/components/NotificationSettings";
import { getMyNotificationSettings } from "@/lib/alerts-dal";
import { NOTIFICATIONS_FEATURE } from "@/lib/billing";
import { hasFeature, isAdmin } from "@/lib/session";

export const metadata: Metadata = { title: "Notifications | Clock Out" };

export default function NotificationsPage() {
  return (
    <>
      <h2 className="sr-only">Notifications</h2>
      <Suspense fallback={<SettingsFallback />}>
        {Promise.all([hasFeature(NOTIFICATIONS_FEATURE), isAdmin()]).then(
          ([hasNotifications, admin]) => (
            <NotificationSettings
              hasNotifications={hasNotifications}
              isAdmin={admin}
              settingsPromise={getMyNotificationSettings()}
            />
          ),
        )}
      </Suspense>
    </>
  );
}
