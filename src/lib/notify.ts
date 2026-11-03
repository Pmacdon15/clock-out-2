import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { render } from "@react-email/render";
import webpush from "web-push";
import { ShiftAlertEmail } from "@/components/emails/ShiftAlertEmail";
import {
  type AlertCategory,
  type NotificationMessage,
  normalizeNotificationPreferences,
} from "./alerts";
import {
  dbDeleteExpiredPushSubscription,
  dbDeleteFcmTokens,
  dbGetFcmTokensFor,
  dbGetNotificationPreferencesFor,
  dbGetPushSubscriptionsFor,
} from "./alerts-db";
import { isFcmConfigured, readServiceAccount, sendFcmMessage } from "./fcm";
import type { FcmTokenRow, PushSubscriptionRow } from "./types";

const sesClient = new SESClient({
  region: process.env.AWS_REGION || "us-east-1",
});

export const DEFAULT_APP_URL = "https://clockout.patmac.ca";

/** Public origin of the app, without a trailing slash. */
export function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || DEFAULT_APP_URL).replace(
    /\/+$/,
    "",
  );
}

/** Small monochrome icon Android shows in the status bar. */
export const NOTIFICATION_BADGE = "/notification-badge.png";
/** The "avatar" shown beside the notification text. */
export const NOTIFICATION_ICON = "/icon-192.png";

export function isEmailConfigured(): boolean {
  return Boolean(
    process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY,
  );
}

/** Legacy Web Push (VAPID) devices can be reached. */
export function isWebPushConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY,
  );
}

/** Some push channel (FCM or legacy Web Push) can be used. */
export function isPushConfigured(): boolean {
  return isFcmConfigured() || isWebPushConfigured();
}

/** How long a push service keeps an undelivered alert (12 hours). */
const PUSH_TTL_SECONDS = 60 * 60 * 12;

/** The JSON the service worker reads to draw a notification. */
function pushPayload(message: NotificationMessage) {
  return {
    title: message.title,
    body: message.body,
    url: message.url,
    tag: message.tag,
    icon: NOTIFICATION_ICON,
    badge: NOTIFICATION_BADGE,
  };
}

let vapidKey: string | null = null;

/** Applies the VAPID keys once per key (cheap to call before every send). */
function configureVapid() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY as string;
  if (vapidKey === publicKey) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || appUrl(),
    publicKey,
    process.env.VAPID_PRIVATE_KEY as string,
  );
  vapidKey = publicKey;
}

/** Test-only: forget the applied VAPID keys. */
export function resetVapidConfig() {
  vapidKey = null;
}

export async function sendAlertEmail(
  to: string,
  message: NotificationMessage,
): Promise<boolean> {
  if (!isEmailConfigured()) return false;
  try {
    const origin = appUrl();
    const html = await render(
      ShiftAlertEmail({
        title: message.title,
        body: message.body,
        actionUrl: `${origin}${message.url}`,
        appUrl: origin,
        lines: message.lines,
      }),
    );
    await sesClient.send(
      new SendEmailCommand({
        Destination: { ToAddresses: [to] },
        Message: {
          Body: {
            Html: { Charset: "UTF-8", Data: html },
            Text: {
              Charset: "UTF-8",
              Data: [
                message.body,
                ...(message.lines ?? []),
                "",
                `${origin}${message.url}`,
              ].join("\n"),
            },
          },
          Subject: { Charset: "UTF-8", Data: message.title },
        },
        Source:
          process.env.SES_FROM_EMAIL ||
          "Clock Out <no-reply@clockout.patmac.ca>",
      }),
    );
    return true;
  } catch (error) {
    console.error("[Notify] Failed to send alert email:", error);
    return false;
  }
}

/**
 * Pushes one message to each device. A device the push service reports as
 * gone (404/410 — app removed, permission revoked) is forgotten, so it is not
 * retried forever. Returns how many devices accepted the message.
 */
export async function sendAlertPush(
  subscriptions: PushSubscriptionRow[],
  message: NotificationMessage,
): Promise<number> {
  if (!isWebPushConfigured() || subscriptions.length === 0) return 0;
  configureVapid();
  const payload = JSON.stringify(pushPayload(message));
  const results = await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payload,
          { TTL: PUSH_TTL_SECONDS, urgency: "high" },
        );
        return 1;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await dbDeleteExpiredPushSubscription(sub.endpoint).catch((e) => {
            console.error("[Notify] Failed to drop expired device:", e);
          });
        } else {
          console.error("[Notify] Push failed:", error);
        }
        return 0;
      }
    }),
  );
  return results.reduce<number>((sum, n) => sum + n, 0);
}

/**
 * Sends one message to each FCM device. Tokens FCM reports as unregistered or
 * invalid are forgotten. Returns how many devices accepted the message.
 */
export async function sendFcmPush(
  tokens: FcmTokenRow[],
  message: NotificationMessage,
): Promise<number> {
  const account = readServiceAccount();
  if (!account || tokens.length === 0) return 0;
  const data = pushPayload(message);
  const results = await Promise.all(
    tokens.map((row) =>
      sendFcmMessage(account, row.token, data, PUSH_TTL_SECONDS),
    ),
  );
  const invalid = tokens
    .filter((_, i) => results[i] === "invalid")
    .map((row) => row.token);
  if (invalid.length > 0) {
    await dbDeleteFcmTokens(invalid).catch((e) => {
      console.error("[Notify] Failed to drop invalid FCM tokens:", e);
    });
  }
  return results.filter((r) => r === "sent").length;
}

export type Recipient = {
  userId: string;
  email: string | null;
};

export type Delivery = {
  recipient: Recipient;
  category: AlertCategory;
  message: NotificationMessage;
};

export type DeliveryCounts = { email: number; push: number };

/**
 * Sends each delivery over the channels its recipient has switched on, if
 * they want that category at all. Preferences and devices are loaded once
 * for everyone.
 */
export async function deliver(deliveries: Delivery[]): Promise<DeliveryCounts> {
  const counts: DeliveryCounts = { email: 0, push: 0 };
  if (deliveries.length === 0) return counts;

  const userIds = [...new Set(deliveries.map((d) => d.recipient.userId))];
  const [prefRows, subscriptions, fcmTokens] = await Promise.all([
    dbGetNotificationPreferencesFor(userIds),
    isWebPushConfigured()
      ? dbGetPushSubscriptionsFor(userIds)
      : Promise.resolve([] as PushSubscriptionRow[]),
    isFcmConfigured()
      ? dbGetFcmTokensFor(userIds)
      : Promise.resolve([] as FcmTokenRow[]),
  ]);
  const prefsByUser = new Map(prefRows.map((row) => [row.user_id, row]));

  for (const { recipient, category, message } of deliveries) {
    const prefs = normalizeNotificationPreferences(
      prefsByUser.get(recipient.userId),
    );
    if (!prefs[category]) continue;

    const tasks: Promise<void>[] = [];
    if (prefs.email_enabled && recipient.email) {
      tasks.push(
        sendAlertEmail(recipient.email, message).then((sent) => {
          if (sent) counts.email += 1;
        }),
      );
    }
    if (prefs.push_enabled) {
      const devices = subscriptions.filter(
        (sub) => sub.user_id === recipient.userId,
      );
      const tokens = fcmTokens.filter(
        (row) => row.user_id === recipient.userId,
      );
      tasks.push(
        sendAlertPush(devices, message).then((sent) => {
          counts.push += sent;
        }),
        sendFcmPush(tokens, message).then((sent) => {
          counts.push += sent;
        }),
      );
    }
    await Promise.all(tasks);
  }

  return counts;
}
