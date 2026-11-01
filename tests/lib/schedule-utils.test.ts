import { describe, expect, it } from "vitest";
import {
  countShiftStatuses,
  evaluateShifts,
  invalidShiftReason,
  isFlaggedStatus,
  LATE_GRACE_MINUTES,
  pickNextShift,
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

describe("pickNextShift", () => {
  const withStatus = (
    id: number,
    status: ShiftStatus,
    overrides: Partial<ScheduledShiftWithStatus> = {},
  ): ScheduledShiftWithStatus => ({
    ...shift({ id }),
    status,
    actual_clock_in: null,
    actual_clock_out: null,
    minutes_late: null,
    ...overrides,
  });

  it("returns null when the member has nothing coming up", () => {
    expect(pickNextShift([], "user_1")).toBeNull();
    expect(
      pickNextShift(
        [
          withStatus(1, "no_show"),
          withStatus(2, "on_time", { actual_clock_out: at("17:00") }),
          withStatus(3, "scheduled", { user_id: "user_2" }),
        ],
        "user_1",
      ),
    ).toBeNull();
  });

  it("picks the next scheduled shift", () => {
    expect(
      pickNextShift(
        [withStatus(1, "scheduled"), withStatus(2, "scheduled")],
        "user_1",
      ),
    ).toMatchObject({ kind: "next", shift: { id: 1 } });
  });

  it("prefers the shift they're working over the next one", () => {
    expect(
      pickNextShift(
        [withStatus(1, "late"), withStatus(2, "scheduled")],
        "user_1",
      ),
    ).toMatchObject({ kind: "on_shift", shift: { id: 1 } });
    expect(pickNextShift([withStatus(1, "on_time")], "user_1")).toMatchObject({
      kind: "on_shift",
    });
  });

  it("puts a shift they're missing first", () => {
    expect(
      pickNextShift(
        [
          withStatus(1, "on_time"),
          withStatus(2, "not_clocked_in"),
          withStatus(3, "scheduled"),
        ],
        "user_1",
      ),
    ).toMatchObject({ kind: "late", shift: { id: 2 } });
  });
});
