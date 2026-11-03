import { describe, expect, it } from "vitest";
import {
  ALERT_BOUNDS,
  alertCategory,
  alertUserId,
  DEFAULT_ALERT_SETTINGS,
  DEFAULT_NOTIFICATION_PREFERENCES,
  describeAlert,
  formatElapsed,
  isValidFcmToken,
  isValidNotificationPreferences,
  isValidPushSubscription,
  nextShiftAlertDueAt,
  normalizeAlertSettings,
  normalizeNotificationPreferences,
  type PlannedAlert,
  pendingAlertKeys,
  planShiftAlerts,
  validateAlertSettings,
} from "@/lib/alerts";
import type { OpenShift, OpenShiftBreak } from "@/lib/alerts-db";
import type { AlertSettingsInput } from "@/lib/types";

const HOUR = 3_600_000;
const MIN = 60_000;
const now = new Date("2026-03-10T20:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

const shift = (id: number, openMs: number, userId = "u1"): OpenShift => ({
  id,
  user_id: userId,
  org_id: "org_1",
  clock_in: ago(openMs),
});

const brk = (
  id: number,
  entryId: number,
  elapsedMs: number,
  type: OpenShiftBreak["break_type"] = "unpaid_meal",
): OpenShiftBreak => ({
  id,
  time_entry_id: entryId,
  break_type: type,
  break_start: ago(elapsedMs),
  user_id: "u1",
  org_id: "org_1",
});

const allOn: AlertSettingsInput = {
  ...DEFAULT_ALERT_SETTINGS,
  forgot_clock_out_enabled: true,
  auto_clock_out_enabled: true,
  break_reminder_enabled: true,
};

describe("normalizeAlertSettings", () => {
  it("fills defaults for a missing row", () => {
    expect(normalizeAlertSettings(null)).toEqual(DEFAULT_ALERT_SETTINGS);
    expect(normalizeAlertSettings()).toEqual(DEFAULT_ALERT_SETTINGS);
  });

  it("coerces numeric strings and keeps stored values", () => {
    expect(
      normalizeAlertSettings({
        forgot_clock_out_enabled: true,
        forgot_clock_out_hours: "8.5" as unknown as number,
        auto_clock_out_enabled: true,
        auto_clock_out_hours: 12,
        break_reminder_enabled: true,
        break_reminder_minutes: "30" as unknown as number,
        notify_admins: false,
        schedule_notifications: false,
      }),
    ).toEqual({
      forgot_clock_out_enabled: true,
      forgot_clock_out_hours: 8.5,
      auto_clock_out_enabled: true,
      auto_clock_out_hours: 12,
      break_reminder_enabled: true,
      break_reminder_minutes: 30,
      notify_admins: false,
      schedule_notifications: false,
    });
  });

  it("falls back for unusable numbers", () => {
    expect(
      normalizeAlertSettings({
        forgot_clock_out_hours: "abc" as unknown as number,
        auto_clock_out_hours: null as unknown as number,
      }),
    ).toMatchObject({
      forgot_clock_out_hours: DEFAULT_ALERT_SETTINGS.forgot_clock_out_hours,
      auto_clock_out_hours: DEFAULT_ALERT_SETTINGS.auto_clock_out_hours,
    });
  });
});

describe("validateAlertSettings", () => {
  it("accepts the defaults and a valid configuration", () => {
    expect(validateAlertSettings(DEFAULT_ALERT_SETTINGS)).toBeNull();
    expect(validateAlertSettings(allOn)).toBeNull();
  });

  it.each([
    [{ notify_admins: "yes" }, "Invalid alert settings"],
    [{ schedule_notifications: null }, "Invalid alert settings"],
    [{ forgot_clock_out_hours: 0 }, "Reminder hours must be between"],
    [{ forgot_clock_out_hours: "5" }, "Reminder hours must be between"],
    [
      { auto_clock_out_hours: ALERT_BOUNDS.maxHours + 1 },
      "Auto clock-out hours must be between",
    ],
    [{ auto_clock_out_hours: Number.NaN }, "Auto clock-out hours"],
    [{ break_reminder_minutes: 0 }, "Break reminder minutes"],
    [{ break_reminder_minutes: 481 }, "Break reminder minutes"],
    [{ break_reminder_minutes: 30.5 }, "Break reminder minutes"],
    [
      {
        forgot_clock_out_enabled: true,
        auto_clock_out_enabled: true,
        forgot_clock_out_hours: 12,
        auto_clock_out_hours: 12,
      },
      "Auto clock-out must come after",
    ],
  ])("rejects %j", (patch, message) => {
    expect(
      validateAlertSettings({
        ...DEFAULT_ALERT_SETTINGS,
        ...(patch as Partial<AlertSettingsInput>),
      }),
    ).toContain(message);
  });

  it("allows an auto limit below the reminder when only one is on", () => {
    expect(
      validateAlertSettings({
        ...DEFAULT_ALERT_SETTINGS,
        auto_clock_out_enabled: true,
        forgot_clock_out_hours: 12,
        auto_clock_out_hours: 8,
      }),
    ).toBeNull();
  });
});

describe("notification preferences", () => {
  it("normalizes to defaults and keeps stored values", () => {
    expect(normalizeNotificationPreferences(undefined)).toEqual(
      DEFAULT_NOTIFICATION_PREFERENCES,
    );
    expect(
      normalizeNotificationPreferences({
        email_enabled: false,
        push_enabled: false,
        shift_alerts: false,
        break_alerts: false,
        admin_alerts: false,
        schedule_alerts: false,
      }),
    ).toEqual({
      email_enabled: false,
      push_enabled: false,
      shift_alerts: false,
      break_alerts: false,
      admin_alerts: false,
      schedule_alerts: false,
    });
  });

  it("validates every field is a boolean", () => {
    expect(
      isValidNotificationPreferences(DEFAULT_NOTIFICATION_PREFERENCES),
    ).toBe(true);
    expect(isValidNotificationPreferences(null)).toBe(false);
    expect(isValidNotificationPreferences("x")).toBe(false);
    expect(
      isValidNotificationPreferences({
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        push_enabled: "true",
      }),
    ).toBe(false);
  });
});

describe("isValidPushSubscription", () => {
  const good = {
    endpoint: "https://push.example/abc",
    keys: { p256dh: "key", auth: "auth" },
  };

  it("accepts an https subscription with keys", () => {
    expect(isValidPushSubscription(good)).toBe(true);
  });

  it.each([
    null,
    "x",
    { ...good, endpoint: 5 },
    { ...good, endpoint: "http://insecure" },
    { ...good, endpoint: `https://${"a".repeat(2048)}` },
    { ...good, keys: null },
    { ...good, keys: { p256dh: "", auth: "a" } },
    { ...good, keys: { p256dh: "a".repeat(513), auth: "a" } },
    { ...good, keys: { p256dh: "a", auth: "" } },
    { ...good, keys: { p256dh: "a", auth: "a".repeat(513) } },
    { ...good, keys: { p256dh: "a", auth: 1 } },
  ])("rejects %j", (input) => {
    expect(isValidPushSubscription(input)).toBe(false);
  });
});

describe("planShiftAlerts", () => {
  it("plans nothing when every rule is off", () => {
    expect(
      planShiftAlerts({
        settings: DEFAULT_ALERT_SETTINGS,
        shifts: [shift(1, 40 * HOUR)],
        breaks: [brk(9, 1, 5 * HOUR)],
        now,
      }),
    ).toEqual([]);
  });

  it("auto clocks out long shifts and reminds the rest", () => {
    const planned = planShiftAlerts({
      settings: allOn,
      shifts: [shift(1, 17 * HOUR), shift(2, 11 * HOUR), shift(3, 2 * HOUR)],
      breaks: [
        // On a shift being closed: skipped.
        brk(10, 1, 3 * HOUR),
        // Past the 45-minute reminder.
        brk(11, 2, 50 * MIN),
        // Not yet.
        brk(12, 3, 10 * MIN),
      ],
      now,
    });
    expect(planned.map((p) => p.key)).toEqual([
      "auto:1",
      "forgot:2",
      "break:11",
    ]);
    expect(planned[0]).toMatchObject({ kind: "auto_clock_out", hours: 16 });
    expect(planned[1]).toMatchObject({
      kind: "forgot_clock_out",
      openMs: 11 * HOUR,
    });
    expect(planned[2]).toMatchObject({
      kind: "break_reminder",
      elapsedMs: 50 * MIN,
      limitMinutes: null,
    });
  });

  it("reminds at a break's limit when it comes before the reminder", () => {
    const planned = planShiftAlerts({
      settings: { ...allOn, break_reminder_minutes: 60 },
      breakSettings: {
        org_id: "org_1",
        dock_lunch: false,
        lunch_duration_minutes: 30,
        lunch_min_shift_hours: 5,
        max_paid_break_minutes: 15,
        max_meal_break_minutes: 90,
      },
      shifts: [],
      breaks: [
        brk(1, 1, 16 * MIN, "paid_rest"),
        brk(2, 2, 14 * MIN, "paid_rest"),
        // The meal limit (90) is later than the reminder (60).
        brk(3, 3, 61 * MIN, "unpaid_meal"),
      ],
      now: new Date(now),
    });
    expect(planned).toEqual([
      expect.objectContaining({ key: "break:1", limitMinutes: 15 }),
      expect.objectContaining({ key: "break:3", limitMinutes: null }),
    ]);
  });

  it("only reminds about shifts when auto clock-out is off", () => {
    const planned = planShiftAlerts({
      settings: { ...DEFAULT_ALERT_SETTINGS, forgot_clock_out_enabled: true },
      shifts: [shift(1, 30 * HOUR)],
      breaks: [],
      now,
    });
    expect(planned.map((p) => p.kind)).toEqual(["forgot_clock_out"]);
  });
});

describe("wording", () => {
  const base = { memberName: "Ada", orgId: "org 1" };
  const forgot: PlannedAlert = {
    kind: "forgot_clock_out",
    key: "forgot:1",
    shift: shift(1, 10 * HOUR + 5 * MIN),
    openMs: 10 * HOUR + 5 * MIN,
  };
  const auto: PlannedAlert = {
    kind: "auto_clock_out",
    key: "auto:1",
    shift: shift(1, 17 * HOUR),
    hours: 16,
  };
  const autoHalf: PlannedAlert = { ...auto, hours: 12.5 };
  const breakLong: PlannedAlert = {
    kind: "break_reminder",
    key: "break:5",
    brk: brk(5, 1, 47 * MIN),
    elapsedMs: 47 * MIN,
    limitMinutes: null,
  };
  const breakLimit: PlannedAlert = { ...breakLong, limitMinutes: 30 };

  it("formats elapsed time", () => {
    expect(formatElapsed(47 * MIN)).toBe("47m");
    expect(formatElapsed(2 * HOUR + 3 * MIN)).toBe("2h 3m");
    expect(formatElapsed(-5)).toBe("0m");
  });

  it("knows who an alert is about and its category", () => {
    expect(alertUserId(forgot)).toBe("u1");
    expect(alertUserId(breakLong)).toBe("u1");
    expect(alertCategory(auto)).toBe("shift_alerts");
    expect(alertCategory(breakLong)).toBe("break_alerts");
  });

  it("words member alerts and links them to the time clock", () => {
    const member = { ...base, forAdmin: false };
    expect(describeAlert(forgot, member)).toEqual({
      title: "Still clocked in?",
      body: "You've been clocked in for 10h 5m. Forgot to clock out? Tap to open Clock Out.",
      url: "/?defaultTab=time-clock&orgId=org%201",
      tag: "forgot:1",
    });
    expect(describeAlert(auto, member).body).toContain("16-hour limit");
    expect(describeAlert(autoHalf, member).body).toContain("12.5-hour limit");
    expect(describeAlert(breakLong, member)).toMatchObject({
      title: "Still on break?",
      body: expect.stringContaining("meal period has been running for 47m"),
    });
    expect(describeAlert(breakLimit, member)).toMatchObject({
      title: "Your break is over",
      body: expect.stringContaining("30-minute limit"),
    });
  });

  it("words admin alerts and links them to the member's hours", () => {
    const admin = { ...base, forAdmin: true };
    expect(describeAlert(forgot, admin)).toEqual({
      title: "Ada may have forgotten to clock out",
      body: "Ada has been clocked in for 10h 5m.",
      url: "/?defaultTab=view&orgId=org%201&userId=u1",
      tag: "forgot:1:admin",
    });
    expect(describeAlert(auto, admin).title).toBe(
      "Ada was clocked out automatically",
    );
    expect(describeAlert(breakLong, admin).title).toBe("Ada is still on break");
    expect(describeAlert(breakLimit, admin)).toMatchObject({
      title: "Ada's break is over",
      body: "Ada's meal period reached its 30-minute limit.",
    });
  });
});

describe("isValidTimeZone", () => {
  it("accepts real IANA zones only", async () => {
    const { isValidTimeZone } = await import("@/lib/alerts");
    expect(isValidTimeZone("America/Regina")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone("A".repeat(65))).toBe(false);
    expect(isValidTimeZone(42)).toBe(false);
  });
});

describe("isValidFcmToken", () => {
  const token = "dGVzdA:APA91bH-abc_123456789";

  it("accepts a token with optional https endpoints", () => {
    expect(isValidFcmToken({ token })).toBe(true);
    expect(
      isValidFcmToken({
        token,
        endpoint: "https://fcm.googleapis.com/fcm/send/x",
        replacedEndpoint: null,
      }),
    ).toBe(true);
  });

  it("refuses anything else", () => {
    expect(isValidFcmToken(null)).toBe(false);
    expect(isValidFcmToken("token")).toBe(false);
    expect(isValidFcmToken({ token: 5 })).toBe(false);
    expect(isValidFcmToken({ token: "short" })).toBe(false);
    expect(isValidFcmToken({ token: `${token} with spaces` })).toBe(false);
    expect(isValidFcmToken({ token, endpoint: "http://insecure" })).toBe(false);
    expect(isValidFcmToken({ token, endpoint: 7 })).toBe(false);
    expect(
      isValidFcmToken({
        token,
        replacedEndpoint: `https://${"a".repeat(2050)}`,
      }),
    ).toBe(false);
  });
});

describe("nextShiftAlertDueAt", () => {
  const at = (ms: number) => new Date(now.getTime() + ms);
  const none = new Set<string>();

  it("is null when nothing is open or no rule applies", () => {
    expect(
      nextShiftAlertDueAt({
        settings: allOn,
        shifts: [],
        breaks: [],
        claimed: none,
      }),
    ).toBeNull();
    expect(
      nextShiftAlertDueAt({
        settings: DEFAULT_ALERT_SETTINGS,
        shifts: [shift(1, HOUR)],
        breaks: [brk(1, 1, MIN)],
        claimed: none,
      }),
    ).toBeNull();
  });

  it("is the forgot-to-clock-out reminder until it has been sent", () => {
    const shifts = [shift(1, 2 * HOUR), shift(2, 3 * HOUR)];
    // Reminder at 10h; shift 2 started an hour earlier.
    expect(
      nextShiftAlertDueAt({
        settings: allOn,
        shifts,
        breaks: [],
        claimed: none,
      }),
    ).toEqual(at(7 * HOUR));
    expect(
      nextShiftAlertDueAt({
        settings: allOn,
        shifts,
        breaks: [],
        claimed: new Set(["forgot:2"]),
      }),
    ).toEqual(at(8 * HOUR));
    // Both reminded: next is shift 2's automatic clock-out at 16h.
    expect(
      nextShiftAlertDueAt({
        settings: allOn,
        shifts,
        breaks: [],
        claimed: new Set(["forgot:1", "forgot:2"]),
      }),
    ).toEqual(at(13 * HOUR));
  });

  it("is a past moment for a reminder that is already overdue", () => {
    expect(
      nextShiftAlertDueAt({
        settings: { ...allOn, auto_clock_out_enabled: false },
        shifts: [shift(1, 11 * HOUR)],
        breaks: [],
        claimed: none,
      }),
    ).toEqual(at(-HOUR));
  });

  it("skips the reminder when the automatic clock-out comes first", () => {
    expect(
      nextShiftAlertDueAt({
        settings: {
          ...allOn,
          forgot_clock_out_hours: 12,
          auto_clock_out_hours: 12,
        },
        shifts: [shift(1, HOUR)],
        breaks: [],
        claimed: none,
      }),
    ).toEqual(at(11 * HOUR));
  });

  it("counts running breaks at the reminder or their type's limit", () => {
    const settings = {
      ...allOn,
      forgot_clock_out_enabled: false,
      auto_clock_out_enabled: false,
      break_reminder_minutes: 60,
    };
    const breakSettings = {
      org_id: "org_1",
      dock_lunch: false,
      lunch_duration_minutes: 30,
      lunch_min_shift_hours: 5,
      max_paid_break_minutes: 15,
      max_meal_break_minutes: 90,
    };
    const shifts = [shift(1, HOUR), shift(2, HOUR)];
    expect(
      nextShiftAlertDueAt({
        settings,
        breakSettings,
        shifts,
        // Meal: reminder (60) before its limit (90). Rest: its limit (15).
        breaks: [
          brk(1, 1, 10 * MIN, "unpaid_meal"),
          brk(2, 2, 5 * MIN, "paid_rest"),
        ],
        claimed: none,
      }),
    ).toEqual(at(10 * MIN));
    expect(
      nextShiftAlertDueAt({
        settings,
        breakSettings,
        shifts,
        breaks: [
          brk(1, 1, 10 * MIN, "unpaid_meal"),
          brk(2, 2, 5 * MIN, "paid_rest"),
        ],
        claimed: new Set(["break:2"]),
      }),
    ).toEqual(at(50 * MIN));
  });

  it("leaves a break to its shift's automatic clock-out when that is sooner", () => {
    expect(
      nextShiftAlertDueAt({
        settings: { ...allOn, forgot_clock_out_enabled: false },
        // 15h59m in, on a break that started a minute ago (reminder at 45m).
        shifts: [shift(1, 16 * HOUR - MIN)],
        breaks: [brk(1, 1, MIN)],
        claimed: none,
      }),
    ).toEqual(at(MIN));
    // With no auto clock-out the break's own reminder counts.
    expect(
      nextShiftAlertDueAt({
        settings: {
          ...allOn,
          forgot_clock_out_enabled: false,
          auto_clock_out_enabled: false,
        },
        shifts: [shift(1, HOUR)],
        breaks: [brk(1, 1, MIN)],
        claimed: none,
      }),
    ).toEqual(at(44 * MIN));
  });
});

describe("pendingAlertKeys", () => {
  it("lists the keys whose sending decides the next due time", () => {
    expect(pendingAlertKeys([shift(1, 0)], [brk(7, 1, 0)])).toEqual([
      "forgot:1",
      "break:7",
    ]);
  });
});
