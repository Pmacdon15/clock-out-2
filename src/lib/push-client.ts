/**
 * Browser-side Web Push helpers. Web Push works in Chrome, Edge, Firefox,
 * desktop Safari, and on iPhone/iPad (iOS 16.4+) once Clock Out has been
 * added to the Home Screen — Safari tabs on iOS can't receive pushes.
 */

export type PushSupport =
  /** Ready to ask for permission. */
  | "supported"
  /** iPhone/iPad in a Safari tab: install to the Home Screen first. */
  | "ios-needs-install"
  /** This browser has no Web Push. */
  | "unsupported";

/** VAPID keys are base64url; the Push API wants raw bytes. */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

export function isStandalone(): boolean {
  return (
    (typeof window.matchMedia === "function" &&
      window.matchMedia("(display-mode: standalone)").matches) ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function isIOS(): boolean {
  return /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase());
}

export function getPushSupport(): PushSupport {
  const hasApis =
    "serviceWorker" in navigator &&
    Boolean(navigator.serviceWorker) &&
    "PushManager" in window &&
    "Notification" in window;
  if (isIOS() && !isStandalone()) return "ios-needs-install";
  return hasApis ? "supported" : "unsupported";
}

export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.ready;
  return await registration.pushManager.getSubscription();
}

/**
 * Asks for permission (must run from a tap) and subscribes this device.
 * Resolves to null when the person declines.
 */
export async function subscribeThisDevice(
  vapidPublicKey: string,
): Promise<PushSubscription | null> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return null;
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  if (existing) return existing;
  return await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
  });
}

/** Serialises a subscription for the server action. */
export function toSubscriptionInput(sub: PushSubscription) {
  const json = sub.toJSON() as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
  return {
    endpoint: json.endpoint ?? sub.endpoint,
    keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
  };
}
