import { describe, expect, it } from "vitest";
import {
  BREAK_TYPE_VALUES,
  breakTypeLabel,
  DEFAULT_BREAK_TYPE,
  getBreakDurationMs,
  getDockedMinutes,
  getEffectiveDurationMs,
  getEffectiveHours,
  getOpenBreak,
  getPaidBreakMs,
  getUnpaidBreakMs,
  hasUnpaidBreakRecord,
  isBreakType,
  isPaidBreakType,
  validateBreak,
} from "@/lib/break-utils";
import type { BreakSettingsData, TimeEntryBreak } from "@/lib/types";
import { makeBreak, makeEntry } from "../utils";

const activeBreakSettings: BreakSettingsData = {
  org_id: "org_1",
  dock_lunch: true,
  lunch_duration_minutes: 30,
  lunch_min_shift_hours: 5,
};

describe("break-utils", () => {
  it("returns 0 docked minutes when break settings are absent or disabled", () => {
    const shift = makeEntry({
      clock_in: new Date("2026-01-05T09:00:00Z"),
      clock_out: new Date("2026-01-05T17:00:00Z"),
    });
    expect(getDockedMinutes(shift)).toBe(0);
    expect(getDockedMinutes(shift, null)).toBe(0);
    expect(
      getDockedMinutes(shift, { ...activeBreakSettings, dock_lunch: false }),
    ).toBe(0);
    expect(getEffectiveHours(shift, null)).toBe(8);
  });

  it("returns 0 docked minutes when the shift is marked skip_lunch (not docked)", () => {
    const shift = makeEntry({
      clock_in: new Date("2026-01-05T09:00:00Z"),
      clock_out: new Date("2026-01-05T17:00:00Z"),
      skip_lunch: true,
    });
    expect(getDockedMinutes(shift, activeBreakSettings)).toBe(0);
    expect(getEffectiveHours(shift, activeBreakSettings)).toBe(8);
  });

  it("returns 0 docked minutes when lunch_duration_minutes is 0 or negative", () => {
    const shift = makeEntry({
      clock_in: new Date("2026-01-05T09:00:00Z"),
      clock_out: new Date("2026-01-05T17:00:00Z"),
    });
    expect(
      getDockedMinutes(shift, {
        ...activeBreakSettings,
        lunch_duration_minutes: 0,
      }),
    ).toBe(0);
  });

  it("returns 0 docked minutes when the shift is shorter than lunch_min_shift_hours", () => {
    const shortShift = makeEntry({
      clock_in: new Date("2026-01-05T09:00:00Z"),
      clock_out: new Date("2026-01-05T13:30:00Z"), // 4.5 hours < 5 hours
    });
    expect(getDockedMinutes(shortShift, activeBreakSettings)).toBe(0);
    expect(getEffectiveHours(shortShift, activeBreakSettings)).toBe(4.5);
  });

  it("docks the configured minutes when the shift meets or exceeds lunch_min_shift_hours", () => {
    const fullShift = makeEntry({
      clock_in: new Date("2026-01-05T09:00:00Z"),
      clock_out: new Date("2026-01-05T17:00:00Z"), // 8 hours
    });
    expect(getDockedMinutes(fullShift, activeBreakSettings)).toBe(30);
    expect(getEffectiveDurationMs(fullShift, activeBreakSettings)).toBe(
      7.5 * 3_600_000,
    );
    expect(getEffectiveHours(fullShift, activeBreakSettings)).toBe(7.5);
  });

  it("evaluates open shifts against the provided nowMs timestamp", () => {
    const openShift = makeEntry({
      clock_in: new Date("2026-01-05T09:00:00Z"),
      clock_out: null,
    });
    const sixHoursLater = new Date("2026-01-05T15:00:00Z").getTime();
    expect(
      getDockedMinutes(openShift, activeBreakSettings, sixHoursLater),
    ).toBe(30);
    expect(
      getEffectiveHours(openShift, activeBreakSettings, sixHoursLater),
    ).toBe(5.5);
  });

  it("clamps effective duration at 0 if docked minutes exceed shift length", () => {
    const tinyShift = makeEntry({
      clock_in: new Date("2026-01-05T09:00:00Z"),
      clock_out: new Date("2026-01-05T09:15:00Z"),
    });
    const settings: BreakSettingsData = {
      org_id: "org_1",
      dock_lunch: true,
      lunch_duration_minutes: 30,
      lunch_min_shift_hours: 0,
    };
    expect(getEffectiveDurationMs(tinyShift, settings)).toBe(0);
    expect(getEffectiveHours(tinyShift, settings)).toBe(0);
  });
});

describe("break types", () => {
  it("knows which types exist and which are paid", () => {
    expect(BREAK_TYPE_VALUES).toEqual([
      "unpaid_meal",
      "unpaid_rest",
      "paid_rest",
    ]);
    expect(DEFAULT_BREAK_TYPE).toBe("unpaid_meal");
    expect(isBreakType("unpaid_meal")).toBe(true);
    expect(isBreakType("coffee")).toBe(false);
    expect(isBreakType(7)).toBe(false);
    expect(isPaidBreakType("paid_rest")).toBe(true);
    expect(isPaidBreakType("unpaid_meal")).toBe(false);
    expect(isPaidBreakType("unpaid_rest")).toBe(false);
    expect(breakTypeLabel("unpaid_meal")).toBe("Meal period");
    expect(breakTypeLabel("paid_rest")).toBe("Paid rest break");
  });

  it("treats an unknown type as paid so it never cuts hours", () => {
    expect(isPaidBreakType("mystery")).toBe(true);
    expect(breakTypeLabel("mystery")).toBe("Break");
    const shift = makeEntry({
      clock_in: new Date("2026-01-05T09:00:00Z"),
      clock_out: new Date("2026-01-05T17:00:00Z"),
      breaks: [
        makeBreak({
          break_type: "mystery" as never,
          break_start: new Date("2026-01-05T12:00:00Z"),
          break_end: new Date("2026-01-05T13:00:00Z"),
        }),
      ],
    });
    expect(getUnpaidBreakMs(shift)).toBe(0);
    expect(getEffectiveHours(shift, null)).toBe(8);
  });
});

describe("break durations", () => {
  it("measures a closed break from its own timestamps", () => {
    expect(
      getBreakDurationMs(
        makeBreak({
          break_start: new Date("2026-01-05T12:00:00Z"),
          break_end: new Date("2026-01-05T12:45:00Z"),
        }),
      ),
    ).toBe(45 * 60_000);
  });

  it("measures a running break up to nowMs and never goes negative", () => {
    const running = makeBreak({
      break_start: new Date("2026-01-05T12:00:00Z"),
      break_end: null,
    });
    expect(
      getBreakDurationMs(running, new Date("2026-01-05T12:20:00Z").getTime()),
    ).toBe(20 * 60_000);
    expect(
      getBreakDurationMs(running, new Date("2026-01-05T11:00:00Z").getTime()),
    ).toBe(0);
  });

  it("finds the running break of an entry", () => {
    const open = makeBreak({ break_end: null });
    expect(getOpenBreak({ breaks: [makeBreak(), open] })).toBe(open);
    expect(getOpenBreak({ breaks: [makeBreak()] })).toBeUndefined();
    expect(getOpenBreak(null)).toBeUndefined();
  });
});

describe("unpaid breaks and worked hours", () => {
  const shiftWith = (breaks: TimeEntryBreak[]) =>
    makeEntry({
      clock_in: new Date("2026-01-05T09:00:00Z"),
      clock_out: new Date("2026-01-05T17:00:00Z"),
      breaks,
    });

  it("subtracts unpaid breaks and keeps paid ones", () => {
    const shift = shiftWith([
      makeBreak({
        break_type: "unpaid_meal",
        break_start: new Date("2026-01-05T12:00:00Z"),
        break_end: new Date("2026-01-05T12:30:00Z"),
      }),
      makeBreak({
        break_type: "paid_rest",
        break_start: new Date("2026-01-05T15:00:00Z"),
        break_end: new Date("2026-01-05T15:15:00Z"),
      }),
    ]);
    expect(getUnpaidBreakMs(shift)).toBe(30 * 60_000);
    expect(getPaidBreakMs(shift)).toBe(15 * 60_000);
    expect(getEffectiveHours(shift, null)).toBe(7.5);
  });

  it("adds up several unpaid breaks", () => {
    const shift = shiftWith([
      makeBreak({
        break_type: "unpaid_meal",
        break_start: new Date("2026-01-05T12:00:00Z"),
        break_end: new Date("2026-01-05T12:30:00Z"),
      }),
      makeBreak({
        break_type: "unpaid_rest",
        break_start: new Date("2026-01-05T15:00:00Z"),
        break_end: new Date("2026-01-05T15:15:00Z"),
      }),
    ]);
    expect(getUnpaidBreakMs(shift)).toBe(45 * 60_000);
    expect(getEffectiveHours(shift, null)).toBe(7.25);
  });

  it("counts a running unpaid break up to nowMs", () => {
    const openShift = makeEntry({
      clock_in: new Date("2026-01-05T09:00:00Z"),
      clock_out: null,
      breaks: [
        makeBreak({
          break_start: new Date("2026-01-05T12:00:00Z"),
          break_end: null,
        }),
      ],
    });
    const now = new Date("2026-01-05T12:30:00Z").getTime();
    expect(getUnpaidBreakMs(openShift, now)).toBe(30 * 60_000);
    expect(getEffectiveHours(openShift, null, now)).toBe(3);
  });

  it("clamps break time to the shift window and ignores unparsable rows", () => {
    const shift = shiftWith([
      // Starts before the clock-in and ends after the clock-out.
      makeBreak({
        break_start: new Date("2026-01-05T08:00:00Z"),
        break_end: new Date("2026-01-05T18:00:00Z"),
      }),
      makeBreak({
        break_start: "not-a-date" as unknown as Date,
        break_end: new Date("2026-01-05T16:00:00Z"),
      }),
    ]);
    expect(getUnpaidBreakMs(shift)).toBe(8 * 3_600_000);
    expect(getEffectiveHours(shift, null)).toBe(0);
  });
});

describe("unpaid breaks vs. the automatic lunch dock", () => {
  const eightHourShift = (breaks: TimeEntryBreak[]) =>
    makeEntry({
      clock_in: new Date("2026-01-05T09:00:00Z"),
      clock_out: new Date("2026-01-05T17:00:00Z"),
      breaks,
    });

  it("drops the automatic dock once the shift records an unpaid break", () => {
    const shift = eightHourShift([
      makeBreak({
        break_type: "unpaid_meal",
        break_start: new Date("2026-01-05T12:00:00Z"),
        break_end: new Date("2026-01-05T13:00:00Z"),
      }),
    ]);
    expect(hasUnpaidBreakRecord(shift)).toBe(true);
    // 30m dock would otherwise apply; the recorded hour replaces it.
    expect(getDockedMinutes(shift, activeBreakSettings)).toBe(0);
    expect(getEffectiveHours(shift, activeBreakSettings)).toBe(7);
  });

  it("still docks a shift whose only breaks are paid", () => {
    const shift = eightHourShift([
      makeBreak({
        break_type: "paid_rest",
        break_start: new Date("2026-01-05T15:00:00Z"),
        break_end: new Date("2026-01-05T15:15:00Z"),
      }),
    ]);
    expect(hasUnpaidBreakRecord(shift)).toBe(false);
    expect(getDockedMinutes(shift, activeBreakSettings)).toBe(30);
    expect(getEffectiveHours(shift, activeBreakSettings)).toBe(7.5);
  });

  it("keeps skip_lunch winning over everything", () => {
    const shift = eightHourShift([]);
    shift.skip_lunch = true;
    expect(getDockedMinutes(shift, activeBreakSettings)).toBe(0);
    expect(getEffectiveHours(shift, activeBreakSettings)).toBe(8);
  });

  it("docks nothing but still deducts unpaid breaks when docking is off", () => {
    const shift = eightHourShift([
      makeBreak({
        break_start: new Date("2026-01-05T12:00:00Z"),
        break_end: new Date("2026-01-05T12:30:00Z"),
      }),
    ]);
    const off = { ...activeBreakSettings, dock_lunch: false };
    expect(getDockedMinutes(shift, off)).toBe(0);
    expect(getEffectiveHours(shift, off)).toBe(7.5);
  });
});

describe("validateBreak", () => {
  const entry = {
    clock_in: new Date("2026-01-05T09:00:00Z"),
    clock_out: new Date("2026-01-05T17:00:00Z"),
  };
  const openEntry = { clock_in: entry.clock_in, clock_out: null };

  it("accepts a break inside the shift that overlaps nothing", () => {
    expect(
      validateBreak({
        entry,
        breaks: [
          makeBreak({
            id: 1,
            break_start: new Date("2026-01-05T10:00:00Z"),
            break_end: new Date("2026-01-05T10:15:00Z"),
          }),
        ],
        break_start: new Date("2026-01-05T12:00:00Z"),
        break_end: new Date("2026-01-05T12:30:00Z"),
        break_type: "unpaid_meal",
      }),
    ).toBeNull();
  });

  it("accepts a running break on an open shift", () => {
    expect(
      validateBreak({
        entry: openEntry,
        break_start: new Date("2026-01-05T12:00:00Z"),
      }),
    ).toBeNull();
  });

  it("rejects an unknown break type", () => {
    expect(
      validateBreak({
        entry,
        break_start: new Date("2026-01-05T12:00:00Z"),
        break_end: new Date("2026-01-05T12:30:00Z"),
        break_type: "siesta",
      }),
    ).toBe("Unknown break type");
  });

  it("rejects unparsable timestamps", () => {
    expect(
      validateBreak({ entry, break_start: "nope" as unknown as Date }),
    ).toBe("Invalid break start or end time");
    expect(
      validateBreak({
        entry,
        break_start: new Date("2026-01-05T12:00:00Z"),
        break_end: "nope" as unknown as Date,
      }),
    ).toBe("Invalid break start or end time");
    expect(
      validateBreak({
        entry: { clock_in: "nope" as unknown as Date, clock_out: null },
        break_start: new Date("2026-01-05T12:00:00Z"),
      }),
    ).toBe("Invalid clock-in time");
  });

  it("rejects an end that is not after the start", () => {
    expect(
      validateBreak({
        entry,
        break_start: new Date("2026-01-05T12:00:00Z"),
        break_end: new Date("2026-01-05T12:00:00Z"),
      }),
    ).toBe("Break end must be after break start");
  });

  it("rejects a break outside the shift's window", () => {
    expect(
      validateBreak({
        entry,
        break_start: new Date("2026-01-05T08:30:00Z"),
        break_end: new Date("2026-01-05T09:30:00Z"),
      }),
    ).toBe("Break cannot start before the shift's clock-in");
    expect(
      validateBreak({
        entry,
        break_start: new Date("2026-01-05T16:30:00Z"),
        break_end: new Date("2026-01-05T17:30:00Z"),
      }),
    ).toBe("Break must be inside the shift's clock-in and clock-out");
    expect(
      validateBreak({
        entry,
        break_start: new Date("2026-01-05T17:30:00Z"),
        break_end: new Date("2026-01-05T17:45:00Z"),
      }),
    ).toBe("Break must be inside the shift's clock-in and clock-out");
  });

  it("refuses to leave a break open on a closed shift", () => {
    expect(
      validateBreak({ entry, break_start: new Date("2026-01-05T12:00:00Z") }),
    ).toBe("Cannot leave a break open on a closed shift");
  });

  it("refuses a second break while one is running", () => {
    expect(
      validateBreak({
        entry: openEntry,
        breaks: [
          makeBreak({
            id: 2,
            break_start: new Date("2026-01-05T11:00:00Z"),
            break_end: null,
          }),
        ],
        break_start: new Date("2026-01-05T12:00:00Z"),
      }),
    ).toBe("A break is already running");
  });

  it("rejects overlapping breaks, including with a running one", () => {
    const existing = makeBreak({
      id: 3,
      break_start: new Date("2026-01-05T12:00:00Z"),
      break_end: new Date("2026-01-05T12:30:00Z"),
    });
    expect(
      validateBreak({
        entry,
        breaks: [existing],
        break_start: new Date("2026-01-05T12:15:00Z"),
        break_end: new Date("2026-01-05T12:45:00Z"),
      }),
    ).toBe("Break overlaps another break on this entry");
    expect(
      validateBreak({
        entry: openEntry,
        breaks: [
          makeBreak({
            id: 4,
            break_start: new Date("2026-01-05T12:00:00Z"),
            break_end: null,
          }),
        ],
        break_start: new Date("2026-01-05T13:00:00Z"),
        break_end: new Date("2026-01-05T13:30:00Z"),
      }),
    ).toBe("Break overlaps another break on this entry");
  });

  it("does not compare the edited break against itself", () => {
    const existing = makeBreak({
      id: 5,
      break_start: new Date("2026-01-05T12:00:00Z"),
      break_end: new Date("2026-01-05T12:30:00Z"),
    });
    expect(
      validateBreak({
        entry,
        breaks: [existing],
        break_start: new Date("2026-01-05T12:05:00Z"),
        break_end: new Date("2026-01-05T12:35:00Z"),
        excludeBreakId: 5,
      }),
    ).toBeNull();
  });
});
