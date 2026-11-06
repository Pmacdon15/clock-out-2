import { clerkClient } from "@clerk/nextjs/server";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import {
  isValidTimeZone,
  normalizeNotificationPreferences,
} from "@/lib/alerts";
import {
  dbGetNotificationPreferences,
  dbSetUserTimezone,
  dbUpdateNotificationPreferences,
} from "@/lib/alerts-db";
import { deliver, isEmailConfigured, isPushConfigured } from "@/lib/notify";
import type { NotificationPreferencesInput } from "@/lib/types";
import type { McpCaller, ToolResult } from "@/mcp/tools";

/*
 * The caller's own notification settings: the same switches as the app's
 * Notifications page. They are personal (shared across organizations), so
 * nobody, admins included, can change someone else's.
 */

const PREF_FIELDS = [
  "email_enabled",
  "push_enabled",
  "shift_alerts",
  "break_alerts",
  "admin_alerts",
  "schedule_alerts",
] as const satisfies readonly (keyof NotificationPreferencesInput)[];

export const manageNotificationPreferencesInputSchema = z.object({
  action: z
    .enum(["get", "update", "send_test"])
    .optional()
    .describe(
      "'get' (default) shows your notification settings; 'update' changes them (only the fields you pass); 'send_test' sends you a test notification on every channel you have on.",
    ),
  email_enabled: z.boolean().optional().describe("Get alerts by email."),
  push_enabled: z
    .boolean()
    .optional()
    .describe(
      "Get alerts as push notifications on devices where you turned them on in the Clock Out app (a device can only be added from the app itself).",
    ),
  shift_alerts: z
    .boolean()
    .optional()
    .describe("Forgot-to-clock-out reminders and automatic clock-out notices."),
  break_alerts: z.boolean().optional().describe("Still-on-break reminders."),
  admin_alerts: z
    .boolean()
    .optional()
    .describe("Admins: alerts about other members of your organization."),
  schedule_alerts: z
    .boolean()
    .optional()
    .describe(
      "Your weekly schedule, reminders before shifts, and shifts added, changed or cancelled.",
    ),
  timezone: z
    .string()
    .optional()
    .describe(
      "Your IANA timezone (e.g. 'America/Edmonton'), used to word times in your alerts.",
    ),
});

export async function manageNotificationPreferencesTool(
  caller: McpCaller,
  input: z.infer<typeof manageNotificationPreferencesInputSchema>,
): Promise<ToolResult> {
  const action = input.action ?? "get";
  const row = await dbGetNotificationPreferences(caller.userId);
  const current = normalizeNotificationPreferences(row);
  const channels = {
    email_available: isEmailConfigured(),
    push_available: isPushConfigured(),
  };

  if (action === "send_test") {
    const client = await clerkClient();
    const user = await client.users.getUser(caller.userId);
    const counts = await deliver([
      {
        recipient: {
          userId: caller.userId,
          email: user.primaryEmailAddress?.emailAddress ?? null,
        },
        category: "shift_alerts",
        message: {
          title: "Test notification",
          body: "Shift alerts are working. You'll be notified like this if you forget to clock out or end a break.",
          url: "/notifications",
          tag: "test",
        },
      },
    ]);
    const sent = counts.email + counts.push;
    return {
      summary:
        sent > 0
          ? `Sent a test notification (${counts.email} email, ${counts.push} push).`
          : "No test notification was sent: turn on email or push (and shift alerts), or add a device for push in the Clock Out app.",
      data: { status: sent > 0 ? "sent" : "nothing_sent", ...counts },
    };
  }

  if (action === "get") {
    return {
      summary: `Your notifications: email ${current.email_enabled ? "on" : "off"}, push ${current.push_enabled ? "on" : "off"}; ${
        PREF_FIELDS.slice(2)
          .filter((f) => current[f])
          .join(", ") || "no alert types"
      } on.`,
      data: {
        preferences: current,
        timezone: row?.timezone ?? null,
        ...channels,
      },
    };
  }

  const changesPrefs = PREF_FIELDS.some((f) => input[f] !== undefined);
  if (!changesPrefs && input.timezone === undefined) {
    return {
      summary: `Nothing to update. Pass any of: ${PREF_FIELDS.join(", ")}, timezone.`,
      data: { status: "invalid_input" },
      isError: true,
    };
  }
  if (input.timezone !== undefined && !isValidTimeZone(input.timezone)) {
    return {
      summary: `"${input.timezone}" isn't a valid IANA timezone.`,
      data: { status: "invalid_input" },
      isError: true,
    };
  }

  let next = current;
  if (changesPrefs) {
    next = { ...current };
    for (const field of PREF_FIELDS) {
      const value = input[field];
      if (value !== undefined) next[field] = value;
    }
    next = normalizeNotificationPreferences(
      await dbUpdateNotificationPreferences(caller.userId, next),
    );
  }
  if (input.timezone !== undefined) {
    await dbSetUserTimezone(caller.userId, input.timezone);
  }
  try {
    revalidateTag(`notification-prefs-${caller.userId}`, { expire: 0 });
  } catch (error) {
    console.warn("Cache invalidation warning:", error);
  }
  return {
    summary: "Updated your notification settings.",
    data: {
      status: "updated",
      preferences: next,
      timezone: input.timezone ?? row?.timezone ?? null,
      ...channels,
    },
  };
}
