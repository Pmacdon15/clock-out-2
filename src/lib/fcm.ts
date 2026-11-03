import { createSign } from "node:crypto";

/**
 * Firebase Cloud Messaging over the HTTP v1 API, signed with the project's
 * service account. No Firebase Admin SDK: one OAuth token exchange and one
 * POST per device is all sending needs, and it keeps the server bundle (and
 * its dependency audit) small.
 *
 * `FIREBASE_SERVICE_ACCOUNT` holds the service account key file's JSON (as
 * downloaded from the Firebase console). Base64 of that JSON also works, for
 * hosts that mangle multi-line values.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

export type ServiceAccount = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

/** The parsed service account, or null when it is missing or unusable. */
export function readServiceAccount(
  raw: string | undefined = process.env.FIREBASE_SERVICE_ACCOUNT,
): ServiceAccount | null {
  if (!raw) return null;
  const text = raw.trim().startsWith("{")
    ? raw
    : Buffer.from(raw, "base64").toString("utf8");
  try {
    const json = JSON.parse(text) as {
      project_id?: unknown;
      client_email?: unknown;
      private_key?: unknown;
    };
    const { project_id, client_email, private_key } = json;
    if (
      typeof project_id !== "string" ||
      typeof client_email !== "string" ||
      typeof private_key !== "string" ||
      !project_id ||
      !client_email ||
      !private_key
    ) {
      return null;
    }
    return {
      projectId: project_id,
      clientEmail: client_email,
      // Env editors often store the key's newlines as literal "\n".
      privateKey: private_key.replace(/\\n/g, "\n"),
    };
  } catch {
    return null;
  }
}

export function isFcmConfigured(): boolean {
  return readServiceAccount() !== null;
}

const base64url = (value: string | Buffer) =>
  Buffer.from(value).toString("base64url");

/** A signed JWT the token endpoint swaps for an access token. */
export function buildAssertion(account: ServiceAccount, nowSeconds: number) {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: account.clientEmail,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    }),
  );
  const unsigned = `${header}.${claims}`;
  const signature = createSign("RSA-SHA256")
    .update(unsigned)
    .sign(account.privateKey);
  return `${unsigned}.${base64url(signature)}`;
}

let cachedToken: { value: string; expiresAt: number; email: string } | null =
  null;

/** Test-only: forget the cached access token. */
export function resetFcmAccessToken() {
  cachedToken = null;
}

/** An OAuth access token for FCM, reused until a minute before it expires. */
export async function getFcmAccessToken(
  account: ServiceAccount,
): Promise<string> {
  const now = Date.now();
  if (
    cachedToken &&
    cachedToken.email === account.clientEmail &&
    cachedToken.expiresAt - 60_000 > now
  ) {
    return cachedToken.value;
  }
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: buildAssertion(account, Math.floor(now / 1000)),
    }),
  });
  if (!response.ok) {
    throw new Error(
      `FCM auth failed (${response.status}): ${await response.text()}`,
    );
  }
  const json = (await response.json()) as {
    access_token: string;
    expires_in?: number;
  };
  cachedToken = {
    value: json.access_token,
    expiresAt: now + (json.expires_in ?? 3600) * 1000,
    email: account.clientEmail,
  };
  return json.access_token;
}

/** What a web device shows: the service worker turns this into a notification. */
export type FcmWebPayload = Record<string, string>;

/**
 * - `sent`: FCM accepted it.
 * - `invalid`: the token is gone or wrong (app removed, permission revoked,
 *   another project's token) and should be forgotten.
 * - `failed`: anything else (FCM outage, quota); keep the token.
 */
export type FcmSendResult = "sent" | "invalid" | "failed";

type FcmErrorBody = {
  error?: {
    status?: string;
    details?: { "@type"?: string; errorCode?: string }[];
  };
};

/** Whether an FCM error means the token itself is dead. */
export function isInvalidTokenError(status: number, body: FcmErrorBody) {
  const codes = [
    body.error?.status,
    ...(body.error?.details ?? []).map((d) => d.errorCode),
  ];
  if (status === 404 || codes.includes("UNREGISTERED")) return true;
  if (codes.includes("SENDER_ID_MISMATCH")) return true;
  // Our payload is fixed, so a 400 INVALID_ARGUMENT is the token's fault.
  return status === 400 && codes.includes("INVALID_ARGUMENT");
}

/**
 * Sends one data message to one web device. Data-only (no `notification`
 * block) so the app's own service worker draws it the same way on every
 * browser; `Urgency: high` asks the push service to deliver it right away,
 * even to a phone in Doze.
 */
export async function sendFcmMessage(
  account: ServiceAccount,
  token: string,
  data: FcmWebPayload,
  ttlSeconds: number,
): Promise<FcmSendResult> {
  try {
    const accessToken = await getFcmAccessToken(account);
    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.projectId)}/messages:send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token,
            data,
            webpush: {
              headers: { Urgency: "high", TTL: String(ttlSeconds) },
            },
          },
        }),
      },
    );
    if (response.ok) return "sent";
    const body = (await response.json().catch(() => ({}))) as FcmErrorBody;
    if (response.status === 401) resetFcmAccessToken();
    if (isInvalidTokenError(response.status, body)) return "invalid";
    console.error(
      `[FCM] Send failed (${response.status}):`,
      JSON.stringify(body),
    );
    return "failed";
  } catch (error) {
    console.error("[FCM] Send failed:", error);
    return "failed";
  }
}

/** What the browser needs to register with FCM. All of it is public. */
export type FirebaseClientConfig = {
  apiKey: string;
  projectId: string;
  messagingSenderId: string;
  appId: string;
  /** The Web Push certificate (VAPID public key) of the Firebase project. */
  vapidKey: string;
};

/**
 * The browser config, or null unless the server can also send (no point
 * registering devices nothing can reach). The VAPID key defaults to the
 * legacy Web Push key, which is the smooth path: import that key pair under
 * Cloud Messaging → Web Push certificates in the Firebase console, and
 * existing devices move to FCM without re-subscribing.
 */
export function firebaseClientConfig(): FirebaseClientConfig | null {
  const env = process.env;
  const apiKey = env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const projectId = env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const messagingSenderId = env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID;
  const appId = env.NEXT_PUBLIC_FIREBASE_APP_ID;
  const vapidKey =
    env.NEXT_PUBLIC_FIREBASE_VAPID_KEY || env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (
    !apiKey ||
    !projectId ||
    !messagingSenderId ||
    !appId ||
    !vapidKey ||
    !isFcmConfigured()
  ) {
    return null;
  }
  return { apiKey, projectId, messagingSenderId, appId, vapidKey };
}
