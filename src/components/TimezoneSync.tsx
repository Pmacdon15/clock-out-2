"use client";

import { use, useEffect } from "react";
import { setMyTimezoneAction } from "@/lib/alert-actions";
import type { NotificationSettingsView } from "@/lib/alerts-dal";
import type { SerializableResult } from "@/lib/types";

/**
 * Quietly remembers this person's browser time zone, so schedule
 * notifications (sent from the server, in UTC) can say "9:00 AM" in their
 * local time. Saves only when the zone is new or has changed.
 */
export default function TimezoneSync({
  settingsPromise,
}: {
  settingsPromise: Promise<
    SerializableResult<NotificationSettingsView, { reason: string }>
  >;
}) {
  const result = use(settingsPromise);
  const stored = result.ok ? result.value.timezone : undefined;

  useEffect(() => {
    if (stored === undefined) return;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz || tz === stored) return;
    setMyTimezoneAction(tz).catch(() => {});
  }, [stored]);

  return null;
}
