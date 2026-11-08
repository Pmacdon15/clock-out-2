import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScheduledShift, ShiftRequest } from "@/lib/types";

const m = vi.hoisted(() => ({
  dbGetAlertSettingsFor: vi.fn(async () => [] as unknown[]),
  dbGetNotificationPreferencesFor: vi.fn(async () => [] as unknown[]),
  loadOrgMembers: vi.fn(),
  orgHasFeature: vi.fn(async () => true),
  deliver: vi.fn(async () => ({ email: 1, push: 0 })),
  mirrorShiftToGoogleCalendar: vi.fn(async () => undefined),
}));

vi.mock("@/lib/alerts-db", () => ({
  dbGetAlertSettingsFor: m.dbGetAlertSettingsFor,
  dbGetNotificationPreferencesFor: m.dbGetNotificationPreferencesFor,
}));
vi.mock("@/lib/alerts-runner", () => ({ loadOrgMembers: m.loadOrgMembers }));
vi.mock("@/lib/billing", () => ({
  NOTIFICATIONS_FEATURE: "notifications",
  orgHasFeature: m.orgHasFeature,
}));
vi.mock("@/lib/notify", () => ({ deliver: m.deliver }));
vi.mock("@/lib/google-calendar", () => ({
  mirrorShiftToGoogleCalendar: m.mirrorShiftToGoogleCalendar,
}));
vi.mock("@/lib/schedule-notify", () => ({
  formatShiftRange: () => "Sat, Jan 5, 9:00 AM – 5:00 PM",
  resolveTimezone: (...zones: (string | null | undefined)[]) => {
    const tz = zones.find(Boolean);
    return tz ? { tz, known: true } : { tz: "UTC", known: false };
  },
}));
vi.mock("@/lib/db", () => ({}));
vi.mock("@/lib/shift-requests-db", () => ({}));

import {
  describeShiftRequestEvent,
  mirrorReassignedShifts,
  notifyShiftRequest,
  shiftRequestRecipients,
} from "@/lib/shift-request-notify";

const members = [
  { userId: "mgr", name: "Morgan", email: "m@x.com", isAdmin: true },
  { userId: "amy", name: "Amy", email: "a@x.com", isAdmin: false },
  { userId: "ben", name: "Ben", email: null, isAdmin: false },
  { userId: "cat", name: "Cat", email: "c@x.com", isAdmin: false },
];
const names = new Map(members.map((p) => [p.userId, p.name]));
const zone = { tz: "UTC", known: true };
const shift = {
  shift_start: "2030-01-05T09:00:00Z",
  shift_end: "2030-01-05T17:00:00Z",
};

const request = (over: Partial<ShiftRequest> = {}): ShiftRequest => ({
  id: 7,
  org_id: "o1",
  request_type: "offer",
  shift_id: 1,
  swap_shift_id: null,
  requested_by: "amy",
  target_user_id: null,
  claimed_by: null,
  note: null,
  status: "open",
  claimed_at: null,
  reviewed_by: null,
  reviewed_at: null,
  review_note: null,
  cancelled_by: null,
  ...over,
});

const ids = (list: { userId: string }[]) => list.map((p) => p.userId);

describe("shiftRequestRecipients", () => {
  it("sends a new open offer to everyone else", () => {
    expect(
      ids(shiftRequestRecipients("created", request(), members, "amy")),
    ).toEqual(["mgr", "ben", "cat"]);
    expect(
      ids(
        shiftRequestRecipients(
          "created",
          request({ target_user_id: "ben" }),
          members,
          "amy",
        ),
      ),
    ).toEqual(["ben"]);
  });

  it("tells the requester, taker and admins about a claim", () => {
    expect(
      ids(
        shiftRequestRecipients(
          "claimed",
          request({ claimed_by: "ben" }),
          members,
          "ben",
        ),
      ),
    ).toEqual(["mgr", "amy"]);
    expect(
      ids(shiftRequestRecipients("claimed", request(), members, "amy")),
    ).toEqual(["mgr"]);
  });

  it("tells everyone involved about a decision", () => {
    expect(
      ids(
        shiftRequestRecipients(
          "approved",
          request({
            request_type: "pickup",
            requested_by: "ben",
            target_user_id: "amy",
            claimed_by: "ben",
          }),
          members,
          "mgr",
        ),
      ),
    ).toEqual(["amy", "ben"]);
    expect(
      ids(shiftRequestRecipients("cancelled", request(), members, "amy")),
    ).toEqual([]);
  });
});

describe("describeShiftRequestEvent", () => {
  const amy = members[1];
  const mgr = members[0];
  const say = (
    event: Parameters<typeof describeShiftRequestEvent>[0],
    over: Partial<ShiftRequest> = {},
    to = amy,
  ) => describeShiftRequestEvent(event, request(over), shift, names, to, zone);

  it("words each kind of new request", () => {
    expect(say("created", { note: "Help" })).toMatchObject({
      title: "Shift up for grabs",
      body: expect.stringMatching(/Amy is offering.*Note: Help/),
      url: "/schedule",
      tag: "shift-request:7:created",
    });
    expect(say("created", { request_type: "swap" }).title).toBe(
      "Shift swap request",
    );
    expect(
      say("created", { request_type: "pickup", requested_by: "zzz" }).body,
    ).toMatch(/^A coworker would like to take your shift/);
  });

  it("asks admins to approve a claim, and tells the members it's waiting", () => {
    expect(say("claimed", { claimed_by: "ben" }, mgr)).toMatchObject({
      title: "Shift change needs approval",
      body: expect.stringMatching(/Amy and Ben agreed to a shift change/),
    });
    expect(
      say("claimed", { claimed_by: "ben", request_type: "swap" }, mgr).body,
    ).toMatch(/agreed to a swap/);
    expect(say("claimed", { claimed_by: "ben" }).title).toBe(
      "Shift request accepted",
    );
    // An admin who made the request hears it was accepted.
    expect(
      say("claimed", { requested_by: "mgr", claimed_by: "ben" }, mgr).title,
    ).toBe("Shift request accepted");
  });

  it("words decisions and cancellations", () => {
    expect(say("approved")).toMatchObject({
      title: "Shift change approved",
      body: expect.stringMatching(/shift change for/),
    });
    expect(
      say("approved", { request_type: "swap", review_note: "OK" }).body,
    ).toMatch(/swap for .* Note: OK$/);
    expect(say("denied").body).not.toMatch(/Note/);
    expect(say("denied", { review_note: "Too many hours" }).body).toMatch(
      /Note: Too many hours$/,
    );
    expect(say("cancelled").title).toBe("Shift request withdrawn");
  });
});

describe("notifyShiftRequest", () => {
  beforeEach(() => {
    m.loadOrgMembers.mockResolvedValue(members);
    m.dbGetAlertSettingsFor.mockResolvedValue([]);
    m.orgHasFeature.mockResolvedValue(true);
  });

  it("delivers to each recipient in their own zone", async () => {
    m.dbGetNotificationPreferencesFor.mockResolvedValueOnce([
      { user_id: "ben", timezone: "America/Toronto" },
    ]);
    await expect(
      notifyShiftRequest(
        "created",
        request({ target_user_id: "ben" }),
        shift,
        "amy",
        "UTC",
      ),
    ).resolves.toBe(1);
    expect(m.dbGetNotificationPreferencesFor).toHaveBeenCalledWith(["ben"]);
    expect(m.deliver).toHaveBeenCalledWith([
      {
        recipient: { userId: "ben", email: null },
        category: "schedule_alerts",
        message: expect.objectContaining({ title: "Shift up for grabs" }),
      },
    ]);
  });

  it("stays quiet when notices are off, unpaid, or nobody needs telling", async () => {
    m.dbGetAlertSettingsFor.mockResolvedValueOnce([
      { org_id: "o1", schedule_notifications: false },
    ]);
    expect(await notifyShiftRequest("created", request(), shift, "amy")).toBe(
      0,
    );
    m.orgHasFeature.mockResolvedValueOnce(false);
    expect(await notifyShiftRequest("created", request(), shift, "amy")).toBe(
      0,
    );
    expect(await notifyShiftRequest("cancelled", request(), shift, "amy")).toBe(
      0,
    );
    expect(m.deliver).not.toHaveBeenCalled();
  });

  it("never throws", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    m.loadOrgMembers.mockRejectedValueOnce(new Error("clerk down"));
    expect(await notifyShiftRequest("created", request(), shift, "amy")).toBe(
      0,
    );
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("mirrorReassignedShifts", () => {
  const s = (userId: string) =>
    ({ id: 1, user_id: userId }) as unknown as ScheduledShift;

  it("removes the old owner's event and adds the new owner's", async () => {
    await mirrorReassignedShifts([s("amy")], [s("ben")]);
    expect(m.mirrorShiftToGoogleCalendar.mock.calls).toEqual([
      ["removed", s("amy")],
      ["added", s("ben")],
    ]);
  });

  it("logs failures instead of throwing", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    m.mirrorShiftToGoogleCalendar.mockRejectedValueOnce(new Error("nope"));
    await expect(
      mirrorReassignedShifts([s("amy")], []),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
