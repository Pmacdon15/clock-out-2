/**
 * Browser-side Firebase Cloud Messaging. The Firebase SDK is loaded only
 * when a device is being registered, so it never weighs on the dashboard.
 *
 * Notifications are still drawn by the app's own service worker (`/sw.js`):
 * FCM is only the delivery pipe, so there is no `firebase-messaging-sw.js`.
 */
import type { FirebaseClientConfig } from "./fcm";
import { urlBase64ToUint8Array } from "./push-client";

const APP_NAME = "clock-out";

/** Whether this browser can use FCM (needs IndexedDB, Push and SW APIs). */
export async function isFcmSupported(): Promise<boolean> {
  try {
    const { isSupported } = await import("@firebase/messaging");
    return await isSupported();
  } catch {
    return false;
  }
}

async function messagingFor(config: FirebaseClientConfig) {
  const [{ getApps, initializeApp }, { getMessaging }] = await Promise.all([
    import("@firebase/app"),
    import("@firebase/messaging"),
  ]);
  const app =
    getApps().find((a) => a.name === APP_NAME) ??
    initializeApp(
      {
        apiKey: config.apiKey,
        projectId: config.projectId,
        messagingSenderId: config.messagingSenderId,
        appId: config.appId,
      },
      APP_NAME,
    );
  return getMessaging(app);
}

/** Whether a push subscription was made with this VAPID public key. */
export function usesKey(sub: PushSubscription, vapidKey: string): boolean {
  const current = sub.options?.applicationServerKey;
  if (!current) return false;
  const a = new Uint8Array(current);
  const b = urlBase64ToUint8Array(vapidKey);
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

export type FcmRegistration = {
  token: string;
  /** The browser push subscription FCM delivers through. */
  endpoint: string | null;
  /** A subscription made with another key (legacy Web Push) we replaced. */
  replacedEndpoint: string | null;
};

/**
 * Registers this device with FCM and returns its token. With
 * `requestPermission` it asks first (must run from a tap); without, it only
 * proceeds when permission was already granted. Resolves to null when the
 * person declines.
 *
 * Firebase reuses whatever subscription the service worker already has, so a
 * legacy Web Push subscription made with a different key is dropped first;
 * with the same key (imported into Firebase) it is simply reused.
 */
export async function registerFcm(
  config: FirebaseClientConfig,
  { requestPermission }: { requestPermission: boolean },
): Promise<FcmRegistration | null> {
  const permission = requestPermission
    ? await Notification.requestPermission()
    : Notification.permission;
  if (permission !== "granted") return null;

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  let replacedEndpoint: string | null = null;
  if (existing && !usesKey(existing, config.vapidKey)) {
    replacedEndpoint = existing.endpoint;
    await existing.unsubscribe();
  }

  const { getToken } = await import("@firebase/messaging");
  const token = await getToken(await messagingFor(config), {
    vapidKey: config.vapidKey,
    serviceWorkerRegistration: registration,
  });
  const subscription = await registration.pushManager.getSubscription();
  return {
    token,
    endpoint: subscription?.endpoint ?? null,
    replacedEndpoint,
  };
}

/** Forgets this device's FCM registration (best effort). */
export async function unregisterFcm(config: FirebaseClientConfig) {
  try {
    const { deleteToken } = await import("@firebase/messaging");
    await deleteToken(await messagingFor(config));
  } catch (error) {
    console.error("FCM unregister failed:", error);
  }
}
