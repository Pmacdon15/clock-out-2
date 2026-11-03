// @vitest-environment node
import { createVerify, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAssertion,
  firebaseClientConfig,
  getFcmAccessToken,
  isFcmConfigured,
  isInvalidTokenError,
  readServiceAccount,
  resetFcmAccessToken,
  type ServiceAccount,
  sendFcmMessage,
} from "@/lib/fcm";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const json = {
  type: "service_account",
  project_id: "clock-out-test",
  client_email: "fcm@clock-out-test.iam.gserviceaccount.com",
  private_key: privateKey,
};
const account: ServiceAccount = {
  projectId: json.project_id,
  clientEmail: json.client_email,
  privateKey,
};

const fetchMock = vi.fn();
const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => {
  resetFcmAccessToken();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("readServiceAccount", () => {
  it("reads the key file's JSON, raw or base64", () => {
    expect(readServiceAccount(JSON.stringify(json))).toEqual(account);
    expect(
      readServiceAccount(Buffer.from(JSON.stringify(json)).toString("base64")),
    ).toEqual(account);
  });

  it("restores newlines stored as \\n", () => {
    const flat = JSON.stringify({
      ...json,
      private_key: privateKey.replace(/\n/g, "\\n"),
    });
    expect(readServiceAccount(flat)?.privateKey).toBe(privateKey);
  });

  it("is null when missing, malformed or incomplete", () => {
    expect(readServiceAccount(undefined)).toBeNull();
    expect(readServiceAccount("")).toBeNull();
    expect(readServiceAccount("{not json")).toBeNull();
    expect(
      readServiceAccount(JSON.stringify({ ...json, client_email: "" })),
    ).toBeNull();
    expect(
      readServiceAccount(JSON.stringify({ ...json, project_id: 3 })),
    ).toBeNull();
  });

  it("reads FIREBASE_SERVICE_ACCOUNT by default", () => {
    expect(isFcmConfigured()).toBe(false);
    vi.stubEnv("FIREBASE_SERVICE_ACCOUNT", JSON.stringify(json));
    expect(isFcmConfigured()).toBe(true);
  });
});

describe("buildAssertion", () => {
  it("is an RS256 JWT for the FCM scope, valid for an hour", () => {
    const jwt = buildAssertion(account, 1_000);
    const [header, claims, signature] = jwt.split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({
      alg: "RS256",
      typ: "JWT",
    });
    expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toEqual({
      iss: account.clientEmail,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: 1_000,
      exp: 4_600,
    });
    const verified = createVerify("RSA-SHA256")
      .update(`${header}.${claims}`)
      .verify(publicKey, Buffer.from(signature, "base64url"));
    expect(verified).toBe(true);
  });
});

describe("getFcmAccessToken", () => {
  it("exchanges the assertion and caches the token until near expiry", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { access_token: "at-1", expires_in: 3600 }),
    );
    await expect(getFcmAccessToken(account)).resolves.toBe("at-1");
    await expect(getFcmAccessToken(account)).resolves.toBe("at-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    const body = new URLSearchParams(init.body.toString());
    expect(body.get("grant_type")).toBe(
      "urn:ietf:params:oauth:grant-type:jwt-bearer",
    );
    expect(body.get("assertion")?.split(".")).toHaveLength(3);
  });

  it("fetches a new token for another account, or once it expires", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "at-1" }))
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "at-2" }))
      .mockResolvedValueOnce(
        jsonResponse(200, { access_token: "at-3", expires_in: 30 }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "at-4" }));
    await expect(getFcmAccessToken(account)).resolves.toBe("at-1");
    await expect(
      getFcmAccessToken({ ...account, clientEmail: "other@x" }),
    ).resolves.toBe("at-2");
    // Expires within the minute of slack: not reused.
    await expect(getFcmAccessToken(account)).resolves.toBe("at-3");
    await expect(getFcmAccessToken(account)).resolves.toBe("at-4");
  });

  it("throws when Google refuses", async () => {
    fetchMock.mockResolvedValue(new Response("bad key", { status: 400 }));
    await expect(getFcmAccessToken(account)).rejects.toThrow(
      "FCM auth failed (400): bad key",
    );
  });
});

describe("isInvalidTokenError", () => {
  const fcmError = (errorCode: string, status = "INVALID_ARGUMENT") => ({
    error: {
      status,
      details: [
        {
          "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError",
          errorCode,
        },
      ],
    },
  });

  it("treats gone, foreign and malformed tokens as invalid", () => {
    expect(isInvalidTokenError(404, {})).toBe(true);
    expect(
      isInvalidTokenError(404, fcmError("UNREGISTERED", "NOT_FOUND")),
    ).toBe(true);
    expect(isInvalidTokenError(403, fcmError("SENDER_ID_MISMATCH"))).toBe(true);
    expect(isInvalidTokenError(400, fcmError("INVALID_ARGUMENT"))).toBe(true);
  });

  it("keeps the token for outages and quota errors", () => {
    expect(
      isInvalidTokenError(503, fcmError("UNAVAILABLE", "UNAVAILABLE")),
    ).toBe(false);
    expect(isInvalidTokenError(429, fcmError("QUOTA_EXCEEDED"))).toBe(false);
    expect(isInvalidTokenError(400, {})).toBe(false);
  });
});

describe("sendFcmMessage", () => {
  const data = { title: "Hi", body: "There" };

  it("posts a high-urgency data message to the token", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "at" }))
      .mockResolvedValueOnce(jsonResponse(200, { name: "m/1" }));
    await expect(sendFcmMessage(account, "tok", data, 600)).resolves.toBe(
      "sent",
    );
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe(
      "https://fcm.googleapis.com/v1/projects/clock-out-test/messages:send",
    );
    expect(init.headers.Authorization).toBe("Bearer at");
    expect(JSON.parse(init.body)).toEqual({
      message: {
        token: "tok",
        data,
        webpush: { headers: { Urgency: "high", TTL: "600" } },
      },
    });
  });

  it("reports dead tokens as invalid", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "at" }))
      .mockResolvedValueOnce(
        jsonResponse(404, { error: { status: "NOT_FOUND" } }),
      );
    await expect(sendFcmMessage(account, "tok", data, 600)).resolves.toBe(
      "invalid",
    );
  });

  it("forgets the access token on a 401 and reports a failure", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "at" }))
      .mockResolvedValueOnce(new Response("not json", { status: 401 }))
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "at-2" }))
      .mockResolvedValueOnce(jsonResponse(200, {}));
    await expect(sendFcmMessage(account, "tok", data, 600)).resolves.toBe(
      "failed",
    );
    await sendFcmMessage(account, "tok", data, 600);
    expect(fetchMock.mock.calls[3][1].headers.Authorization).toBe(
      "Bearer at-2",
    );
  });

  it("reports network and auth errors as failures", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    await expect(sendFcmMessage(account, "tok", data, 600)).resolves.toBe(
      "failed",
    );
  });
});

describe("firebaseClientConfig", () => {
  const stubClient = () => {
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_API_KEY", "key");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID", "clock-out-test");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID", "123");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_APP_ID", "1:123:web:abc");
  };

  it("is null until the browser config and the service account are set", () => {
    expect(firebaseClientConfig()).toBeNull();
    stubClient();
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_VAPID_KEY", "fb-vapid");
    expect(firebaseClientConfig()).toBeNull();
    vi.stubEnv("FIREBASE_SERVICE_ACCOUNT", JSON.stringify(json));
    expect(firebaseClientConfig()).toEqual({
      apiKey: "key",
      projectId: "clock-out-test",
      messagingSenderId: "123",
      appId: "1:123:web:abc",
      vapidKey: "fb-vapid",
    });
  });

  it("falls back to the Web Push key, and needs one of them", () => {
    stubClient();
    vi.stubEnv("FIREBASE_SERVICE_ACCOUNT", JSON.stringify(json));
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_VAPID_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "");
    expect(firebaseClientConfig()).toBeNull();
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "legacy-vapid");
    expect(firebaseClientConfig()?.vapidKey).toBe("legacy-vapid");
  });
});
