import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  countShiftStatuses,
  EMPTY_SHIFT_FILTERS,
  evaluateShifts,
  filterShifts,
  findOverlappingShift,
  invalidShiftReason,
  isFlaggedStatus,
  LATE_GRACE_MINUTES,
  MAX_REPEAT_WEEKS,
  type ShiftFilters,
  timeOfDayFor,
  weeklyOccurrences,
} from "@/lib/schedule-utils";
import type {
  ScheduledShift,
  ScheduledShiftWithStatus,
  ShiftStatus,
} from "@/lib/types";
import { makeEntry } from "../utils";

const at = (iso: string) => new Date(`2026-01-05T${iso}:00Z`);

function shift(overrides: Partial<ScheduledShift> = {}): ScheduledShift {
  return {
    id: 1,
    org_id: "org_1",
    user_id: "user_1",
    shift_start: at("09:00"),
    shift_end: at("17:00"),
    note: null,
    created_by: "admin_1",
    ...overrides,
  };
}

describe("invalidShiftReason", () => {
  it("accepts a normal shift", () => {
    expect(invalidShiftReason(at("09:00"), at("17:00"))).toBeNull();
  });

  it.each([
    [new Date("nope"), at("17:00")],
    [at("09:00"), new Date("nope")],
  ])("rejects unparseable times", (start, end) => {
    expect(invalidShiftReason(start, end)).toBe("Invalid shift start or end");
  });

  it("rejects a shift that ends before it starts", () => {
    expect(invalidShiftReason(at("17:00"), at("09:00"))).toBe(
      "Shift must end after it starts",
    );
    expect(invalidShiftReason(at("09:00"), at("09:00"))).toBe(
      "Shift must end after it starts",
    );
  });

  it("rejects a shift longer than a day", () => {
    expect(
      invalidShiftReason(at("09:00"), new Date("2026-01-06T09:01:00Z")),
    ).toBe("Shifts can be at most 24 hours long");
  });
});

describe("isFlaggedStatus", () => {
  it("flags late arrivals and no-shows only", () => {
    expect(isFlaggedStatus("late")).toBe(true);
    expect(isFlaggedStatus("not_clocked_in")).toBe(true);
    expect(isFlaggedStatus("no_show")).toBe(true);
    expect(isFlaggedStatus("on_time")).toBe(false);
    expect(isFlaggedStatus("scheduled")).toBe(false);
  });
});

describe("evaluateShifts", () => {
  it("marks a clock-in within the grace period as on time", () => {
    const entry = makeEntry({
      clock_in: at(`09:0${LATE_GRACE_MINUTES}`),
      clock_out: at("17:00"),
    });
    const [result] = evaluateShifts([shift()], [entry], at("18:00"));
    expect(result).toMatchObject({
      status: "on_time",
      actual_clock_in: entry.clock_in,
      actual_clock_out: entry.clock_out,
      minutes_late: LATE_GRACE_MINUTES,
    });
  });

  it("marks an early clock-in as on time with no minutes late", () => {
    const entry = makeEntry({ clock_in: at("07:30"), clock_out: null });
    const [result] = evaluateShifts([shift()], [entry], at("10:00"));
    expect(result).toMatchObject({
      status: "on_time",
      minutes_late: 0,
      actual_clock_out: null,
    });
  });

  it("marks a clock-in after the grace period as late", () => {
    const entry = makeEntry({ clock_in: at("09:20"), clock_out: at("17:00") });
    const [result] = evaluateShifts([shift()], [entry], at("18:00"));
    expect(result).toMatchObject({ status: "late", minutes_late: 20 });
  });

  it("matches an entry that began well before the shift and was still open", () => {
    const longEntry = makeEntry({
      clock_in: at("05:00"),
      clock_out: at("12:00"),
    });
    const openEntry = makeEntry({ clock_in: at("05:00"), clock_out: null });
    expect(evaluateShifts([shift()], [longEntry], at("18:00"))[0].status).toBe(
      "on_time",
    );
    expect(evaluateShifts([shift()], [openEntry], at("18:00"))[0].status).toBe(
      "on_time",
    );
  });

  it("ignores entries outside the shift, for other members, or already used", () => {
    const entries = [
      // Finished long before the shift started.
      makeEntry({ clock_in: at("01:00"), clock_out: at("05:00") }),
      // After the shift ended.
      makeEntry({ clock_in: at("17:00"), clock_out: at("18:00") }),
      // Someone else.
      makeEntry({ user_id: "user_2", clock_in: at("09:00") }),
    ];
    const [result] = evaluateShifts([shift()], entries, at("18:00"));
    expect(result).toMatchObject({
      status: "no_show",
      actual_clock_in: null,
      actual_clock_out: null,
      minutes_late: null,
    });
  });

  it("uses one clock-in for one shift only", () => {
    const morning = shift({ id: 1, shift_end: at("12:00") });
    const afternoon = shift({
      id: 2,
      shift_start: at("12:30"),
      shift_end: at("16:00"),
    });
    const entry = makeEntry({ clock_in: at("08:55"), clock_out: null });
    // Passed out of order: results come back sorted by start.
    const results = evaluateShifts([afternoon, morning], [entry], at("14:00"));
    expect(results.map((r) => [r.id, r.status])).toEqual([
      [1, "on_time"],
      [2, "not_clocked_in"],
    ]);
  });

  it("orders shifts that start together by id and entries by clock-in", () => {
    const a = shift({ id: 2 });
    const b = shift({ id: 1, user_id: "user_2" });
    const later = makeEntry({ clock_in: at("09:30") });
    const earlier = makeEntry({ clock_in: at("09:00") });
    const results = evaluateShifts([a, b], [later, earlier], at("18:00"));
    expect(results.map((r) => r.id)).toEqual([1, 2]);
    expect(results[1]).toMatchObject({
      status: "on_time",
      actual_clock_in: earlier.clock_in,
    });
  });

  it("reports unmatched shifts by where now falls", () => {
    const s = shift();
    expect(evaluateShifts([s], [], at("08:00"))[0].status).toBe("scheduled");
    // Inside the grace period: not flagged yet.
    expect(evaluateShifts([s], [], at("09:05"))[0].status).toBe("scheduled");
    expect(evaluateShifts([s], [], at("09:06"))[0].status).toBe(
      "not_clocked_in",
    );
    expect(evaluateShifts([s], [], at("17:00"))[0].status).toBe("no_show");
  });

  it("accepts serialized dates", () => {
    const s = shift({
      shift_start: "2026-01-05T09:00:00Z" as unknown as Date,
      shift_end: "2026-01-05T17:00:00Z" as unknown as Date,
    });
    const entry = makeEntry({
      clock_in: "2026-01-05T09:10:00Z" as unknown as Date,
      clock_out: "2026-01-05T17:00:00Z" as unknown as Date,
    });
    expect(evaluateShifts([s], [entry], at("18:00"))[0]).toMatchObject({
      status: "late",
      minutes_late: 10,
    });
  });
});

describe("countShiftStatuses", () => {
  it("counts each status", () => {
    expect(
      countShiftStatuses([
        { status: "late" },
        { status: "late" },
        { status: "no_show" },
      ]),
    ).toEqual({
      scheduled: 0,
      on_time: 0,
      late: 2,
      not_clocked_in: 0,
      no_show: 1,
    });
  });
});

describe("findOverlappingShift", () => {
  const shifts = [
    {
      id: 1,
      user_id: "u1",
      shift_start: "2026-01-05T09:00:00Z",
      shift_end: "2026-01-05T17:00:00Z",
    },
  ];

  it("finds the member's shift that overlaps", () => {
    expect(
      findOverlappingShift(shifts, "u1", at("12:00"), at("20:00"))?.id,
    ).toBe(1);
    expect(
      findOverlappingShift(shifts, "u1", at("09:00"), at("17:00"))?.id,
    ).toBe(1);
  });

  it("ignores other members, back-to-back shifts and the shift being moved", () => {
    expect(
      findOverlappingShift(shifts, "u2", at("12:00"), at("20:00")),
    ).toBeUndefined();
    expect(
      findOverlappingShift(shifts, "u1", at("17:00"), at("21:00")),
    ).toBeUndefined();
    expect(
      findOverlappingShift(shifts, "u1", at("12:00"), at("20:00"), 1),
    ).toBeUndefined();
    expect(
      findOverlappingShift(shifts, "u1", new Date("nope"), at("20:00")),
    ).toBeUndefined();
  });
});

describe("weeklyOccurrences", () => {
  const start = new Date("2026-01-05T22:00:00Z");
  const end = new Date("2026-01-06T06:00:00Z");

  it("repeats the shift on the same weekday, including it by default", () => {
    const weeks = weeklyOccurrences(start, end, 3);
    expect(weeks.map((w) => w.shiftStart.toISOString())).toEqual([
      "2026-01-05T22:00:00.000Z",
      "2026-01-12T22:00:00.000Z",
      "2026-01-19T22:00:00.000Z",
    ]);
    // An overnight shift keeps its end on the next morning.
    expect(weeks[2].shiftEnd.toISOString()).toBe("2026-01-20T06:00:00.000Z");
  });

  it("can start from the week after the shift", () => {
    expect(
      weeklyOccurrences(start, end, 2, 1).map((w) =>
        w.shiftStart.toISOString(),
      ),
    ).toEqual(["2026-01-12T22:00:00.000Z", "2026-01-19T22:00:00.000Z"]);
  });

  it("caps the number of weeks and ignores nonsense counts", () => {
    expect(weeklyOccurrences(start, end, 500)).toHaveLength(MAX_REPEAT_WEEKS);
    expect(weeklyOccurrences(start, end, -2)).toEqual([]);
    expect(weeklyOccurrences(start, end, 2.7)).toHaveLength(2);
  });
});

describe("timeOfDayFor", () => {
  it.each([
    ["04:59", "overnight"],
    ["05:00", "morning"],
    ["11:59", "morning"],
    ["12:00", "afternoon"],
    ["16:59", "afternoon"],
    ["17:00", "evening"],
    ["21:59", "evening"],
    ["22:00", "overnight"],
  ])("puts a %s start in the %s", (time, expected) => {
    expect(timeOfDayFor(at(time))).toBe(expected);
  });
});

describe("activeFilterCount", () => {
  it("counts only the filters that are set", () => {
    expect(activeFilterCount(EMPTY_SHIFT_FILTERS)).toBe(0);
    expect(
      activeFilterCount({
        ...EMPTY_SHIFT_FILTERS,
        query: "  ",
        memberId: "user_1",
        status: "flagged",
      }),
    ).toBe(2);
  });
});

describe("filterShifts", () => {
  let id = 100;
  const withStatus = (
    status: ShiftStatus,
    overrides: Partial<ScheduledShiftWithStatus> = {},
  ): ScheduledShiftWithStatus => ({
    ...shift({ id: id++ }),
    status,
    actual_clock_in: null,
    actual_clock_out: null,
    minutes_late: null,
    ...overrides,
  });
  const names = new Map([
    ["user_1", "Sam Lee"],
    ["user_2", "Alex Kim"],
  ]);
  // 2026-01-05 is a Monday.
  const samMorning = withStatus("scheduled", { note: "Front desk" });
  const alexOvernight = withStatus("late", {
    user_id: "user_2",
    shift_start: new Date("2026-01-05T22:00:00Z"),
    shift_end: new Date("2026-01-06T06:00:00Z"),
    location: "Warehouse",
    location_address: "1 King St",
  });
  const samTuesdayToMidnight = withStatus("no_show", {
    shift_start: new Date("2026-01-06T16:00:00Z"),
    shift_end: new Date("2026-01-07T00:00:00Z"),
  });
  const ghost = withStatus("on_time", { user_id: "ghost" });
  const all = [samMorning, alexOvernight, samTuesdayToMidnight, ghost];
  const run = (filters: Partial<ShiftFilters>) =>
    filterShifts(all, { ...EMPTY_SHIFT_FILTERS, ...filters }, names);

  it("keeps everything with no filters", () => {
    expect(run({})).toEqual(all);
  });

  it("filters by member", () => {
    expect(run({ memberId: "user_2" })).toEqual([alexOvernight]);
  });

  it("filters by a single status or every flagged one", () => {
    expect(run({ status: "late" })).toEqual([alexOvernight]);
    expect(run({ status: "flagged" })).toEqual([
      alexOvernight,
      samTuesdayToMidnight,
    ]);
  });

  it("filters by weekday and time of day of the start", () => {
    expect(run({ weekday: "2" })).toEqual([samTuesdayToMidnight]);
    expect(run({ timeOfDay: "overnight" })).toEqual([alexOvernight]);
    expect(run({ weekday: "1", timeOfDay: "morning" })).toEqual([
      samMorning,
      ghost,
    ]);
  });

  it("matches every day a shift touches, but not past an exact midnight end", () => {
    expect(run({ date: "2026-01-06" })).toEqual([
      alexOvernight,
      samTuesdayToMidnight,
    ]);
    expect(run({ date: "2026-01-07" })).toEqual([]);
    expect(run({ date: "2026-01-04" })).toEqual([]);
  });

  it("searches names, notes and locations, needing every word", () => {
    expect(run({ query: "sam" })).toEqual([samMorning, samTuesdayToMidnight]);
    expect(run({ query: "  FRONT  sam " })).toEqual([samMorning]);
    expect(run({ query: "king" })).toEqual([alexOvernight]);
    expect(run({ query: "warehouse sam" })).toEqual([]);
  });
});
