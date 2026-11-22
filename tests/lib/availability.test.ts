import { describe, expect, it } from "vitest";
import {
  availabilityConflictMessage,
  describeWindow,
  endMinuteFor,
  findAvailabilityConflict,
  formatMinuteOfDay,
  formatWindowTimes,
  invalidAvailabilityReason,
  isAllDay,
  isAvailabilityKind,
  type NewAvailabilityInput,
  parseTimeOfDay,
  sortWindows,
  windowsFor,
} from "@/lib/availability";
import type { AvailabilityWindow } from "@/lib/types";

let nextId = 1;
const win = (over: Partial<AvailabilityWindow> = {}): AvailabilityWindow => ({
  id: nextId++,
  org_id: "o1",
  user_id: "amy",
  kind: "unavailable",
  weekday: 1,
  start_minute: 9 * 60,
  end_minute: 17 * 60,
  timezone: "UTC",
  note: null,
  created_at: "2026-11-01T00:00:00Z",
  ...over,
});

// Mon 2026-11-23 is a Monday.
const at = (iso: string) => new Date(iso);

describe("parsing and formatting", () => {
  it("parses HH:MM times of day", () => {
    expect(parseTimeOfDay("09:30")).toBe(570);
    expect(parseTimeOfDay("00:00")).toBe(0);
    expect(parseTimeOfDay("24:00")).toBeNull();
    expect(parseTimeOfDay("12:60")).toBeNull();
    expect(parseTimeOfDay("9:30")).toBeNull();
  });

  it("treats a midnight end as the end of the day", () => {
    expect(endMinuteFor("00:00")).toBe(1440);
    expect(endMinuteFor("17:00")).toBe(1020);
    expect(endMinuteFor("bad")).toBeNull();
  });

  it("formats minutes as 12-hour times", () => {
    expect(formatMinuteOfDay(0)).toBe("12:00 AM");
    expect(formatMinuteOfDay(1440)).toBe("12:00 AM");
    expect(formatMinuteOfDay(9 * 60 + 5)).toBe("9:05 AM");
    expect(formatMinuteOfDay(12 * 60)).toBe("12:00 PM");
    expect(formatMinuteOfDay(17 * 60 + 30)).toBe("5:30 PM");
  });

  it("formats window times, all day and overnight", () => {
    expect(formatWindowTimes(win())).toBe("9:00 AM – 5:00 PM");
    expect(isAllDay(win({ start_minute: 0, end_minute: 1440 }))).toBe(true);
    expect(formatWindowTimes(win({ start_minute: 0, end_minute: 1440 }))).toBe(
      "All day",
    );
    expect(
      formatWindowTimes(win({ start_minute: 22 * 60, end_minute: 6 * 60 })),
    ).toBe("10:00 PM – 6:00 AM (next day)");
  });

  it("describes a window", () => {
    expect(describeWindow(win())).toBe(
      "Unavailable Mondays, 9:00 AM – 5:00 PM",
    );
    expect(describeWindow(win({ kind: "available", weekday: 0 }))).toBe(
      "Available Sundays, 9:00 AM – 5:00 PM",
    );
  });

  it("recognises kinds", () => {
    expect(isAvailabilityKind("available")).toBe(true);
    expect(isAvailabilityKind("unavailable")).toBe(true);
    expect(isAvailabilityKind("maybe")).toBe(false);
  });
});

describe("invalidAvailabilityReason", () => {
  const ok: NewAvailabilityInput = {
    kind: "available",
    weekdays: [1, 3],
    startMinute: 540,
    endMinute: 1020,
    timezone: "America/Toronto",
    note: "Classes",
  };

  it("accepts a valid window", () => {
    expect(invalidAvailabilityReason(ok)).toBeNull();
    expect(invalidAvailabilityReason({ ...ok, note: undefined })).toBeNull();
  });

  it.each([
    [{ kind: "maybe" as never }, "Choose available or unavailable"],
    [{ weekdays: [] }, "Choose at least one day"],
    [{ weekdays: "1" as never }, "Choose at least one day"],
    [{ weekdays: [7] }, "Choose at least one day"],
    [{ weekdays: [-1] }, "Choose at least one day"],
    [{ weekdays: [1.5] }, "Choose at least one day"],
    [{ startMinute: -1 }, "Invalid start time"],
    [{ startMinute: 1440 }, "Invalid start time"],
    [{ startMinute: 1.5 }, "Invalid start time"],
    [{ endMinute: 0 }, "Invalid end time"],
    [{ endMinute: 1441 }, "Invalid end time"],
    [{ endMinute: 2.5 }, "Invalid end time"],
    [{ endMinute: 540 }, "Start and end can't be the same time"],
    [{ timezone: "Mars/Olympus" }, "Invalid time zone"],
    [{ note: "x".repeat(201) }, "Note is too long"],
  ])("rejects %o", (over, reason) => {
    expect(invalidAvailabilityReason({ ...ok, ...over })).toBe(reason);
  });
});

describe("findAvailabilityConflict", () => {
  it("finds nothing without windows, or for an empty shift", () => {
    expect(
      findAvailabilityConflict(
        [],
        at("2026-11-23T10:00:00Z"),
        at("2026-11-23T12:00:00Z"),
      ),
    ).toBeNull();
    expect(
      findAvailabilityConflict(
        [win()],
        at("2026-11-23T10:00:00Z"),
        at("2026-11-23T10:00:00Z"),
      ),
    ).toBeNull();
  });

  it("flags a shift overlapping an unavailable window", () => {
    const blocked = win();
    expect(
      findAvailabilityConflict(
        [blocked],
        at("2026-11-23T16:00:00Z"),
        at("2026-11-23T20:00:00Z"),
      ),
    ).toEqual({ type: "unavailable", window: blocked });
  });

  it("lets a shift that only touches the window's edge through", () => {
    expect(
      findAvailabilityConflict(
        [win()],
        at("2026-11-23T17:00:00Z"),
        at("2026-11-23T21:00:00Z"),
      ),
    ).toBeNull();
    // Another weekday entirely.
    expect(
      findAvailabilityConflict(
        [win()],
        at("2026-11-24T10:00:00Z"),
        at("2026-11-24T12:00:00Z"),
      ),
    ).toBeNull();
  });

  it("works in the window's own time zone", () => {
    // 9–5 Monday in Toronto (UTC-5 in November) is 14:00–22:00 UTC.
    const toronto = win({ timezone: "America/Toronto" });
    expect(
      findAvailabilityConflict(
        [toronto],
        at("2026-11-23T10:00:00Z"),
        at("2026-11-23T13:00:00Z"),
      ),
    ).toBeNull();
    expect(
      findAvailabilityConflict(
        [toronto],
        at("2026-11-23T21:00:00Z"),
        at("2026-11-23T23:00:00Z"),
      ),
    ).toMatchObject({ type: "unavailable" });
  });

  it("falls back to UTC for an unknown zone", () => {
    expect(
      findAvailabilityConflict(
        [win({ timezone: "Mars/Olympus" })],
        at("2026-11-23T10:00:00Z"),
        at("2026-11-23T11:00:00Z"),
      ),
    ).toMatchObject({ type: "unavailable" });
  });

  it("handles overnight windows and windows that wrap the week", () => {
    // Saturday 22:00 – Sunday 06:00.
    const night = win({ weekday: 6, start_minute: 1320, end_minute: 360 });
    // Sunday 2026-11-22 at 03:00 is in last week's Saturday night.
    expect(
      findAvailabilityConflict(
        [night],
        at("2026-11-22T03:00:00Z"),
        at("2026-11-22T05:00:00Z"),
      ),
    ).toMatchObject({ type: "unavailable" });
    // Saturday 2026-11-28 at 23:00 runs into next week.
    expect(
      findAvailabilityConflict(
        [night],
        at("2026-11-28T23:00:00Z"),
        at("2026-11-29T01:00:00Z"),
      ),
    ).toMatchObject({ type: "unavailable" });
  });

  it("flags shifts outside the times a member is available", () => {
    const available = [
      win({
        kind: "available",
        weekday: 1,
        start_minute: 540,
        end_minute: 1020,
      }),
    ];
    expect(
      findAvailabilityConflict(
        available,
        at("2026-11-23T09:00:00Z"),
        at("2026-11-23T17:00:00Z"),
      ),
    ).toBeNull();
    expect(
      findAvailabilityConflict(
        available,
        at("2026-11-23T08:00:00Z"),
        at("2026-11-23T12:00:00Z"),
      ),
    ).toEqual({ type: "outside" });
    expect(
      findAvailabilityConflict(
        available,
        at("2026-11-23T12:00:00Z"),
        at("2026-11-23T18:00:00Z"),
      ),
    ).toEqual({ type: "outside" });
    // A day with no available window at all.
    expect(
      findAvailabilityConflict(
        available,
        at("2026-11-24T10:00:00Z"),
        at("2026-11-24T12:00:00Z"),
      ),
    ).toEqual({ type: "outside" });
  });

  it("joins back-to-back available windows, across midnight too", () => {
    const windows = [
      win({
        kind: "available",
        weekday: 1,
        start_minute: 1080,
        end_minute: 1440,
      }),
      win({ kind: "available", weekday: 2, start_minute: 0, end_minute: 360 }),
      win({
        kind: "available",
        weekday: 1,
        start_minute: 600,
        end_minute: 1100,
      }),
    ];
    expect(
      findAvailabilityConflict(
        windows,
        at("2026-11-23T12:00:00Z"),
        at("2026-11-24T04:00:00Z"),
      ),
    ).toBeNull();
    // A gap between 06:00 and the next window.
    expect(
      findAvailabilityConflict(
        windows,
        at("2026-11-23T20:00:00Z"),
        at("2026-11-24T08:00:00Z"),
      ),
    ).toEqual({ type: "outside" });
  });

  it("puts being unavailable ahead of being outside availability", () => {
    const blocked = win({ weekday: 2, start_minute: 0, end_minute: 1440 });
    expect(
      findAvailabilityConflict(
        [win({ kind: "available" }), blocked],
        at("2026-11-24T10:00:00Z"),
        at("2026-11-24T12:00:00Z"),
      ),
    ).toEqual({ type: "unavailable", window: blocked });
  });
});

describe("helpers", () => {
  it("picks out one member's windows", () => {
    const a = win({ user_id: "amy" });
    const b = win({ user_id: "bo" });
    expect(windowsFor([a, b], "bo")).toEqual([b]);
  });

  it("sorts by weekday, start, then id", () => {
    const a = win({ weekday: 2, start_minute: 60 });
    const b = win({ weekday: 1, start_minute: 120 });
    const c = win({ weekday: 1, start_minute: 60 });
    const d = win({ weekday: 1, start_minute: 60 });
    expect(sortWindows([a, b, d, c]).map((w) => w.id)).toEqual([
      c.id,
      d.id,
      b.id,
      a.id,
    ]);
  });

  it("words conflicts for the admin", () => {
    expect(
      availabilityConflictMessage("Amy", {
        type: "unavailable",
        window: win({ note: "Classes" }),
      }),
    ).toBe("Amy is unavailable Mondays, 9:00 AM – 5:00 PM (Classes).");
    expect(
      availabilityConflictMessage("Amy", {
        type: "unavailable",
        window: win({ start_minute: 0, end_minute: 1440 }),
      }),
    ).toBe("Amy is unavailable Mondays, all day.");
    expect(availabilityConflictMessage("Amy", { type: "outside" })).toBe(
      "This shift is outside the times Amy said they're available.",
    );
    expect(availabilityConflictMessage(undefined, { type: "outside" })).toBe(
      "This shift is outside the times This member said they're available.",
    );
  });
});
