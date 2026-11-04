// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  publishJSON: vi.fn(),
  cancel: vi.fn(),
  verify: vi.fn(),
  clientConfigs: [] as unknown[],
  receiverConfigs: [] as unknown[],
  after: vi.fn(),
  dbDeleteAlertJob: vi.fn(),
  dbGetActiveAlertSettings: vi.fn(),
  dbGetAlertJob: vi.fn(),
  dbGetAlertSettingsFor: vi.fn(),
  dbGetClaimedAlertKeys: vi.fn(),
  dbGetNotificationPreferencesFor: vi.fn(),
  dbGetOpenShiftBreaks: vi.fn(),
  dbGetOpenShifts: vi.fn(),
  dbGetScheduledShiftsBetween: vi.fn(),
  dbUpsertAlertJob: vi.fn(),
  processOrgAlerts: vi.fn(),
  orgHasFeature: vi.fn(),
  dbGetBreakSettings: vi.fn(),
  dbGetScheduledShiftById: vi.fn(),
  runWeeklyScheduleDigests: vi.fn(),
  sendUpcomingShiftReminders: vi.fn(),
}));

vi.mock("@upstash/qstash", () => ({
  Client: class {
    publishJSON = mocks.publishJSON;
    messages = { cancel: mocks.cancel };
    constructor(config: unknown) {
      mocks.clientConfigs.push(config);
    }
  },
  Receiver: class {
    verify = mocks.verify;
    constructor(config: unknown) {
      mocks.receiverConfigs.push(config);
    }
  },
}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/alerts-db", () => ({
  dbDeleteAlertJob: mocks.dbDeleteAlertJob,
  dbGetActiveAlertSettings: mocks.dbGetActiveAlertSettings,
  dbGetAlertJob: mocks.dbGetAlertJob,
  dbGetAlertSettingsFor: mocks.dbGetAlertSettingsFor,
  dbGetClaimedAlertKeys: mocks.dbGetClaimedAlertKeys,
  dbGetNotificationPreferencesFor: mocks.dbGetNotificationPreferencesFor,
  dbGetOpenShiftBreaks: mocks.dbGetOpenShiftBreaks,
  dbGetOpenShifts: mocks.dbGetOpenShifts,
  dbGetScheduledShiftsBetween: mocks.dbGetScheduledShiftsBetween,
  dbUpsertAlertJob: mocks.dbUpsertAlertJob,
}));
vi.mock("@/lib/alerts-runner", () => ({
  processOrgAlerts: mocks.processOrgAlerts,
}));
vi.mock("@/lib/billing", () => ({
  NOTIFICATIONS_FEATURE: "notifications",
  orgHasFeature: mocks.orgHasFeature,
}));
vi.mock("@/lib/db", () => ({
  dbGetBreakSettings: mocks.dbGetBreakSettings,
  dbGetScheduledShiftById: mocks.dbGetScheduledShiftById,
}));
vi.mock("@/lib/notify", () => ({
  appUrl: () => "https://clock.test",
}));
vi.mock("@/lib/schedule-notify", () => ({
  DIGEST_HOUR: 17,
  SHIFT_REMINDER_MINUTES: 60,
  resolveTimezone: (tz?: string | null) =>
    tz ? { tz, known: true } : { tz: "UTC", known: false },
  runWeeklyScheduleDigests: mocks.runWeeklyScheduleDigests,
  sendUpcomingShiftReminders: mocks.sendUpcomingShiftReminders,
}));

import {
  cancelJob,
  dispatchUrl,
  isQStashConfigured,
  nextDigestInstant,
  parseAlertJob,
  queueShiftAlertSync,
  RETRY_FLOOR_MS,
  runAlertJob,
  scheduleAllAlertJobs,
  scheduleJob,
  scheduleWeeklyDigestJobs,
  syncOrgShiftAlerts,
  syncShiftReminderJob,
  verifyQStashSignature,
} from "@/lib/alert-jobs";

const HOUR = 3_600_000;
const MIN = 60_000;
const now = new Date("2026-11-03T15:00:00.000Z"); // a Tuesday

const rules = {
  org_id: "org_1",
  forgot_clock_out_enabled: true,
  forgot_clock_out_hours: 10,
  auto_clock_out_enabled: false,
  auto_clock_out_hours: 16,
  break_reminder_enabled: true,
  break_reminder_minutes: 45,
  notify_admins: true,
  schedule_notifications: true,
};

const openShift = (id: number, openMs: number) => ({
  id,
  user_id: "u1",
  org_id: "org_1",
  clock_in: new Date(now.getTime() - openMs),
});

function configure() {
  vi.stubEnv("QSTASH_TOKEN", "token");
  vi.stubEnv("QSTASH_CURRENT_SIGNING_KEY", "current");
  vi.stubEnv("QSTASH_NEXT_SIGNING_KEY", "next");
  vi.stubEnv("QSTASH_URL", "");
}

beforeEach(() => {
  mocks.clientConfigs.length = 0;
  mocks.receiverConfigs.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.publishJSON.mockResolvedValue({ messageId: "msg_new" });
  mocks.cancel.mockResolvedValue({ cancelled: 1 });
  mocks.verify.mockResolvedValue(true);
  mocks.dbGetAlertJob.mockResolvedValue(undefined);
  mocks.dbDeleteAlertJob.mockResolvedValue(undefined);
  mocks.dbUpsertAlertJob.mockResolvedValue(undefined);
  mocks.dbGetAlertSettingsFor.mockResolvedValue([rules]);
  mocks.dbGetOpenShifts.mockResolvedValue([]);
  mocks.dbGetOpenShiftBreaks.mockResolvedValue([]);
  mocks.dbGetClaimedAlertKeys.mockResolvedValue(new Set());
  mocks.dbGetBreakSettings.mockResolvedValue(undefined);
  mocks.dbGetActiveAlertSettings.mockResolvedValue([]);
  mocks.dbGetScheduledShiftsBetween.mockResolvedValue([]);
  mocks.dbGetNotificationPreferencesFor.mockResolvedValue([]);
  mocks.processOrgAlerts.mockResolvedValue({ status: "ok", alerts: 2 });
  mocks.orgHasFeature.mockResolvedValue(true);
  mocks.runWeeklyScheduleDigests.mockResolvedValue({ digests: 3 });
  mocks.sendUpcomingShiftReminders.mockResolvedValue({ reminders: 1 });
});

describe("configuration", () => {
  it("needs the token and both signing keys", () => {
    expect(isQStashConfigured()).toBe(false);
    vi.stubEnv("QSTASH_TOKEN", "token");
    vi.stubEnv("QSTASH_CURRENT_SIGNING_KEY", "current");
    expect(isQStashConfigured()).toBe(false);
    vi.stubEnv("QSTASH_NEXT_SIGNING_KEY", "next");
    expect(isQStashConfigured()).toBe(true);
  });

  it("delivers to the app's dispatch endpoint", () => {
    expect(dispatchUrl()).toBe("https://clock.test/api/alerts/dispatch");
  });
});

describe("verifyQStashSignature", () => {
  it("refuses without a signature or configuration", async () => {
    await expect(verifyQStashSignature("sig", "{}")).resolves.toBe(false);
    configure();
    await expect(verifyQStashSignature(null, "{}")).resolves.toBe(false);
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it("checks the signature against this URL and body", async () => {
    configure();
    await expect(verifyQStashSignature("sig", "{}")).resolves.toBe(true);
    expect(mocks.receiverConfigs[0]).toEqual({
      currentSigningKey: "current",
      nextSigningKey: "next",
    });
    expect(mocks.verify).toHaveBeenCalledWith({
      signature: "sig",
      body: "{}",
      url: "https://clock.test/api/alerts/dispatch",
      clockTolerance: 5,
    });
  });

  it("is false when verification throws", async () => {
    configure();
    mocks.verify.mockRejectedValue(new Error("bad signature"));
    await expect(verifyQStashSignature("sig", "{}")).resolves.toBe(false);
  });
});

describe("parseAlertJob", () => {
  const body = (value: unknown) => JSON.stringify(value);

  it("reads each job type", () => {
    expect(parseAlertJob(body({ type: "weekly-digest", runAt: 1 }))).toEqual({
      type: "weekly-digest",
      runAt: 1,
    });
    expect(
      parseAlertJob(body({ type: "shift-alerts", orgId: "org_1", runAt: 1 })),
    ).toEqual({ type: "shift-alerts", orgId: "org_1", runAt: 1 });
    expect(
      parseAlertJob(
        body({
          type: "upcoming-shift",
          orgId: "org_1",
          shiftId: 4,
          start: 9,
          runAt: 1,
          extra: true,
        }),
      ),
    ).toEqual({
      type: "upcoming-shift",
      orgId: "org_1",
      shiftId: 4,
      start: 9,
      runAt: 1,
    });
  });

  it("rejects anything else", () => {
    for (const bad of [
      "not json",
      "null",
      "5",
      body({ type: "weekly-digest" }),
      body({ type: "weekly-digest", runAt: "soon" }),
      body({ type: "shift-alerts", runAt: 1 }),
      body({ type: "shift-alerts", orgId: "", runAt: 1 }),
      body({
        type: "upcoming-shift",
        orgId: "o",
        shiftId: 1.5,
        start: 1,
        runAt: 1,
      }),
      body({ type: "upcoming-shift", orgId: "o", shiftId: 1, runAt: 1 }),
      body({ type: "mystery", orgId: "o", runAt: 1 }),
    ]) {
      expect(parseAlertJob(bad)).toBeNull();
    }
  });
});

describe("scheduleJob", () => {
  const job = { type: "shift-alerts" as const, orgId: "org_1" };

  it("publishes a delayed message to the dispatch URL and stores it", async () => {
    configure();
    vi.stubEnv("QSTASH_URL", "https://qstash-eu.test");
    const runAt = now.getTime() + 1500;
    await expect(scheduleJob("k", "org_1", runAt, job)).resolves.toBe(true);
    // Whole seconds, rounded up, so it never fires early.
    const rounded = now.getTime() + 2000;
    expect(mocks.publishJSON).toHaveBeenCalledWith({
      url: "https://clock.test/api/alerts/dispatch",
      body: { ...job, runAt: rounded },
      notBefore: rounded / 1000,
      retries: 3,
    });
    expect(mocks.clientConfigs[0]).toEqual({
      token: "token",
      baseUrl: "https://qstash-eu.test",
    });
    expect(mocks.dbUpsertAlertJob).toHaveBeenCalledWith(
      "k",
      "org_1",
      "msg_new",
      new Date(rounded),
    );
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it("does nothing when the job already runs then", async () => {
    configure();
    mocks.dbGetAlertJob.mockResolvedValue({ message_id: "m", run_at: now });
    await expect(scheduleJob("k", "org_1", now.getTime(), job)).resolves.toBe(
      false,
    );
    expect(mocks.publishJSON).not.toHaveBeenCalled();
  });

  it("moves a job: publishes the new message, then cancels the old", async () => {
    configure();
    mocks.dbGetAlertJob.mockResolvedValue({
      message_id: "msg_old",
      run_at: now,
    });
    await scheduleJob("k", "org_1", now.getTime() + HOUR, job);
    expect(mocks.clientConfigs[0]).toEqual({ token: "token" });
    expect(mocks.cancel).toHaveBeenCalledWith("msg_old");
  });

  it("tolerates a message that can't be cancelled any more", async () => {
    configure();
    mocks.dbGetAlertJob.mockResolvedValue({
      message_id: "msg_old",
      run_at: now,
    });
    mocks.cancel.mockRejectedValue(new Error("not found"));
    await expect(
      scheduleJob("k", "org_1", now.getTime() + HOUR, job),
    ).resolves.toBe(true);
    expect(console.warn).toHaveBeenCalled();
  });
});

describe("cancelJob", () => {
  it("cancels a stored job's message, if any", async () => {
    configure();
    await expect(cancelJob("k")).resolves.toBe(false);
    mocks.dbDeleteAlertJob.mockResolvedValue({ message_id: "msg_1" });
    await expect(cancelJob("k")).resolves.toBe(true);
    expect(mocks.cancel).toHaveBeenCalledWith("msg_1");
  });
});

describe("syncOrgShiftAlerts", () => {
  it("does nothing without QStash", async () => {
    await expect(syncOrgShiftAlerts("org_1", now)).resolves.toBeNull();
    expect(mocks.dbGetAlertSettingsFor).not.toHaveBeenCalled();
  });

  it("cancels the job when the org has no rule on", async () => {
    configure();
    mocks.dbGetAlertSettingsFor.mockResolvedValue([]);
    mocks.dbDeleteAlertJob.mockResolvedValue({ message_id: "msg_1" });
    await expect(syncOrgShiftAlerts("org_1", now)).resolves.toBeNull();
    expect(mocks.dbDeleteAlertJob).toHaveBeenCalledWith("shift-alerts:org_1");
    expect(mocks.cancel).toHaveBeenCalledWith("msg_1");
    expect(mocks.dbGetOpenShifts).not.toHaveBeenCalled();
  });

  it("cancels the job when nothing is pending", async () => {
    configure();
    await expect(syncOrgShiftAlerts("org_1", now)).resolves.toBeNull();
    expect(mocks.dbDeleteAlertJob).toHaveBeenCalledWith("shift-alerts:org_1");
    expect(mocks.publishJSON).not.toHaveBeenCalled();
  });

  it("schedules the next alert to the second", async () => {
    configure();
    mocks.dbGetOpenShifts.mockResolvedValue([openShift(1, 2 * HOUR)]);
    mocks.dbGetOpenShiftBreaks.mockResolvedValue([
      {
        id: 5,
        time_entry_id: 1,
        break_type: "unpaid_meal",
        break_start: new Date(now.getTime() - 5 * MIN),
        user_id: "u1",
        org_id: "org_1",
      },
    ]);
    mocks.dbGetBreakSettings.mockRejectedValue(new Error("db"));
    // Break reminder at 45m beats the 10h reminder.
    const due = new Date(now.getTime() + 40 * MIN);
    await expect(syncOrgShiftAlerts("org_1", now)).resolves.toEqual(due);
    expect(mocks.dbGetClaimedAlertKeys).toHaveBeenCalledWith([
      "forgot:1",
      "break:5",
      "break-over:5",
    ]);
    expect(mocks.publishJSON).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { type: "shift-alerts", orgId: "org_1", runAt: due.getTime() },
        notBefore: due.getTime() / 1000,
      }),
    );
  });

  it("skips break lookups when break reminders are off", async () => {
    configure();
    mocks.dbGetAlertSettingsFor.mockResolvedValue([
      { ...rules, break_reminder_enabled: false },
    ]);
    mocks.dbGetOpenShifts.mockResolvedValue([openShift(1, 2 * HOUR)]);
    await expect(syncOrgShiftAlerts("org_1", now)).resolves.toEqual(
      new Date(now.getTime() + 8 * HOUR),
    );
    expect(mocks.dbGetOpenShiftBreaks).not.toHaveBeenCalled();
  });

  it("schedules a break's end from its limit with no alert rules saved", async () => {
    configure();
    mocks.dbGetAlertSettingsFor.mockResolvedValue([]);
    mocks.dbGetBreakSettings.mockResolvedValue({
      org_id: "org_1",
      dock_lunch: false,
      lunch_duration_minutes: 30,
      lunch_min_shift_hours: 5,
      max_paid_break_minutes: 15,
    });
    mocks.dbGetOpenShifts.mockResolvedValue([openShift(1, 2 * HOUR)]);
    mocks.dbGetOpenShiftBreaks.mockResolvedValue([
      {
        id: 5,
        time_entry_id: 1,
        break_type: "paid_rest",
        break_start: new Date(now.getTime() - 5 * MIN),
        user_id: "u1",
        org_id: "org_1",
      },
    ]);
    const due = new Date(now.getTime() + 10 * MIN);
    await expect(syncOrgShiftAlerts("org_1", now)).resolves.toEqual(due);
    expect(mocks.publishJSON).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { type: "shift-alerts", orgId: "org_1", runAt: due.getTime() },
      }),
    );
  });

  it("never schedules in the past, nor before the retry floor", async () => {
    configure();
    mocks.dbGetOpenShifts.mockResolvedValue([openShift(1, 11 * HOUR)]);
    await expect(syncOrgShiftAlerts("org_1", now)).resolves.toEqual(now);
    const floor = now.getTime() + RETRY_FLOOR_MS;
    await expect(syncOrgShiftAlerts("org_1", now, floor)).resolves.toEqual(
      new Date(floor),
    );
  });

  it("defaults to the current time", async () => {
    configure();
    await expect(syncOrgShiftAlerts("org_1")).resolves.toBeNull();
  });
});

describe("queueShiftAlertSync", () => {
  it("does nothing without an org or QStash", () => {
    queueShiftAlertSync("org_1");
    configure();
    queueShiftAlertSync(null);
    queueShiftAlertSync(undefined);
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("runs after the response, logging failures", async () => {
    configure();
    mocks.after.mockImplementation((fn: () => unknown) => fn());
    mocks.dbGetAlertSettingsFor.mockRejectedValue(new Error("db"));
    queueShiftAlertSync("org_1");
    expect(mocks.after).toHaveBeenCalledTimes(1);
    await vi.waitFor(() =>
      expect(console.error).toHaveBeenCalledWith(
        "[Jobs] Failed to schedule alerts for org_1:",
        expect.any(Error),
      ),
    );
  });

  it("runs straight away outside a request", async () => {
    configure();
    mocks.after.mockImplementation(() => {
      throw new Error("outside request scope");
    });
    queueShiftAlertSync("org_1");
    await vi.waitFor(() =>
      expect(mocks.dbGetAlertSettingsFor).toHaveBeenCalledWith(["org_1"]),
    );
  });
});

describe("syncShiftReminderJob", () => {
  const shift = (startIn: number) => ({
    id: 7,
    org_id: "org_1",
    shift_start: new Date(now.getTime() + startIn),
  });

  it("does nothing without QStash", async () => {
    await expect(
      syncShiftReminderJob("added", shift(3 * HOUR), now),
    ).resolves.toBe(false);
    expect(mocks.dbGetAlertJob).not.toHaveBeenCalled();
  });

  it("schedules the reminder an hour ahead", async () => {
    configure();
    await expect(
      syncShiftReminderJob("added", shift(3 * HOUR), now),
    ).resolves.toBe(true);
    const start = now.getTime() + 3 * HOUR;
    expect(mocks.publishJSON).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          type: "upcoming-shift",
          orgId: "org_1",
          shiftId: 7,
          start,
          runAt: start - HOUR,
        },
      }),
    );
    expect(mocks.dbUpsertAlertJob.mock.calls[0][0]).toBe("upcoming:7");
  });

  it("sends right away when the shift starts within the hour", async () => {
    configure();
    await syncShiftReminderJob("changed", shift(20 * MIN), now);
    expect(mocks.publishJSON.mock.calls[0][0].body.runAt).toBe(now.getTime());
  });

  it("cancels for removed, started or far-off shifts", async () => {
    configure();
    for (const [change, startIn] of [
      ["removed", 3 * HOUR],
      ["changed", -MIN],
      ["added", 7 * 24 * HOUR],
    ] as const) {
      await expect(
        syncShiftReminderJob(change, shift(startIn), now),
      ).resolves.toBe(false);
    }
    expect(mocks.dbDeleteAlertJob).toHaveBeenCalledTimes(3);
    expect(mocks.publishJSON).not.toHaveBeenCalled();
  });

  it("defaults to the current time", async () => {
    configure();
    await expect(syncShiftReminderJob("removed", shift(HOUR))).resolves.toBe(
      false,
    );
  });
});

describe("nextDigestInstant", () => {
  it("is the coming Sunday at 5 PM in the zone", () => {
    expect(nextDigestInstant("UTC", now)).toEqual(
      new Date("2026-11-08T17:00:00.000Z"),
    );
    expect(nextDigestInstant("America/Regina", now)).toEqual(
      new Date("2026-11-08T23:00:00.000Z"),
    );
  });

  it("rolls over to next week from Sunday 5 PM on", () => {
    const sundayEvening = new Date("2026-11-08T17:00:00.000Z");
    expect(nextDigestInstant("UTC", sundayEvening)).toEqual(
      new Date("2026-11-15T17:00:00.000Z"),
    );
    const sundayMorning = new Date("2026-11-08T09:00:00.000Z");
    expect(nextDigestInstant("UTC", sundayMorning)).toEqual(
      new Date("2026-11-08T17:00:00.000Z"),
    );
  });
});

describe("scheduleWeeklyDigestJobs", () => {
  it("does nothing without QStash or upcoming shifts", async () => {
    await expect(scheduleWeeklyDigestJobs(now)).resolves.toBe(0);
    configure();
    await expect(scheduleWeeklyDigestJobs(now)).resolves.toBe(0);
    expect(mocks.dbGetNotificationPreferencesFor).not.toHaveBeenCalled();
  });

  it("publishes one deduplicated run per distinct local Sunday 5 PM", async () => {
    configure();
    mocks.dbGetScheduledShiftsBetween.mockResolvedValue([
      { user_id: "u1" },
      { user_id: "u2" },
      { user_id: "u3" },
      { user_id: "u1" },
    ]);
    mocks.dbGetNotificationPreferencesFor.mockResolvedValue([
      { user_id: "u1", timezone: "America/Regina" },
      // Same offset as Regina this week: one run covers both.
      { user_id: "u2", timezone: "America/Mexico_City" },
    ]);
    await expect(scheduleWeeklyDigestJobs(now)).resolves.toBe(2);
    expect(mocks.dbGetNotificationPreferencesFor).toHaveBeenCalledWith([
      "u1",
      "u2",
      "u3",
    ]);
    const regina = new Date("2026-11-08T23:00:00.000Z").getTime();
    const utc = new Date("2026-11-08T17:00:00.000Z").getTime();
    expect(mocks.publishJSON).toHaveBeenCalledWith({
      url: "https://clock.test/api/alerts/dispatch",
      body: { type: "weekly-digest", runAt: regina },
      notBefore: regina / 1000,
      retries: 3,
      deduplicationId: `weekly-digest-${regina}`,
    });
    expect(mocks.publishJSON.mock.calls[1][0].deduplicationId).toBe(
      `weekly-digest-${utc}`,
    );
  });

  it("defaults to the current time", async () => {
    await expect(scheduleWeeklyDigestJobs()).resolves.toBe(0);
  });
});

describe("runAlertJob", () => {
  it("sends weekly schedules from the job's time when it arrives early", async () => {
    const runAt = now.getTime() + 2000;
    await expect(
      runAlertJob({ type: "weekly-digest", runAt }, now),
    ).resolves.toEqual({ type: "weekly-digest", sent: 3 });
    expect(mocks.runWeeklyScheduleDigests).toHaveBeenCalledWith(
      new Date(runAt),
    );
  });

  describe("upcoming shift", () => {
    const start = now.getTime() + HOUR;
    const job = {
      type: "upcoming-shift" as const,
      orgId: "org_1",
      shiftId: 7,
      start,
      runAt: now.getTime(),
    };

    it("reminds when the shift is unchanged, then forgets the job", async () => {
      const shift = { id: 7, shift_start: new Date(start) };
      mocks.dbGetScheduledShiftById.mockResolvedValue(shift);
      await expect(runAlertJob(job, now)).resolves.toEqual({
        type: "upcoming-shift",
        sent: 1,
      });
      expect(mocks.dbGetScheduledShiftById).toHaveBeenCalledWith(7, "org_1");
      expect(mocks.sendUpcomingShiftReminders).toHaveBeenCalledWith(
        [shift],
        now,
      );
      expect(mocks.dbDeleteAlertJob).toHaveBeenCalledWith("upcoming:7");
    });

    it("skips a shift that was removed, moved or has started", async () => {
      mocks.dbGetScheduledShiftById.mockResolvedValueOnce(undefined);
      await expect(runAlertJob(job, now)).resolves.toEqual({
        type: "upcoming-shift",
        sent: 0,
      });
      mocks.dbGetScheduledShiftById.mockResolvedValueOnce({
        id: 7,
        shift_start: new Date(start + HOUR),
      });
      await expect(runAlertJob(job, now)).resolves.toMatchObject({ sent: 0 });
      mocks.dbGetScheduledShiftById.mockResolvedValueOnce({
        id: 7,
        shift_start: new Date(start),
      });
      await expect(
        runAlertJob(job, new Date(start + MIN)),
      ).resolves.toMatchObject({ sent: 0 });
      expect(mocks.sendUpcomingShiftReminders).not.toHaveBeenCalled();
    });
  });

  describe("shift alerts", () => {
    const runAt = now.getTime();
    const job = { type: "shift-alerts" as const, orgId: "org_1", runAt };

    it("sends what is due, then schedules the next check past the floor", async () => {
      configure();
      // Deleted after the first read, as the database would.
      mocks.dbGetAlertJob.mockResolvedValueOnce({
        message_id: "msg_this",
        run_at: new Date(runAt),
      });
      mocks.dbGetOpenShifts.mockResolvedValue([openShift(1, 11 * HOUR)]);
      await expect(runAlertJob(job, now)).resolves.toEqual({
        type: "shift-alerts",
        sent: 2,
      });
      expect(mocks.orgHasFeature).toHaveBeenCalledWith(
        "org_1",
        "notifications",
      );
      expect(mocks.processOrgAlerts).toHaveBeenCalledWith(rules, now, true);
      // The delivered message is forgotten, not cancelled.
      expect(mocks.dbDeleteAlertJob).toHaveBeenCalledWith("shift-alerts:org_1");
      expect(mocks.cancel).not.toHaveBeenCalled();
      expect(mocks.publishJSON.mock.calls[0][0].body.runAt).toBe(
        runAt + RETRY_FLOOR_MS,
      );
    });

    it("leaves a newer job alone and counts nothing for a failed org", async () => {
      configure();
      mocks.dbGetAlertJob.mockResolvedValue({
        message_id: "msg_newer",
        run_at: new Date(runAt + HOUR),
      });
      mocks.processOrgAlerts.mockResolvedValue({ status: "error" });
      await expect(runAlertJob(job, now)).resolves.toEqual({
        type: "shift-alerts",
        sent: 0,
      });
      expect(mocks.dbDeleteAlertJob).toHaveBeenCalledTimes(1); // by the sync
    });

    it("closes shifts but sends nothing for an org without notifications", async () => {
      mocks.orgHasFeature.mockResolvedValue(false);
      mocks.processOrgAlerts.mockResolvedValue({ status: "ok", alerts: 0 });
      await expect(runAlertJob(job, now)).resolves.toEqual({
        type: "shift-alerts",
        sent: 0,
      });
      expect(mocks.processOrgAlerts).toHaveBeenCalledWith(rules, now, false);
    });

    it("still processes an org with no settings row, for break limits", async () => {
      mocks.dbGetAlertSettingsFor.mockResolvedValue([]);
      await expect(runAlertJob(job)).resolves.toEqual({
        type: "shift-alerts",
        sent: 2,
      });
      expect(mocks.processOrgAlerts).toHaveBeenCalledWith(
        { org_id: "org_1" },
        expect.any(Date),
        true,
      );
    });
  });
});

describe("scheduleAllAlertJobs", () => {
  it("does nothing without QStash", async () => {
    await expect(scheduleAllAlertJobs(now)).resolves.toEqual({
      orgs: 0,
      reminders: 0,
      digests: 0,
    });
    expect(mocks.dbGetActiveAlertSettings).not.toHaveBeenCalled();
  });

  it("schedules every org, upcoming shift and weekly schedule", async () => {
    configure();
    mocks.dbGetActiveAlertSettings.mockResolvedValue([
      rules,
      { ...rules, org_id: "org_2" },
      { ...rules, org_id: "org_3" },
    ]);
    mocks.dbGetOpenShifts.mockImplementation(async (orgId: string) =>
      orgId === "org_1" ? [openShift(1, HOUR)] : [],
    );
    mocks.dbGetAlertSettingsFor.mockImplementation(
      async ([orgId]: string[]) => {
        if (orgId === "org_3") throw new Error("db");
        return [{ ...rules, org_id: orgId }];
      },
    );
    const shifts = [
      {
        id: 1,
        org_id: "org_1",
        user_id: "u1",
        shift_start: new Date(now.getTime() + 3 * HOUR),
      },
      {
        id: 2,
        org_id: "org_1",
        user_id: "u1",
        shift_start: new Date(now.getTime() + 4 * HOUR),
      },
    ];
    mocks.dbGetScheduledShiftsBetween.mockResolvedValue(shifts);
    mocks.dbUpsertAlertJob
      .mockResolvedValueOnce(undefined) // org_1
      .mockResolvedValueOnce(undefined) // shift 1
      .mockRejectedValueOnce(new Error("db")); // shift 2

    await expect(scheduleAllAlertJobs(now)).resolves.toEqual({
      orgs: 1,
      reminders: 1,
      digests: 1,
    });
    expect(mocks.dbGetScheduledShiftsBetween).toHaveBeenCalledWith(
      now,
      new Date(now.getTime() + 6 * 24 * HOUR),
    );
    expect(console.error).toHaveBeenCalledWith(
      "[Jobs] Sweep failed for org org_3:",
      expect.any(Error),
    );
    expect(console.error).toHaveBeenCalledWith(
      "[Jobs] Sweep failed for shift 2:",
      expect.any(Error),
    );
  });

  it("defaults to the current time", async () => {
    await expect(scheduleAllAlertJobs()).resolves.toMatchObject({ orgs: 0 });
  });
});
