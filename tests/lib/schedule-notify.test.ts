// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbClaimAlert: vi.fn(),
  dbGetAlertSettingsFor: vi.fn(),
  dbGetNotificationPreferencesFor: vi.fn(),
  dbGetScheduledShiftsBetween: vi.fn(),
  loadOrgMembers: vi.fn(),
  deliver: vi.fn(),
}));

vi.mock("@/lib/alerts-db", () => ({
  dbClaimAlert: mocks.dbClaimAlert,
  dbGetAlertSettingsFor: mocks.dbGetAlertSettingsFor,
  dbGetNotificationPreferencesFor: mocks.dbGetNotificationPreferencesFor,
  dbGetScheduledShiftsBetween: mocks.dbGetScheduledShiftsBetween,
}));
vi.mock("@/lib/alerts-runner", () => ({
  loadOrgMembers: mocks.loadOrgMembers,
}));
vi.mock("@/lib/notify", () => ({ deliver: mocks.deliver }));

import {
  DIGEST_HOUR,
  describeShiftChange,
  describeWeeklyDigest,
  FALLBACK_TIMEZONE,
  formatHours,
  formatShiftRange,
  notifyScheduleChange,
  planWeeklyDigests,
  resolveTimezone,
  runWeeklyScheduleDigests,
} from "@/lib/schedule-notify";
import type { ScheduledShift } from "@/lib/types";

const REGINA = { tz: "America/Regina", known: true }; // UTC-6, no DST
const UTC_GUESS = { tz: "UTC", known: false };

let nextId = 1;
const shift = (
  start: string,
  end: string,
  overrides: Partial<ScheduledShift> = {},
): ScheduledShift => ({
  id: nextId++,
  org_id: "org_1",
  user_id: "u1",
  shift_start: new Date(start),
  shift_end: new Date(end),
  note: null,
  created_by: "admin",
  ...overrides,
});

const member = {
  userId: "u1",
  name: "Ada",
  email: "ada@x.test",
  isAdmin: false,
};

// Sunday Nov 1 2026, 6:00 PM in Regina.
const sundayEvening = new Date("2026-11-02T00:00:00Z");

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.dbGetAlertSettingsFor.mockResolvedValue([]);
  mocks.dbGetNotificationPreferencesFor.mockResolvedValue([]);
  mocks.loadOrgMembers.mockResolvedValue([member]);
  mocks.dbClaimAlert.mockResolvedValue(true);
  mocks.deliver.mockResolvedValue({ email: 1, push: 1 });
});

describe("formatting", () => {
  it("resolves the first valid zone, else falls back to UTC", () => {
    expect(resolveTimezone(null, "bogus", "America/Regina")).toEqual(REGINA);
    expect(resolveTimezone(undefined, null)).toEqual({
      tz: FALLBACK_TIMEZONE,
      known: false,
    });
  });

  it("words a shift range in the person's zone", () => {
    expect(
      formatShiftRange(
        new Date("2026-11-02T15:00:00Z"),
        new Date("2026-11-02T23:00:00Z"),
        REGINA,
      ),
    ).toBe("Mon, Nov 2, 9:00 AM – 5:00 PM");
  });

  it("adds the end date for overnight shifts and the zone when guessed", () => {
    expect(
      formatShiftRange(
        new Date("2026-11-02T22:00:00Z"),
        new Date("2026-11-03T06:00:00Z"),
        UTC_GUESS,
      ),
    ).toBe("Mon, Nov 2, 10:00 PM – Tue, Nov 3, 6:00 AM UTC");
  });

  it("rounds hours to one decimal", () => {
    expect(formatHours(7.5 * 3_600_000)).toBe("7.5h");
    expect(formatHours(8 * 3_600_000 + 1000)).toBe("8h");
  });
});

describe("describeShiftChange", () => {
  const s = shift("2026-11-02T15:00:00Z", "2026-11-02T23:00:00Z", {
    id: 7,
    note: "Front desk",
  });

  it("announces an added shift with its note", () => {
    expect(describeShiftChange("added", s, REGINA)).toEqual({
      title: "New shift: Mon, Nov 2",
      body: "You're scheduled Mon, Nov 2, 9:00 AM – 5:00 PM. Note: Front desk",
      url: "/?defaultTab=schedule",
      tag: "shift-added:7",
    });
  });

  it("announces a removed shift", () => {
    expect(
      describeShiftChange("removed", { ...s, note: null }, REGINA),
    ).toEqual({
      title: "Shift cancelled: Mon, Nov 2",
      body: "Your shift Mon, Nov 2, 9:00 AM – 5:00 PM was removed from the schedule.",
      url: "/?defaultTab=schedule",
      tag: "shift-removed:7",
    });
  });
});

describe("notifyScheduleChange", () => {
  const now = new Date("2026-11-01T12:00:00Z");
  const upcoming = shift("2026-11-02T15:00:00Z", "2026-11-02T23:00:00Z");

  it("tells the member, in their own zone", async () => {
    mocks.dbGetNotificationPreferencesFor.mockResolvedValue([
      { user_id: "u1", timezone: "America/Regina" },
    ]);
    await expect(
      notifyScheduleChange("added", upcoming, "Europe/London", now),
    ).resolves.toBe(true);
    const [delivery] = mocks.deliver.mock.calls[0][0];
    expect(delivery).toMatchObject({
      recipient: { userId: "u1", email: "ada@x.test" },
      category: "schedule_alerts",
      message: { title: "New shift: Mon, Nov 2" },
    });
    expect(delivery.message.body).toContain("9:00 AM");
  });

  it("falls back to the admin's zone", async () => {
    await notifyScheduleChange("removed", upcoming, "America/Regina", now);
    expect(mocks.deliver.mock.calls[0][0][0].message.body).toContain(
      "9:00 AM – 5:00 PM was removed",
    );
  });

  it("skips past shifts, self-scheduled shifts, and leavers", async () => {
    const past = shift("2026-10-01T15:00:00Z", "2026-10-01T23:00:00Z");
    await expect(
      notifyScheduleChange("removed", past, null, now),
    ).resolves.toBe(false);
    const self = { ...upcoming, created_by: "u1" };
    await expect(notifyScheduleChange("added", self, null, now)).resolves.toBe(
      false,
    );
    mocks.loadOrgMembers.mockResolvedValueOnce([]);
    await expect(
      notifyScheduleChange("added", upcoming, null, now),
    ).resolves.toBe(false);
    expect(mocks.deliver).not.toHaveBeenCalled();
  });

  it("respects an org that turned schedule notices off", async () => {
    mocks.dbGetAlertSettingsFor.mockResolvedValue([
      { org_id: "org_1", schedule_notifications: false },
    ]);
    await expect(
      notifyScheduleChange("added", upcoming, null, now),
    ).resolves.toBe(false);
    expect(mocks.deliver).not.toHaveBeenCalled();
  });

  it("never throws, and defaults to the current time", async () => {
    mocks.loadOrgMembers.mockRejectedValueOnce(new Error("clerk down"));
    const future = shift("2099-01-01T15:00:00Z", "2099-01-01T23:00:00Z");
    await expect(notifyScheduleChange("added", future)).resolves.toBe(false);
  });
});

describe("planWeeklyDigests", () => {
  const nextWeek = [
    shift("2026-11-02T15:00:00Z", "2026-11-02T23:00:00Z"), // Mon
    shift("2026-11-08T15:00:00Z", "2026-11-08T23:00:00Z"), // Sun
  ];
  const followingWeek = shift("2026-11-09T15:00:00Z", "2026-11-09T23:00:00Z");
  const zones = new Map([["u1", "America/Regina"]]);

  it("plans next Mon–Sun on Sunday evening in the member's zone", () => {
    const [digest, ...rest] = planWeeklyDigests(
      [...nextWeek, followingWeek],
      zones,
      sundayEvening,
    );
    expect(rest).toEqual([]);
    expect(digest).toMatchObject({
      orgId: "org_1",
      userId: "u1",
      weekOf: "2026-11-02",
      zone: REGINA,
    });
    expect(digest.shifts).toEqual(nextWeek);
  });

  it("waits until the digest hour, and only runs on Sunday", () => {
    // 4:00 PM Sunday in Regina.
    const early = new Date(
      sundayEvening.getTime() - (18 - DIGEST_HOUR + 1) * 3_600_000,
    );
    expect(planWeeklyDigests(nextWeek, zones, early)).toEqual([]);
    // Monday.
    const monday = new Date("2026-11-03T00:00:00Z");
    expect(planWeeklyDigests(nextWeek, zones, monday)).toEqual([]);
  });

  it("skips members with nothing next week and groups per org and member", () => {
    const other = shift("2026-11-03T15:00:00Z", "2026-11-03T23:00:00Z", {
      org_id: "org_2",
      user_id: "u2",
    });
    // u2 has no known zone: Sunday 5 PM UTC has passed too (it's 00:00 Mon
    // UTC), so they're judged in UTC, where it's already Monday.
    expect(
      planWeeklyDigests([followingWeek, other], zones, sundayEvening),
    ).toEqual([]);
    const sameUser = shift("2026-11-04T15:00:00Z", "2026-11-04T23:00:00Z");
    expect(
      planWeeklyDigests([...nextWeek, sameUser], zones, sundayEvening)[0]
        .shifts,
    ).toHaveLength(3);
  });
});

describe("describeWeeklyDigest", () => {
  it("summarises the week with a line per shift", () => {
    const message = describeWeeklyDigest({
      orgId: "org_1",
      userId: "u1",
      zone: REGINA,
      weekOf: "2026-11-02",
      shifts: [
        shift("2026-11-02T15:00:00Z", "2026-11-02T23:00:00Z", {
          note: "Opening",
        }),
        shift("2026-11-03T15:00:00Z", "2026-11-03T22:30:00Z"),
      ],
    });
    expect(message).toEqual({
      title: "Your schedule for Nov 2 – Nov 8",
      body: "2 shifts, 15.5h scheduled next week. First up: Mon, Nov 2, 9:00 AM – 5:00 PM (Opening).",
      url: "/?defaultTab=schedule",
      tag: "week:2026-11-02",
      lines: [
        "Mon, Nov 2, 9:00 AM – 5:00 PM (Opening)",
        "Tue, Nov 3, 9:00 AM – 4:30 PM",
      ],
    });
  });

  it("uses the singular for one shift", () => {
    const message = describeWeeklyDigest({
      orgId: "org_1",
      userId: "u1",
      zone: REGINA,
      weekOf: "2026-11-02",
      shifts: [shift("2026-11-02T15:00:00Z", "2026-11-02T23:00:00Z")],
    });
    expect(message.body).toMatch(/^1 shift, 8h/);
  });
});

describe("runWeeklyScheduleDigests", () => {
  const due = shift("2026-11-02T15:00:00Z", "2026-11-02T23:00:00Z");

  beforeEach(() => {
    mocks.dbGetNotificationPreferencesFor.mockResolvedValue([
      { user_id: "u1", timezone: "America/Regina" },
      { user_id: "u3", timezone: "America/Regina" },
    ]);
  });

  it("does nothing without upcoming shifts", async () => {
    mocks.dbGetScheduledShiftsBetween.mockResolvedValue([]);
    await expect(runWeeklyScheduleDigests(sundayEvening)).resolves.toEqual({
      digests: 0,
      emails: 0,
      pushes: 0,
    });
    expect(mocks.dbGetNotificationPreferencesFor).not.toHaveBeenCalled();
  });

  it("does nothing when nobody is due yet", async () => {
    mocks.dbGetScheduledShiftsBetween.mockResolvedValue([due]);
    const monday = new Date("2026-11-03T00:00:00Z");
    await expect(runWeeklyScheduleDigests(monday)).resolves.toMatchObject({
      digests: 0,
    });
    expect(mocks.dbGetAlertSettingsFor).not.toHaveBeenCalled();
  });

  it("sends each due digest once, skipping leavers, opted-out orgs and failing orgs", async () => {
    mocks.dbGetScheduledShiftsBetween.mockResolvedValue([
      due,
      // Already sent this week.
      { ...due, id: 101, user_id: "u3" },
      // No longer a member.
      { ...due, id: 102, user_id: "gone" },
      // Org turned schedule notices off.
      { ...due, id: 103, org_id: "org_off" },
      // Org whose member lookup fails.
      { ...due, id: 104, org_id: "org_err" },
    ]);
    mocks.dbGetNotificationPreferencesFor.mockResolvedValue([
      { user_id: "u1", timezone: "America/Regina" },
      { user_id: "u3", timezone: "America/Regina" },
      { user_id: "gone", timezone: "America/Regina" },
    ]);
    mocks.dbGetAlertSettingsFor.mockResolvedValue([
      { org_id: "org_off", schedule_notifications: false },
    ]);
    mocks.loadOrgMembers.mockImplementation(async (orgId: string) => {
      if (orgId === "org_err") throw new Error("clerk");
      return [member, { ...member, userId: "u3" }];
    });
    mocks.dbClaimAlert.mockImplementation(
      async (key: string) => !key.includes(":u3:"),
    );

    await expect(runWeeklyScheduleDigests(sundayEvening)).resolves.toEqual({
      digests: 1,
      emails: 1,
      pushes: 1,
    });
    expect(mocks.dbGetScheduledShiftsBetween).toHaveBeenCalledWith(
      sundayEvening,
      new Date(sundayEvening.getTime() + 9 * 86_400_000),
    );
    expect(mocks.dbClaimAlert).toHaveBeenCalledWith(
      "week:org_1:u1:2026-11-02",
      "org_1",
    );
    const [delivery] = mocks.deliver.mock.calls[0][0];
    expect(delivery).toMatchObject({
      recipient: { userId: "u1", email: "ada@x.test" },
      category: "schedule_alerts",
      message: { title: "Your schedule for Nov 2 – Nov 8" },
    });
    expect(mocks.loadOrgMembers).not.toHaveBeenCalledWith("org_off");
  });

  it("defaults to the current time", async () => {
    mocks.dbGetScheduledShiftsBetween.mockResolvedValue([]);
    await runWeeklyScheduleDigests();
    expect(mocks.dbGetScheduledShiftsBetween).toHaveBeenCalled();
  });
});
