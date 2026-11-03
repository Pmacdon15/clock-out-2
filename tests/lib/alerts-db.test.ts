import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { sql, neon, cacheTag, cacheLife } = vi.hoisted(() => {
  const sql = Object.assign(vi.fn(), { transaction: vi.fn() });
  return {
    sql,
    neon: vi.fn(() => sql),
    cacheTag: vi.fn(),
    cacheLife: vi.fn(),
  };
});

vi.mock("@neondatabase/serverless", () => ({ neon }));
vi.mock("next/cache", () => ({ cacheTag, cacheLife }));

type AlertsDb = typeof import("@/lib/alerts-db");
type Db = typeof import("@/lib/db");
let adb: AlertsDb;
let db: Db;

const textOf = (call: number) =>
  (sql.mock.calls[call][0] as string[]).join("?").replace(/\s+/g, " ").trim();
const valuesOf = (call: number) => sql.mock.calls[call].slice(1);
const allText = () => sql.mock.calls.map((_c, i) => textOf(i)).join("\n");

/** Number of statements `ensureAlertTables` runs the first time. */
const ENSURE_STATEMENTS = 11;

const input = {
  forgot_clock_out_enabled: true,
  forgot_clock_out_hours: 10,
  auto_clock_out_enabled: true,
  auto_clock_out_hours: 16,
  break_reminder_enabled: false,
  break_reminder_minutes: 45,
  notify_admins: true,
  schedule_notifications: true,
};

const prefs = {
  email_enabled: true,
  push_enabled: false,
  shift_alerts: true,
  break_alerts: true,
  admin_alerts: false,
  schedule_alerts: true,
};

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "postgres://test");
  db = await import("@/lib/db");
  adb = await import("@/lib/alerts-db");
});

beforeEach(() => {
  sql.mockReset();
  sql.mockResolvedValue([]);
  // Treat the tables as already created unless a test says otherwise.
  adb.resetAlertTablesCheck();
  db.resetTimeEntryBreaksTableCheck();
});

/** Runs the table checks once so later calls only issue their own query. */
async function primeTables() {
  await adb.ensureAlertTables();
  await db.ensureTimeEntryBreaksTable();
  sql.mockClear();
}

describe("ensureAlertTables", () => {
  it("creates every alert table once per instance", async () => {
    await adb.ensureAlertTables();
    await adb.ensureAlertTables();
    expect(sql).toHaveBeenCalledTimes(ENSURE_STATEMENTS);
    const text = allText();
    for (const table of [
      "settings",
      "alert_settings",
      "notification_preferences",
      "push_subscriptions",
      "sent_alerts",
      "fcm_tokens",
    ]) {
      expect(text).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
  });

  it("retries after a failure", async () => {
    sql.mockRejectedValueOnce(new Error("down"));
    await expect(adb.ensureAlertTables()).rejects.toThrow("down");
    await adb.ensureAlertTables();
    expect(sql).toHaveBeenCalledTimes(1 + ENSURE_STATEMENTS);
  });
});

describe("alert settings", () => {
  it("reads one org's settings with a cache tag", async () => {
    await primeTables();
    sql.mockResolvedValueOnce([{ org_id: "o1" }]);
    await expect(adb.dbGetAlertSettings("o1")).resolves.toEqual({
      org_id: "o1",
    });
    expect(cacheTag).toHaveBeenCalledWith("alert-settings-o1");
    expect(cacheLife).toHaveBeenCalledWith("hours");
    expect(valuesOf(0)).toEqual(["o1"]);
  });

  it("upserts settings after making sure the parent row exists", async () => {
    await primeTables();
    sql.mockResolvedValueOnce([]).mockResolvedValueOnce([{ org_id: "o1" }]);
    await expect(adb.dbUpdateAlertSettings("o1", input)).resolves.toEqual({
      org_id: "o1",
    });
    expect(textOf(0)).toContain("INSERT INTO settings");
    expect(textOf(1)).toContain("INSERT INTO alert_settings");
    expect(textOf(1)).toContain("ON CONFLICT (org_id)");
    expect(valuesOf(1).slice(0, 9)).toEqual([
      "o1",
      true,
      10,
      true,
      16,
      false,
      45,
      true,
      true,
    ]);
  });

  it("lists orgs with any rule switched on", async () => {
    await primeTables();
    sql.mockResolvedValueOnce([{ org_id: "o1" }]);
    await expect(adb.dbGetActiveAlertSettings()).resolves.toEqual([
      { org_id: "o1" },
    ]);
    expect(textOf(0)).toContain("WHERE forgot_clock_out_enabled");
  });
});

describe("notification preferences", () => {
  it("reads my preferences with a cache tag", async () => {
    await primeTables();
    sql.mockResolvedValueOnce([{ user_id: "u1" }]);
    await expect(adb.dbGetNotificationPreferences("u1")).resolves.toEqual({
      user_id: "u1",
    });
    expect(cacheTag).toHaveBeenCalledWith("notification-prefs-u1");
  });

  it("reads many people's preferences, skipping the query for nobody", async () => {
    await expect(adb.dbGetNotificationPreferencesFor([])).resolves.toEqual([]);
    expect(sql).not.toHaveBeenCalled();
    await primeTables();
    sql.mockResolvedValueOnce([{ user_id: "u1" }]);
    await expect(
      adb.dbGetNotificationPreferencesFor(["u1", "u2"]),
    ).resolves.toEqual([{ user_id: "u1" }]);
    expect(valuesOf(0)).toEqual([["u1", "u2"]]);
  });

  it("upserts preferences", async () => {
    await primeTables();
    sql.mockResolvedValueOnce([{ user_id: "u1" }]);
    await adb.dbUpdateNotificationPreferences("u1", prefs);
    expect(textOf(0)).toContain("INSERT INTO notification_preferences");
    expect(valuesOf(0).slice(0, 7)).toEqual([
      "u1",
      true,
      false,
      true,
      true,
      false,
      true,
    ]);
  });
});

describe("push subscriptions", () => {
  const sub = {
    endpoint: "https://push.example/1",
    keys: { p256dh: "p", auth: "a" },
  };

  it("saves a device, moving an existing endpoint to this user", async () => {
    await primeTables();
    sql.mockResolvedValueOnce([{ id: 1 }]);
    await expect(
      adb.dbSavePushSubscription("u1", sub, "Safari"),
    ).resolves.toEqual({ id: 1 });
    expect(textOf(0)).toContain("ON CONFLICT (endpoint)");
    expect(valuesOf(0).slice(0, 5)).toEqual([
      "u1",
      sub.endpoint,
      "p",
      "a",
      "Safari",
    ]);
  });

  it("deletes only the caller's own device, on both channels", async () => {
    await primeTables();
    sql.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 1 }]);
    await expect(
      adb.dbDeletePushSubscription("u1", sub.endpoint),
    ).resolves.toEqual({ id: 1 });
    expect(textOf(0)).toContain("DELETE FROM fcm_tokens");
    expect(valuesOf(0)).toEqual(["u1", sub.endpoint]);
    expect(textOf(1)).toContain("DELETE FROM push_subscriptions");
    expect(valuesOf(1)).toEqual(["u1", sub.endpoint]);
  });

  it("drops an expired endpoint", async () => {
    await primeTables();
    await adb.dbDeleteExpiredPushSubscription(sub.endpoint);
    expect(textOf(0)).toContain("DELETE FROM push_subscriptions");
    expect(valuesOf(0)).toEqual([sub.endpoint]);
  });

  it("lists devices for many users, skipping the query for nobody", async () => {
    await expect(adb.dbGetPushSubscriptionsFor([])).resolves.toEqual([]);
    expect(sql).not.toHaveBeenCalled();
    await primeTables();
    sql.mockResolvedValueOnce([{ id: 1 }]);
    await expect(adb.dbGetPushSubscriptionsFor(["u1"])).resolves.toEqual([
      { id: 1 },
    ]);
  });
});

describe("cron reads and writes", () => {
  it("lists an org's open shifts", async () => {
    sql.mockResolvedValueOnce([{ id: 1 }]);
    await expect(adb.dbGetOpenShifts("o1")).resolves.toEqual([{ id: 1 }]);
    expect(textOf(0)).toContain("clock_out IS NULL");
    expect(valuesOf(0)).toEqual(["o1"]);
  });

  it("lists running breaks on open shifts", async () => {
    await primeTables();
    sql.mockResolvedValueOnce([{ id: 2 }]);
    await expect(adb.dbGetOpenShiftBreaks("o1")).resolves.toEqual([{ id: 2 }]);
    expect(textOf(0)).toContain("b.break_end IS NULL");
  });

  it("claims an alert key only once", async () => {
    await primeTables();
    sql.mockResolvedValueOnce([{ alert_key: "forgot:1" }]);
    await expect(adb.dbClaimAlert("forgot:1", "o1")).resolves.toBe(true);
    sql.mockResolvedValueOnce([]);
    await expect(adb.dbClaimAlert("forgot:1", "o1")).resolves.toBe(false);
    expect(textOf(0)).toContain("ON CONFLICT (alert_key) DO NOTHING");
  });

  it("auto clocks out at the limit, trimming breaks to the shift", async () => {
    await primeTables();
    sql.mockResolvedValueOnce([{ id: 7, user_id: "u1" }]);
    await expect(
      adb.dbAutoClockOut(7, 16, {
        unpaid_meal: 30,
        paid_meal: 45,
        unpaid_rest: null,
        paid_rest: 15,
      }),
    ).resolves.toEqual({ id: 7, user_id: "u1" });
    const text = textOf(0);
    expect(text).toContain("UPDATE time_entries");
    expect(text).toContain("DELETE FROM time_entry_breaks");
    expect(text).toContain("UPDATE time_entry_breaks");
    expect(text).toContain("WHEN 'paid_meal' THEN ?::INTEGER");
    expect(valuesOf(0)).toEqual([16, 7, 16, 30, 45, null, 15]);
  });

  it("returns undefined when the shift was already closed, without limits", async () => {
    await primeTables();
    await expect(adb.dbAutoClockOut(7, 16)).resolves.toBeUndefined();
    expect(valuesOf(0)).toEqual([16, 7, 16, null, null, null, null]);
  });
});

describe("schedule notification queries", () => {
  it("remembers a person's time zone, creating their row if needed", async () => {
    await primeTables();
    await adb.dbSetUserTimezone("u1", "America/Regina");
    expect(textOf(0)).toContain("INSERT INTO notification_preferences");
    expect(textOf(0)).toContain("DO UPDATE SET timezone");
    expect(valuesOf(0)).toEqual(["u1", "America/Regina", "America/Regina"]);
  });

  it("reads settings for many orgs, skipping the query for none", async () => {
    await expect(adb.dbGetAlertSettingsFor([])).resolves.toEqual([]);
    expect(sql).not.toHaveBeenCalled();
    await primeTables();
    sql.mockResolvedValueOnce([{ org_id: "o1" }]);
    await expect(adb.dbGetAlertSettingsFor(["o1"])).resolves.toEqual([
      { org_id: "o1" },
    ]);
    expect(valuesOf(0)).toEqual([["o1"]]);
  });

  it("lists every org's shifts in a window, uncached", async () => {
    await primeTables();
    db.resetScheduledShiftsTableCheck();
    await db.ensureScheduledShiftsTable();
    sql.mockClear();
    sql.mockResolvedValueOnce([{ id: 1 }]);
    const start = new Date("2026-11-01T00:00:00Z");
    const end = new Date("2026-11-10T00:00:00Z");
    await expect(adb.dbGetScheduledShiftsBetween(start, end)).resolves.toEqual([
      { id: 1 },
    ]);
    expect(textOf(0)).toContain("FROM scheduled_shifts");
    expect(valuesOf(0)).toEqual([start, end]);
    expect(cacheTag).not.toHaveBeenCalled();
  });
});

describe("FCM tokens", () => {
  const token = "fcm-token-1";

  it("saves a token, drops the legacy row and older tokens for its endpoint", async () => {
    await primeTables();
    sql.mockResolvedValueOnce([{ token }]);
    await expect(
      adb.dbSaveFcmToken(
        "u1",
        {
          token,
          endpoint: "https://fcm/ep",
          replacedEndpoint: "https://legacy/ep",
        },
        "UA",
      ),
    ).resolves.toEqual({ token });
    expect(textOf(0)).toContain("INSERT INTO fcm_tokens");
    expect(textOf(0)).toContain("ON CONFLICT (token)");
    expect(valuesOf(0)).toEqual([
      token,
      "u1",
      "https://fcm/ep",
      "UA",
      "u1",
      "https://fcm/ep",
      "UA",
    ]);
    expect(textOf(1)).toContain("DELETE FROM push_subscriptions");
    expect(valuesOf(1)).toEqual([["https://fcm/ep", "https://legacy/ep"]]);
    expect(textOf(2)).toContain("DELETE FROM fcm_tokens");
    expect(valuesOf(2)).toEqual(["https://fcm/ep", token]);
  });

  it("saves a token without an endpoint and touches nothing else", async () => {
    await primeTables();
    sql.mockResolvedValueOnce([{ token }]);
    await adb.dbSaveFcmToken("u1", { token }, null);
    expect(sql).toHaveBeenCalledTimes(1);
    expect(valuesOf(0)).toEqual([token, "u1", null, null, "u1", null, null]);
  });

  it("lists tokens for many users, skipping the query for nobody", async () => {
    await expect(adb.dbGetFcmTokensFor([])).resolves.toEqual([]);
    expect(sql).not.toHaveBeenCalled();
    await primeTables();
    sql.mockResolvedValueOnce([{ token }]);
    await expect(adb.dbGetFcmTokensFor(["u1"])).resolves.toEqual([{ token }]);
    expect(textOf(0)).toContain("FROM fcm_tokens");
    expect(valuesOf(0)).toEqual([["u1"]]);
  });

  it("deletes dead tokens, skipping the query for none", async () => {
    await adb.dbDeleteFcmTokens([]);
    expect(sql).not.toHaveBeenCalled();
    await primeTables();
    await adb.dbDeleteFcmTokens([token]);
    expect(textOf(0)).toContain("DELETE FROM fcm_tokens");
    expect(valuesOf(0)).toEqual([[token]]);
  });

  it("prunes tokens not seen for a while", async () => {
    await primeTables();
    sql.mockResolvedValueOnce([{ token: "a" }, { token: "b" }]);
    await expect(adb.dbPruneStaleFcmTokens(240)).resolves.toBe(2);
    expect(textOf(0)).toContain("last_seen_at <");
    expect(valuesOf(0)).toEqual([240]);
  });
});
