import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getUser: vi.fn(),
  revalidateTag: vi.fn(),
  deliver: vi.fn(),
  dbGetNotificationPreferences: vi.fn(),
  dbUpdateNotificationPreferences: vi.fn(),
  dbSetUserTimezone: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: vi.fn(async () => ({ users: { getUser: m.getUser } })),
}));
vi.mock("next/cache", () => ({ revalidateTag: m.revalidateTag }));
vi.mock("@/lib/notify", () => ({
  deliver: m.deliver,
  isEmailConfigured: () => true,
  isPushConfigured: () => false,
}));
vi.mock("@/lib/alerts-db", () => ({
  dbGetNotificationPreferences: m.dbGetNotificationPreferences,
  dbUpdateNotificationPreferences: m.dbUpdateNotificationPreferences,
  dbSetUserTimezone: m.dbSetUserTimezone,
}));

import { manageNotificationPreferencesTool } from "@/mcp/notification-tools";

const caller = { userId: "user_sam", client: "Claude" };

beforeEach(() => {
  vi.clearAllMocks();
  m.dbGetNotificationPreferences.mockResolvedValue(undefined);
});

describe("manage_notification_preferences", () => {
  it("shows the caller's settings with defaults", async () => {
    const res = await manageNotificationPreferencesTool(caller, {});
    expect(m.dbGetNotificationPreferences).toHaveBeenCalledWith("user_sam");
    expect(res.data).toMatchObject({
      preferences: { email_enabled: true, schedule_alerts: true },
      timezone: null,
      email_available: true,
      push_available: false,
    });
  });

  it("changes only the fields passed, and the timezone", async () => {
    m.dbUpdateNotificationPreferences.mockImplementation(
      async (_u, input) => input,
    );
    const res = await manageNotificationPreferencesTool(caller, {
      action: "update",
      push_enabled: false,
      timezone: "America/Regina",
    });
    expect(res.data.status).toBe("updated");
    expect(m.dbUpdateNotificationPreferences).toHaveBeenCalledWith(
      "user_sam",
      expect.objectContaining({ push_enabled: false, email_enabled: true }),
    );
    expect(m.dbSetUserTimezone).toHaveBeenCalledWith(
      "user_sam",
      "America/Regina",
    );
    expect(m.revalidateTag).toHaveBeenCalledWith(
      "notification-prefs-user_sam",
      { expire: 0 },
    );
  });

  it("rejects an empty update and a bad timezone", async () => {
    expect(
      (await manageNotificationPreferencesTool(caller, { action: "update" }))
        .data.status,
    ).toBe("invalid_input");
    expect(
      (
        await manageNotificationPreferencesTool(caller, {
          action: "update",
          timezone: "Mars/Base",
        })
      ).data.status,
    ).toBe("invalid_input");
    expect(m.dbSetUserTimezone).not.toHaveBeenCalled();
  });

  it("sends a test notification to the caller", async () => {
    m.getUser.mockResolvedValue({
      primaryEmailAddress: { emailAddress: "sam@example.com" },
    });
    m.deliver.mockResolvedValue({ email: 1, push: 0 });
    const res = await manageNotificationPreferencesTool(caller, {
      action: "send_test",
    });
    expect(res.data.status).toBe("sent");
    expect(m.deliver.mock.calls[0][0][0].recipient).toEqual({
      userId: "user_sam",
      email: "sam@example.com",
    });
  });
});
