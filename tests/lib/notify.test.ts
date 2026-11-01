// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  render: vi.fn(),
  setVapidDetails: vi.fn(),
  sendNotification: vi.fn(),
  dbDeleteExpiredPushSubscription: vi.fn(),
  dbGetNotificationPreferencesFor: vi.fn(),
  dbGetPushSubscriptionsFor: vi.fn(),
}));

vi.mock("@aws-sdk/client-ses", () => ({
  SESClient: class {
    send = mocks.send;
  },
  SendEmailCommand: class {
    constructor(public input: unknown) {}
  },
}));
vi.mock("@react-email/render", () => ({ render: mocks.render }));
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: mocks.setVapidDetails,
    sendNotification: mocks.sendNotification,
  },
}));
vi.mock("@/lib/alerts-db", () => ({
  dbDeleteExpiredPushSubscription: mocks.dbDeleteExpiredPushSubscription,
  dbGetNotificationPreferencesFor: mocks.dbGetNotificationPreferencesFor,
  dbGetPushSubscriptionsFor: mocks.dbGetPushSubscriptionsFor,
}));

import {
  appUrl,
  DEFAULT_APP_URL,
  deliver,
  isEmailConfigured,
  isPushConfigured,
  resetVapidConfig,
  sendAlertEmail,
  sendAlertPush,
} from "@/lib/notify";

const message = {
  title: "Still clocked in?",
  body: "You've been clocked in for 10h.",
  url: "/?defaultTab=time-clock",
  tag: "forgot:1",
};

const device = (id: number, userId = "u1") => ({
  id,
  user_id: userId,
  endpoint: `https://push.example/${id}`,
  p256dh: "p",
  auth: "a",
});

function configureEmail() {
  vi.stubEnv("AWS_ACCESS_KEY_ID", "id");
  vi.stubEnv("AWS_SECRET_ACCESS_KEY", "secret");
}

function configurePush() {
  vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "public-key");
  vi.stubEnv("VAPID_PRIVATE_KEY", "private-key");
}

beforeEach(() => {
  resetVapidConfig();
  vi.stubEnv("AWS_ACCESS_KEY_ID", "");
  vi.stubEnv("AWS_SECRET_ACCESS_KEY", "");
  vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "");
  vi.stubEnv("VAPID_PRIVATE_KEY", "");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
  vi.stubEnv("VAPID_SUBJECT", "");
  vi.stubEnv("SES_FROM_EMAIL", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.render.mockResolvedValue("<html />");
  mocks.send.mockResolvedValue({});
  mocks.sendNotification.mockResolvedValue({});
  mocks.dbDeleteExpiredPushSubscription.mockResolvedValue(undefined);
  mocks.dbGetNotificationPreferencesFor.mockResolvedValue([]);
  mocks.dbGetPushSubscriptionsFor.mockResolvedValue([]);
});

describe("configuration", () => {
  it("uses the app URL without trailing slashes, or the default", () => {
    expect(appUrl()).toBe(DEFAULT_APP_URL);
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://clock.test//");
    expect(appUrl()).toBe("https://clock.test");
  });

  it("reports which channels are configured", () => {
    expect(isEmailConfigured()).toBe(false);
    expect(isPushConfigured()).toBe(false);
    configureEmail();
    configurePush();
    expect(isEmailConfigured()).toBe(true);
    expect(isPushConfigured()).toBe(true);
  });
});

describe("sendAlertEmail", () => {
  it("does nothing without SES credentials", async () => {
    await expect(sendAlertEmail("a@b.c", message)).resolves.toBe(false);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("sends an HTML and text email with an absolute link", async () => {
    configureEmail();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://clock.test");
    vi.stubEnv("SES_FROM_EMAIL", "Alerts <alerts@clock.test>");
    await expect(sendAlertEmail("a@b.c", message)).resolves.toBe(true);
    const { input } = mocks.send.mock.calls[0][0] as {
      input: {
        Destination: { ToAddresses: string[] };
        Message: {
          Subject: { Data: string };
          Body: { Html: { Data: string }; Text: { Data: string } };
        };
        Source: string;
      };
    };
    expect(input.Destination.ToAddresses).toEqual(["a@b.c"]);
    expect(input.Message.Subject.Data).toBe(message.title);
    expect(input.Message.Body.Html.Data).toBe("<html />");
    expect(input.Message.Body.Text.Data).toContain(
      "https://clock.test/?defaultTab=time-clock",
    );
    expect(input.Source).toBe("Alerts <alerts@clock.test>");
  });

  it("falls back to the default sender and reports failures", async () => {
    configureEmail();
    mocks.send.mockRejectedValueOnce(new Error("throttled"));
    await expect(sendAlertEmail("a@b.c", message)).resolves.toBe(false);
    expect(
      (mocks.send.mock.calls[0][0] as { input: { Source: string } }).input
        .Source,
    ).toContain("no-reply@clockout.patmac.ca");
  });
});

describe("sendAlertPush", () => {
  it("does nothing without VAPID keys or devices", async () => {
    await expect(sendAlertPush([device(1)], message)).resolves.toBe(0);
    configurePush();
    await expect(sendAlertPush([], message)).resolves.toBe(0);
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it("pushes the payload with the app icon and badge", async () => {
    configurePush();
    await expect(sendAlertPush([device(1), device(2)], message)).resolves.toBe(
      2,
    );
    expect(mocks.setVapidDetails).toHaveBeenCalledTimes(1);
    expect(mocks.setVapidDetails).toHaveBeenCalledWith(
      DEFAULT_APP_URL,
      "public-key",
      "private-key",
    );
    const [sub, payload, options] = mocks.sendNotification.mock.calls[0];
    expect(sub).toEqual({
      endpoint: "https://push.example/1",
      keys: { p256dh: "p", auth: "a" },
    });
    expect(JSON.parse(payload)).toEqual({
      ...message,
      icon: "/icon-192.png",
      badge: "/notification-badge.png",
    });
    expect(options).toMatchObject({ urgency: "high" });

    // Keys already applied: not set again.
    await sendAlertPush([device(1)], message);
    expect(mocks.setVapidDetails).toHaveBeenCalledTimes(1);
  });

  it("uses VAPID_SUBJECT when set", async () => {
    configurePush();
    vi.stubEnv("VAPID_SUBJECT", "mailto:ops@clock.test");
    await sendAlertPush([device(1)], message);
    expect(mocks.setVapidDetails).toHaveBeenCalledWith(
      "mailto:ops@clock.test",
      "public-key",
      "private-key",
    );
  });

  it("forgets devices the push service says are gone", async () => {
    configurePush();
    mocks.sendNotification
      .mockRejectedValueOnce(
        Object.assign(new Error("gone"), { statusCode: 410 }),
      )
      .mockRejectedValueOnce(
        Object.assign(new Error("missing"), { statusCode: 404 }),
      )
      .mockRejectedValueOnce(
        Object.assign(new Error("busy"), { statusCode: 500 }),
      );
    mocks.dbDeleteExpiredPushSubscription
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("db down"));
    await expect(
      sendAlertPush([device(1), device(2), device(3)], message),
    ).resolves.toBe(0);
    expect(mocks.dbDeleteExpiredPushSubscription.mock.calls).toEqual([
      ["https://push.example/1"],
      ["https://push.example/2"],
    ]);
  });
});

describe("deliver", () => {
  it("does nothing for no deliveries", async () => {
    await expect(deliver([])).resolves.toEqual({ email: 0, push: 0 });
    expect(mocks.dbGetNotificationPreferencesFor).not.toHaveBeenCalled();
  });

  it("sends over each recipient's chosen channels and topics", async () => {
    configureEmail();
    configurePush();
    mocks.dbGetNotificationPreferencesFor.mockResolvedValue([
      // u2 only wants push; u3 turned break alerts off.
      {
        user_id: "u2",
        email_enabled: false,
        push_enabled: true,
        shift_alerts: true,
        break_alerts: true,
        admin_alerts: true,
      },
      {
        user_id: "u3",
        email_enabled: true,
        push_enabled: true,
        shift_alerts: true,
        break_alerts: false,
        admin_alerts: true,
      },
    ]);
    mocks.dbGetPushSubscriptionsFor.mockResolvedValue([
      device(1, "u1"),
      device(2, "u2"),
      device(3, "u3"),
    ]);

    const counts = await deliver([
      // Defaults: email and push.
      {
        recipient: { userId: "u1", email: "u1@x.test" },
        category: "shift_alerts",
        message,
      },
      {
        recipient: { userId: "u2", email: "u2@x.test" },
        category: "admin_alerts",
        message,
      },
      {
        recipient: { userId: "u3", email: "u3@x.test" },
        category: "break_alerts",
        message,
      },
      // No email address on file.
      {
        recipient: { userId: "u1", email: null },
        category: "shift_alerts",
        message,
      },
    ]);

    expect(counts).toEqual({ email: 1, push: 3 });
    expect(mocks.dbGetNotificationPreferencesFor).toHaveBeenCalledWith([
      "u1",
      "u2",
      "u3",
    ]);
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it("skips loading devices when push isn't configured and counts failures as unsent", async () => {
    configureEmail();
    mocks.send.mockRejectedValueOnce(new Error("nope"));
    mocks.dbGetNotificationPreferencesFor.mockResolvedValue([
      {
        user_id: "u1",
        email_enabled: true,
        push_enabled: false,
        shift_alerts: true,
        break_alerts: true,
        admin_alerts: true,
      },
    ]);
    const counts = await deliver([
      {
        recipient: { userId: "u1", email: "u1@x.test" },
        category: "shift_alerts",
        message,
      },
    ]);
    expect(counts).toEqual({ email: 0, push: 0 });
    expect(mocks.dbGetPushSubscriptionsFor).not.toHaveBeenCalled();
  });
});
