import { describe, expect, it } from "vitest";
import {
  AUDIT_CHECKS,
  type AuditInput,
  auditTimesheets,
  DEFAULT_AUDIT_THRESHOLDS,
  resolveAuditThresholds,
} from "@/lib/audit-timesheets";
import type {
  ScheduledShift,
  SiteData,
  TimeEntry,
  TimeEntryBreak,
} from "@/lib/types";

const TZ = "America/Edmonton"; // UTC-6 (MDT) in early October 2026
const NOW = Date.parse("2026-10-10T18:00:00.000Z");
const H = 3_600_000;
const M = 60_000;

let nextId = 1;

/** A live-punched entry: created at clock-in, last written at clock-out. */
function entry(overrides: Partial<TimeEntry> = {}): TimeEntry {
  const clockIn = new Date(overrides.clock_in ?? "2026-10-06T15:00:00.000Z");
  const clockOut =
    overrides.clock_out === undefined
      ? new Date(clockIn.getTime() + 8 * H)
      : overrides.clock_out;
  return {
    id: nextId++,
    user_id: "user_alex",
    org_id: "org_1",
    skip_lunch: false,
    breaks: [],
    created_at: clockIn,
    updated_at: clockOut ?? clockIn,
    ...overrides,
    clock_in: clockIn,
    clock_out: clockOut,
  };
}

function meal(
  start: string,
  minutes: number,
  overrides: Partial<TimeEntryBreak> = {},
): TimeEntryBreak {
  const breakStart = new Date(start);
  const breakEnd = new Date(breakStart.getTime() + minutes * M);
  return {
    id: nextId++,
    time_entry_id: 0,
    break_type: "unpaid_meal",
    break_start: breakStart,
    break_end: breakEnd,
    created_at: breakStart,
    updated_at: breakEnd,
    ...overrides,
  };
}

function run(entries: TimeEntry[], extra: Partial<AuditInput> = {}) {
  return auditTimesheets({
    entries,
    employeeNames: new Map([
      ["user_alex", "Alex Smith"],
      ["user_sam", "Sam Lee"],
    ]),
    timezone: TZ,
    nowMs: NOW,
    ...extra,
  });
}

const only = (
  entries: TimeEntry[],
  check: (typeof AUDIT_CHECKS)[number],
  extra: Partial<AuditInput> = {},
) => run(entries, { checks: [check], ...extra }).findings;

describe("resolveAuditThresholds", () => {
  it("uses the defaults with no overrides", () => {
    expect(resolveAuditThresholds()).toEqual(DEFAULT_AUDIT_THRESHOLDS);
  });

  it("takes the meal rule from the org's lunch setting when it is positive", () => {
    expect(
      resolveAuditThresholds(undefined, {
        dock_lunch: true,
        lunch_min_shift_hours: 6,
      }).meal_break_after_hours,
    ).toBe(6);
    expect(
      resolveAuditThresholds(undefined, {
        dock_lunch: true,
        lunch_min_shift_hours: 0,
      }).meal_break_after_hours,
    ).toBe(5);
  });

  it("applies valid overrides and ignores invalid ones", () => {
    const t = resolveAuditThresholds(
      {
        long_shift_hours: 10,
        meal_break_after_hours: 0,
        max_distance_meters: -5,
        edit_grace_minutes: Number.NaN,
        meal_break_min_minutes: undefined,
      },
      { dock_lunch: false, lunch_min_shift_hours: 6 },
    );
    expect(t.long_shift_hours).toBe(10);
    expect(t.meal_break_after_hours).toBe(0);
    expect(t.max_distance_meters).toBe(250);
    expect(t.edit_grace_minutes).toBe(15);
    expect(t.meal_break_min_minutes).toBe(30);
  });
});

describe("auditTimesheets — no findings", () => {
  it("returns nothing for clean, live-punched shifts with lunch", () => {
    const entries = [
      entry({
        clock_in: new Date("2026-10-06T15:00:00Z"),
        breaks: [meal("2026-10-06T19:00:00Z", 30)],
      }),
      entry({
        clock_in: new Date("2026-10-07T15:00:00Z"),
        breaks: [meal("2026-10-07T19:00:00Z", 45)],
      }),
    ];
    const result = run(entries);
    expect(result.findings).toEqual([]);
    expect(result.counts.total).toBe(0);
    expect(result.counts.by_severity).toEqual({ high: 0, medium: 0, low: 0 });
    expect(Object.values(result.counts.by_type).every((n) => n === 0)).toBe(
      true,
    );
  });

  it("returns nothing for no entries, and ignores entries with an unreadable clock-in", () => {
    expect(run([]).findings).toEqual([]);
    const broken = entry();
    broken.clock_in = "not a date" as unknown as Date;
    expect(run([broken]).findings).toEqual([]);
  });

  it("reports which checks ran and which were skipped", () => {
    const { checks } = run([], { checks: ["long_shift"] });
    expect(checks.find((c) => c.type === "long_shift")?.status).toBe("ran");
    expect(checks.find((c) => c.type === "overlapping_entries")).toEqual({
      type: "overlapping_entries",
      status: "skipped",
      note: "Not requested.",
    });

    const all = run([]).checks;
    expect(all).toHaveLength(AUDIT_CHECKS.length);
    expect(all.find((c) => c.type === "punch_far_from_site")?.status).toBe(
      "skipped",
    );
    expect(all.find((c) => c.type === "punch_far_from_site")?.note).toMatch(
      /no work sites/,
    );
    expect(all.find((c) => c.type === "edited_after_the_fact")?.note).toMatch(
      /no edit history/,
    );

    const withSites = run([], {
      sites: [
        { name: "Depot", latitude: 51, longitude: -114, radius_meters: 100 },
      ],
    }).checks;
    expect(
      withSites.find((c) => c.type === "punch_far_from_site")?.status,
    ).toBe("ran");
  });
});

describe("missed_clock_out", () => {
  it("flags a shift open longer than the threshold and estimates a clock-out from the employee's usual shift", () => {
    const usual1 = entry({ clock_in: new Date("2026-10-05T15:00:00Z") }); // 8h
    const usual2 = entry({
      clock_in: new Date("2026-10-06T15:00:00Z"),
      clock_out: new Date("2026-10-06T22:00:00Z"), // 7h
    });
    const open = entry({
      clock_in: new Date("2026-10-08T15:00:00Z"),
      clock_out: null,
    });
    const [f, ...rest] = only([usual1, usual2, open], "missed_clock_out");
    expect(rest).toEqual([]);
    expect(f).toMatchObject({
      type: "missed_clock_out",
      severity: "high",
      employee: { user_id: "user_alex", name: "Alex Smith" },
      entry_ids: [open.id],
      date: "2026-10-08",
      // median of 8h and 7h = 7.5h after 09:00 local
      suggested_fix: {
        org_id: "org_1",
        entry_id: open.id,
        clock_out: "2026-10-08T22:30:00.000Z",
        timezone: TZ,
      },
    });
    expect(f?.description).toMatch(/has been open for 51h/);
    expect(f?.fix_note).toMatch(/Confirm the real time/);
    expect(f?.details).toMatchObject({ closed_automatically: false });
  });

  it("uses the odd-length median and ignores long shifts when estimating", () => {
    const shifts = [6, 8, 9, 20].map((h, i) =>
      entry({
        clock_in: new Date(Date.parse("2026-10-01T15:00:00Z") + i * 24 * H),
        clock_out: new Date(
          Date.parse("2026-10-01T15:00:00Z") + i * 24 * H + h * H,
        ),
      }),
    );
    const open = entry({
      clock_in: new Date("2026-10-08T15:00:00Z"),
      clock_out: null,
    });
    const [f] = only([...shifts, open], "missed_clock_out");
    expect(f?.suggested_fix?.clock_out).toBe("2026-10-08T23:00:00.000Z");
  });

  it("falls back to default_shift_hours when the employee has no completed shift", () => {
    const open = entry({
      clock_in: new Date("2026-10-08T15:00:00Z"),
      clock_out: null,
    });
    const [f] = only([open], "missed_clock_out", {
      thresholds: { default_shift_hours: 10 },
    });
    expect(f?.suggested_fix?.clock_out).toBe("2026-10-09T01:00:00.000Z");
  });

  it("does not flag an open shift that is still within the threshold", () => {
    const open = entry({
      clock_in: new Date(NOW - 3 * H),
      clock_out: null,
    });
    expect(only([open], "missed_clock_out")).toEqual([]);
  });

  it("flags an open shift followed by a later shift and caps the estimate at the next clock-in", () => {
    const open = entry({
      clock_in: new Date("2026-10-09T15:00:00Z"),
      clock_out: null,
    });
    const later = entry({
      clock_in: new Date("2026-10-09T19:00:00Z"),
      clock_out: new Date("2026-10-10T03:00:00Z"),
    });
    const [f] = only([open, later], "missed_clock_out", {
      nowMs: Date.parse("2026-10-10T04:00:00Z"),
    });
    expect(f?.description).toMatch(
      new RegExp(`later shift \\(#${later.id}\\)`),
    );
    expect(f?.suggested_fix?.clock_out).toBe("2026-10-09T19:00:00.000Z");
  });

  it("gives no fix when the next shift starts at the same moment", () => {
    const open = entry({
      id: 500,
      clock_in: new Date("2026-10-09T15:00:00Z"),
      clock_out: null,
    });
    const twin = entry({
      id: 501,
      clock_in: new Date("2026-10-09T15:00:00Z"),
      clock_out: new Date("2026-10-09T16:00:00Z"),
    });
    const [f] = only([twin, open], "missed_clock_out");
    expect(f?.entry_ids).toEqual([500]);
    expect(f?.suggested_fix).toBeNull();
    expect(f?.fix_note).toMatch(/Ask the employee/);
    expect(f?.details).toMatchObject({ estimated_clock_out: null });
  });

  it("never estimates a clock-out in the future", () => {
    const open = entry({
      clock_in: new Date(NOW - 13 * H),
      clock_out: null,
    });
    const [f] = only([open], "missed_clock_out", {
      thresholds: { default_shift_hours: 20 },
    });
    expect(f?.suggested_fix?.clock_out).toBe(new Date(NOW).toISOString());
  });

  it("treats a shift closed by the automatic clock-out as a missed clock-out, not a long shift or an edit", () => {
    const usual = entry({
      clock_in: new Date("2026-10-05T15:00:00Z"),
      breaks: [meal("2026-10-05T19:00:00Z", 30)],
    });
    const clockIn = Date.parse("2026-10-06T15:00:00Z");
    const auto = entry({
      clock_in: new Date(clockIn),
      clock_out: new Date(clockIn + 16 * H),
      updated_at: new Date(clockIn + 16 * H + 3 * M + 20 * M),
    });
    const result = run([usual, auto], { autoClockOutHours: 16 });
    expect(result.findings.map((f) => f.type)).toEqual(["missed_clock_out"]);
    const [f] = result.findings;
    expect(f?.description).toMatch(/automatic clock-out exactly 16h/);
    expect(f?.details).toMatchObject({ closed_automatically: true });
    expect(f?.suggested_fix?.clock_out).toBe("2026-10-06T23:00:00.000Z");
  });

  it("does not treat a 16h shift as auto-closed without the setting, or when it was saved at clock-out", () => {
    const clockIn = Date.parse("2026-10-06T15:00:00Z");
    const live = entry({
      clock_in: new Date(clockIn),
      clock_out: new Date(clockIn + 16 * H),
    });
    expect(only([live], "missed_clock_out", { autoClockOutHours: 16 })).toEqual(
      [],
    );
    const edited = entry({
      clock_in: new Date(clockIn),
      clock_out: new Date(clockIn + 16 * H),
      updated_at: new Date(clockIn + 20 * H),
    });
    expect(only([edited], "missed_clock_out")).toEqual([]);
    expect(
      only([edited], "missed_clock_out", { autoClockOutHours: 0 }),
    ).toEqual([]);
    const noUpdatedAt = entry({
      clock_in: new Date(clockIn),
      clock_out: new Date(clockIn + 16 * H),
      updated_at: null as unknown as Date,
    });
    expect(
      only([noUpdatedAt], "missed_clock_out", { autoClockOutHours: 16 }),
    ).toEqual([]);
  });
});

describe("long_shift", () => {
  it("flags a completed shift over the limit with a medium severity and an estimated fix", () => {
    const usual = entry({ clock_in: new Date("2026-10-05T15:00:00Z") }); // 8h
    const long = entry({
      clock_in: new Date("2026-10-06T15:00:00Z"),
      clock_out: new Date("2026-10-07T04:00:00Z"), // 13h
    });
    const [f, ...rest] = only([usual, long], "long_shift");
    expect(rest).toEqual([]);
    expect(f).toMatchObject({
      severity: "medium",
      entry_ids: [long.id],
      suggested_fix: {
        entry_id: long.id,
        clock_out: "2026-10-06T23:00:00.000Z",
      },
    });
    expect(f?.description).toMatch(/lasted 13h/);
    expect(f?.fix_note).toMatch(/forgot to clock out/);
  });

  it("is high severity past 16h and handles overnight shifts across midnight", () => {
    // 20:00 local Oct 6 to 14:00 local Oct 7
    const overnight = entry({
      clock_in: new Date("2026-10-07T02:00:00Z"),
      clock_out: new Date("2026-10-07T20:00:00Z"),
    });
    const [f] = only([overnight], "long_shift");
    expect(f?.severity).toBe("high");
    // The date is the local day the shift started, not the UTC day.
    expect(f?.date).toBe("2026-10-06");
  });

  it("does not flag a shift at or under the limit, open shifts, or with a raised limit", () => {
    const twelve = entry({
      clock_in: new Date("2026-10-06T15:00:00Z"),
      clock_out: new Date("2026-10-07T03:00:00Z"),
    });
    expect(only([twelve], "long_shift")).toEqual([]);
    const open = entry({ clock_in: new Date(NOW - 20 * H), clock_out: null });
    expect(only([open], "long_shift")).toEqual([]);
    const thirteen = entry({
      clock_in: new Date("2026-10-06T15:00:00Z"),
      clock_out: new Date("2026-10-07T04:00:00Z"),
    });
    expect(
      only([thirteen], "long_shift", { thresholds: { long_shift_hours: 14 } }),
    ).toEqual([]);
  });

  it("gives no fix when the usual shift is no shorter than this one", () => {
    const long = entry({
      clock_in: new Date("2026-10-06T15:00:00Z"),
      clock_out: new Date("2026-10-07T01:00:00Z"), // 10h
    });
    const [f] = only([long], "long_shift", {
      thresholds: { long_shift_hours: 9, default_shift_hours: 11 },
    });
    expect(f?.suggested_fix).toBeNull();
    expect(f?.fix_note).toMatch(/Confirm the shift really was this long/);
  });
});

describe("overlapping_entries", () => {
  it("flags overlapping shifts and trims the earlier one to where the next starts", () => {
    const a = entry({
      clock_in: new Date("2026-10-06T15:00:00Z"),
      clock_out: new Date("2026-10-06T23:00:00Z"),
    });
    const b = entry({
      clock_in: new Date("2026-10-06T21:00:00Z"),
      clock_out: new Date("2026-10-07T01:00:00Z"),
    });
    const [f, ...rest] = only([b, a], "overlapping_entries");
    expect(rest).toEqual([]);
    expect(f).toMatchObject({
      severity: "high",
      entry_ids: [a.id, b.id],
      suggested_fix: {
        entry_id: a.id,
        clock_out: "2026-10-06T21:00:00.000Z",
      },
      details: { overlap_minutes: 120, likely_duplicate: false },
    });
  });

  it("lists every shift an entry overlaps in one finding and one fix", () => {
    const a = entry({
      clock_in: new Date("2026-10-06T15:00:00Z"),
      clock_out: new Date("2026-10-07T03:00:00Z"),
    });
    const b = entry({
      clock_in: new Date("2026-10-06T20:00:00Z"),
      clock_out: new Date("2026-10-07T04:00:00Z"),
    });
    const c = entry({
      clock_in: new Date("2026-10-07T02:00:00Z"),
      clock_out: new Date("2026-10-07T05:00:00Z"),
    });
    const findings = only([a, b, c], "overlapping_entries");
    expect(findings.map((f) => f.entry_ids)).toEqual([
      [a.id, b.id, c.id],
      [b.id, c.id],
    ]);
    expect(findings[0]?.suggested_fix?.clock_out).toBe(
      "2026-10-06T20:00:00.000Z",
    );
  });

  it("calls a shift inside another a likely duplicate with no automatic fix", () => {
    const outer = entry({
      clock_in: new Date("2026-10-06T15:00:00Z"),
      clock_out: new Date("2026-10-06T23:00:00Z"),
    });
    const inner = entry({
      clock_in: new Date("2026-10-06T16:00:00Z"),
      clock_out: new Date("2026-10-06T20:00:00Z"),
    });
    const [f] = only([outer, inner], "overlapping_entries");
    expect(f?.suggested_fix).toBeNull();
    expect(f?.fix_note).toMatch(/delete_time_entry/);
    expect(f?.details).toMatchObject({ likely_duplicate: true });
  });

  it("treats two shifts that start together as duplicates", () => {
    const a = entry({
      id: 900,
      clock_in: new Date("2026-10-06T15:00:00Z"),
      clock_out: new Date("2026-10-06T20:00:00Z"),
    });
    const b = entry({
      id: 901,
      clock_in: new Date("2026-10-06T15:00:00Z"),
      clock_out: new Date("2026-10-06T23:00:00Z"),
    });
    const [f] = only([b, a], "overlapping_entries");
    expect(f?.entry_ids).toEqual([900, 901]);
    expect(f?.suggested_fix).toBeNull();
  });

  it("counts an open shift as running until now", () => {
    const open = entry({
      clock_in: new Date(NOW - 5 * H),
      clock_out: null,
    });
    const later = entry({
      clock_in: new Date(NOW - 2 * H),
      clock_out: new Date(NOW - 1 * H),
    });
    const [f] = only([open, later], "overlapping_entries");
    expect(f?.description).toMatch(/still open/);
    expect(f?.suggested_fix).toBeNull(); // `later` sits inside the open span
  });

  it("does not flag back-to-back shifts or different employees", () => {
    const a = entry({
      clock_in: new Date("2026-10-06T15:00:00Z"),
      clock_out: new Date("2026-10-06T19:00:00Z"),
    });
    const b = entry({
      clock_in: new Date("2026-10-06T19:00:00Z"),
      clock_out: new Date("2026-10-06T23:00:00Z"),
    });
    const other = entry({
      user_id: "user_sam",
      clock_in: new Date("2026-10-06T16:00:00Z"),
      clock_out: new Date("2026-10-06T20:00:00Z"),
    });
    expect(only([a, b, other], "overlapping_entries")).toEqual([]);
  });
});

describe("missed_meal_break", () => {
  const long = (overrides: Partial<TimeEntry> = {}) =>
    entry({
      clock_in: new Date("2026-10-06T15:00:00Z"),
      clock_out: new Date("2026-10-06T23:00:00Z"),
      ...overrides,
    });

  it("flags a long shift with no meal break when lunch isn't docked", () => {
    const e = long();
    const [f] = only([e], "missed_meal_break");
    expect(f).toMatchObject({
      severity: "medium",
      suggested_fix: null,
      details: { meal_break_minutes: 0, skip_lunch: false },
    });
    expect(f?.description).toMatch(/no meal break recorded/);
    expect(f?.fix_note).toMatch(/manage_breaks/);
  });

  it("assumes lunch was taken when the org docks lunch automatically", () => {
    const docked = { dock_lunch: true, lunch_min_shift_hours: 5 };
    expect(
      only([long()], "missed_meal_break", { breakSettings: docked }),
    ).toEqual([]);
    // ...but not when lunch is paid (nothing is docked)...
    expect(
      only([long()], "missed_meal_break", {
        breakSettings: { ...docked, paid_lunch: true },
      }),
    ).toHaveLength(1);
    // ...or when an unpaid rest break replaced the dock without a meal.
    const rest = long({
      breaks: [meal("2026-10-06T19:00:00Z", 15, { break_type: "unpaid_rest" })],
    });
    expect(
      only([rest], "missed_meal_break", { breakSettings: docked }),
    ).toHaveLength(1);
  });

  it("flags a shift marked skipped lunch and, with lunch docked, suggests clearing the flag", () => {
    const e = long({ skip_lunch: true });
    const [f] = only([e], "missed_meal_break", {
      breakSettings: { dock_lunch: true, lunch_min_shift_hours: 5 },
    });
    expect(f?.description).toMatch(/skipped lunch/);
    expect(f?.suggested_fix).toEqual({
      org_id: "org_1",
      entry_id: e.id,
      skip_lunch: false,
      timezone: TZ,
    });
    expect(f?.fix_note).toMatch(/Only if the employee actually took lunch/);

    const [noDock] = only([e], "missed_meal_break");
    expect(noDock?.suggested_fix).toBeNull();
    expect(noDock?.fix_note).toMatch(/manage_breaks/);
  });

  it("flags a meal break shorter than the minimum as low severity", () => {
    const e = long({ breaks: [meal("2026-10-06T19:00:00Z", 15)] });
    const [f] = only([e], "missed_meal_break");
    expect(f?.severity).toBe("low");
    expect(f?.description).toMatch(/only 15 min/);
  });

  it("counts paid meal periods, ignores running breaks and rest breaks", () => {
    const paid = long({
      breaks: [meal("2026-10-06T19:00:00Z", 30, { break_type: "paid_meal" })],
    });
    expect(only([paid], "missed_meal_break")).toEqual([]);
    const running = long({
      breaks: [
        meal("2026-10-06T19:00:00Z", 30, { break_end: null }),
        meal("2026-10-06T17:00:00Z", 30, { break_type: "paid_rest" }),
      ],
    });
    expect(only([running], "missed_meal_break")[0]?.details).toMatchObject({
      meal_break_minutes: 0,
    });
  });

  it("follows the org's lunch threshold and the caller's overrides", () => {
    const fourHours = long({ clock_out: new Date("2026-10-06T19:00:00Z") });
    expect(only([fourHours], "missed_meal_break")).toEqual([]);
    expect(
      only([fourHours], "missed_meal_break", {
        thresholds: { meal_break_after_hours: 4 },
      }),
    ).toHaveLength(1);
    expect(
      only([long()], "missed_meal_break", {
        breakSettings: { dock_lunch: false, lunch_min_shift_hours: 9 },
      }),
    ).toEqual([]);
    const shortMeal = long({ breaks: [meal("2026-10-06T19:00:00Z", 20)] });
    expect(
      only([shortMeal], "missed_meal_break", {
        thresholds: { meal_break_min_minutes: 20 },
      }),
    ).toEqual([]);
  });

  it("skips open shifts", () => {
    const open = entry({ clock_in: new Date(NOW - 9 * H), clock_out: null });
    expect(only([open], "missed_meal_break")).toEqual([]);
  });

  it("handles an entry without a breaks array", () => {
    const e = long({ breaks: undefined });
    expect(only([e], "missed_meal_break")).toHaveLength(1);
  });
});

describe("punch_far_from_site", () => {
  // Calgary-ish depot; 0.01 degrees of latitude is about 1.1 km.
  const depot: SiteData = {
    id: 1,
    org_id: "org_1",
    name: "Depot",
    latitude: 51.0,
    longitude: -114.0,
    radius_meters: 150,
  };
  const sites = [depot];

  it("flags a clock-in well outside every geofence", () => {
    const e = entry({ clock_in_latitude: 51.02, clock_in_longitude: -114.0 });
    const [f] = only([e], "punch_far_from_site", { sites });
    expect(f).toMatchObject({
      severity: "medium",
      suggested_fix: null,
      details: { punch: "clock_in", nearest_site: "Depot", accuracy_m: null },
    });
    expect(f?.description).toMatch(
      /^Clock-in .* from the nearest work site \(Depot\)/,
    );
    expect((f?.details.beyond_geofence_m as number) > 2000).toBe(true);
  });

  it("flags a far clock-out as high severity beyond 5 km", () => {
    const e = entry({
      clock_out_latitude: 51.1,
      clock_out_longitude: -114.0,
      clock_out_accuracy_m: 20,
    });
    const [f] = only([e], "punch_far_from_site", { sites });
    expect(f?.severity).toBe("high");
    expect(f?.description).toMatch(/^Clock-out/);
    expect(f?.details).toMatchObject({ punch: "clock_out", accuracy_m: 20 });
  });

  it("ignores punches inside the geofence, within the tolerance, or explained by GPS accuracy", () => {
    const inside = entry({
      clock_in_latitude: 51.0005,
      clock_in_longitude: -114.0,
    });
    // ~333 m from the centre: 183 m outside the radius, within 250 m tolerance
    const near = entry({
      clock_in_latitude: 51.003,
      clock_in_longitude: -114.0,
    });
    // ~1.1 km away but reported with 1 km accuracy
    const fuzzy = entry({
      clock_in_latitude: 51.01,
      clock_in_longitude: -114.0,
      clock_in_accuracy_m: 1000,
    });
    expect(
      only([inside, near, fuzzy], "punch_far_from_site", { sites }),
    ).toEqual([]);
    expect(
      only([near], "punch_far_from_site", {
        sites,
        thresholds: { max_distance_meters: 100 },
      }),
    ).toHaveLength(1);
  });

  it("does nothing without sites, without coordinates, or when no site is usable", () => {
    const e = entry({ clock_in_latitude: 52, clock_in_longitude: -114 });
    expect(only([e], "punch_far_from_site")).toEqual([]);
    expect(only([entry()], "punch_far_from_site", { sites })).toEqual([]);
    expect(
      only([e], "punch_far_from_site", {
        sites: [{ ...depot, latitude: "x" as unknown as number }],
      }),
    ).toEqual([]);
  });

  it("treats a site radius that doesn't parse as zero", () => {
    const e = entry({ clock_in_latitude: 51.004, clock_in_longitude: -114.0 });
    const [f] = only([e], "punch_far_from_site", {
      sites: [{ ...depot, radius_meters: 0 }],
    });
    expect(f?.details).toMatchObject({ beyond_geofence_m: 445 });
  });
});

describe("edited_after_the_fact", () => {
  it("flags an entry added manually after the shift", () => {
    const e = entry({
      clock_in: new Date("2026-10-06T15:00:00Z"),
      clock_out: new Date("2026-10-06T23:00:00Z"),
      created_at: new Date("2026-10-08T16:00:00Z"),
      updated_at: new Date("2026-10-08T16:00:00Z"),
    });
    const [f, ...rest] = only([e], "edited_after_the_fact");
    expect(rest).toEqual([]);
    expect(f).toMatchObject({ severity: "low", suggested_fix: null });
    expect(f?.description).toMatch(/entered 49h after its clock-in/);
    expect(f?.description).not.toMatch(/changed on/);
  });

  it("flags an entry changed after the shift ended", () => {
    const e = entry({
      clock_in: new Date("2026-10-06T15:00:00Z"),
      clock_out: new Date("2026-10-06T23:00:00Z"),
      updated_at: new Date("2026-10-07T15:30:00Z"),
    });
    const [f] = only([e], "edited_after_the_fact");
    expect(f?.description).toMatch(
      /changed on 2026-10-07 09:30, after the shift ended/,
    );
  });

  it("flags an open entry changed after it was opened", () => {
    const e = entry({
      clock_in: new Date(NOW - 2 * H),
      clock_out: null,
      updated_at: new Date(NOW - 1 * H),
    });
    const [f] = only([e], "edited_after_the_fact");
    expect(f?.description).toMatch(/after the shift was opened/);
  });

  it("flags breaks added after the fact", () => {
    const one = entry({
      breaks: [
        meal("2026-10-06T19:00:00Z", 30, {
          id: 77,
          created_at: new Date("2026-10-07T19:00:00Z"),
        }),
      ],
    });
    expect(only([one], "edited_after_the_fact")[0]?.description).toMatch(
      /has break #77 added after the fact/,
    );
    const two = entry({
      breaks: [
        meal("2026-10-06T19:00:00Z", 30, {
          id: 78,
          created_at: new Date("2026-10-07T19:00:00Z"),
        }),
        meal("2026-10-06T21:00:00Z", 10, {
          id: 79,
          break_type: "paid_rest",
          created_at: new Date("2026-10-07T19:00:00Z"),
        }),
      ],
    });
    const [f] = only([two], "edited_after_the_fact");
    expect(f?.description).toMatch(/has breaks #78, #79/);
    expect(f?.details).toMatchObject({ late_break_ids: [78, 79] });
  });

  it("ignores live punches, changes within the grace period, and missing timestamps", () => {
    const live = entry();
    const quick = entry({
      clock_in: new Date("2026-10-06T15:00:00Z"),
      clock_out: new Date("2026-10-06T23:00:00Z"),
      created_at: new Date("2026-10-06T15:05:00Z"),
      updated_at: new Date("2026-10-06T23:10:00Z"),
    });
    const noStamps = entry({
      created_at: null as unknown as Date,
      updated_at: undefined as unknown as Date,
      breaks: [meal("2026-10-06T19:00:00Z", 30, { created_at: undefined })],
    });
    expect(only([live, quick, noStamps], "edited_after_the_fact")).toEqual([]);
    const edited = entry({
      updated_at: new Date(Date.parse("2026-10-06T23:00:00Z") + 40 * M),
    });
    expect(
      only([edited], "edited_after_the_fact", {
        thresholds: { edit_grace_minutes: 60 },
      }),
    ).toEqual([]);
    expect(only([edited], "edited_after_the_fact")).toHaveLength(1);
    expect(
      only([entry({ breaks: undefined })], "edited_after_the_fact"),
    ).toEqual([]);
    const badBreak = entry({
      breaks: [
        meal("2026-10-06T19:00:00Z", 30, {
          break_start: "bad" as unknown as Date,
          created_at: new Date("2026-10-08T00:00:00Z"),
        }),
      ],
    });
    expect(only([badBreak], "edited_after_the_fact")).toEqual([]);
  });

  it("reports a late break even when the entry has no timestamps", () => {
    const e = entry({
      created_at: null as unknown as Date,
      updated_at: null as unknown as Date,
      breaks: [
        meal("2026-10-06T19:00:00Z", 30, {
          created_at: new Date("2026-10-08T00:00:00Z"),
        }),
      ],
    });
    const [f] = only([e], "edited_after_the_fact");
    expect(f?.details).toMatchObject({ created_at: null, updated_at: null });
  });
});

describe("auditTimesheets — ordering, names and timezones", () => {
  it("sorts findings by severity, then date, then entry id, and counts them", () => {
    const longShift = entry({
      clock_in: new Date("2026-10-05T15:00:00Z"),
      clock_out: new Date("2026-10-06T04:00:00Z"),
      breaks: [meal("2026-10-05T19:00:00Z", 30)],
    });
    const edited = entry({
      clock_in: new Date("2026-10-04T15:00:00Z"),
      breaks: [meal("2026-10-04T19:00:00Z", 30)],
      updated_at: new Date("2026-10-08T00:00:00Z"),
    });
    const open = entry({
      user_id: "user_sam",
      clock_in: new Date("2026-10-07T15:00:00Z"),
      clock_out: null,
    });
    const open2 = entry({
      user_id: "user_unknown",
      clock_in: new Date("2026-10-07T15:00:00Z"),
      clock_out: null,
    });
    const result = run([edited, longShift, open, open2], {
      checks: ["missed_clock_out", "long_shift", "edited_after_the_fact"],
    });
    expect(result.findings.map((f) => [f.type, f.severity])).toEqual([
      ["missed_clock_out", "high"],
      ["missed_clock_out", "high"],
      ["long_shift", "medium"],
      ["edited_after_the_fact", "low"],
    ]);
    expect(result.findings[0]?.employee.name).toBe("Sam Lee");
    // An id without a known member falls back to the id.
    expect(result.findings[1]?.employee.name).toBe("user_unknown");
    expect(result.counts).toMatchObject({
      total: 4,
      by_severity: { high: 2, medium: 1, low: 1 },
      by_type: { missed_clock_out: 2, long_shift: 1, edited_after_the_fact: 1 },
    });
  });

  it("dates findings in the audit's timezone", () => {
    // 23:30 local Oct 6 in Edmonton is 05:30 UTC on Oct 7.
    const e = entry({
      clock_in: new Date("2026-10-07T05:30:00Z"),
      clock_out: new Date("2026-10-07T19:30:00Z"),
    });
    expect(only([e], "long_shift")[0]?.date).toBe("2026-10-06");
    expect(only([e], "long_shift", { timezone: "UTC" })[0]?.date).toBe(
      "2026-10-07",
    );
    expect(
      only([e], "long_shift", { timezone: "UTC" })[0]?.suggested_fix?.timezone,
    ).toBe("UTC");
  });

  it("accepts dates stored as strings", () => {
    const e = entry();
    const raw = {
      ...e,
      clock_in: "2026-10-06T15:00:00.000Z",
      clock_out: "2026-10-07T05:00:00.000Z",
      created_at: "2026-10-06T15:00:00.000Z",
      updated_at: "2026-10-07T05:00:00.000Z",
    } as unknown as TimeEntry;
    expect(only([raw], "long_shift")).toHaveLength(1);
  });
});

describe("late_arrival and no_show", () => {
  let shiftId = 500;
  /** A scheduled shift; 09:00–17:00 MDT on Oct 6 by default. */
  function scheduled(overrides: Partial<ScheduledShift> = {}): ScheduledShift {
    const start = new Date(overrides.shift_start ?? "2026-10-06T15:00:00.000Z");
    return {
      id: shiftId++,
      org_id: "org_1",
      user_id: "user_alex",
      note: null,
      created_by: "user_admin",
      shift_end: new Date(start.getTime() + 8 * H),
      ...overrides,
      shift_start: start,
    };
  }

  it("skips both checks when there is no schedule", () => {
    const { checks, findings } = run([entry()], {
      checks: ["late_arrival", "no_show"],
    });
    for (const type of ["late_arrival", "no_show"]) {
      expect(checks.find((c) => c.type === type)).toMatchObject({
        status: "skipped",
        note: expect.stringMatching(/Scheduling isn't available/),
      });
    }
    expect(findings).toEqual([]);
  });

  it("reports both checks as run with a schedule, even an empty one", () => {
    const { checks } = run([], { scheduledShifts: [] });
    expect(checks.find((c) => c.type === "late_arrival")).toMatchObject({
      status: "ran",
      note: expect.stringContaining("up to 5 min"),
    });
    expect(checks.find((c) => c.type === "no_show")?.status).toBe("ran");
  });

  it("flags a clock-in after the grace period, with the matched entry", () => {
    const shift = scheduled();
    const late = entry({ clock_in: new Date("2026-10-06T15:20:00.000Z") });
    const [finding, ...rest] = only([late], "late_arrival", {
      scheduledShifts: [shift],
    });
    expect(rest).toEqual([]);
    expect(finding).toMatchObject({
      type: "late_arrival",
      severity: "low",
      employee: { user_id: "user_alex", name: "Alex Smith" },
      entry_ids: [late.id],
      scheduled_shift_id: shift.id,
      date: "2026-10-06",
      suggested_fix: null,
      details: { minutes_late: 20, scheduled_start_local: "2026-10-06 09:00" },
    });
    expect(finding?.description).toBe(
      `Alex Smith clocked in at 09:20, 20 min after the scheduled start of 2026-10-06 09:00–17:00 (shift #${shift.id}).`,
    );
  });

  it("is medium severity from 30 min late and follows late_grace_minutes", () => {
    const shift = scheduled();
    const late = entry({ clock_in: new Date("2026-10-06T15:45:00.000Z") });
    expect(
      only([late], "late_arrival", { scheduledShifts: [shift] })[0]?.severity,
    ).toBe("medium");
    expect(
      only([late], "late_arrival", {
        scheduledShifts: [shift],
        thresholds: { late_grace_minutes: 60 },
      }),
    ).toEqual([]);
  });

  it("does not flag on-time, early, or within-grace clock-ins", () => {
    const shifts = [
      scheduled(),
      scheduled({ shift_start: new Date("2026-10-07T15:00:00.000Z") }),
      scheduled({ shift_start: new Date("2026-10-08T15:00:00.000Z") }),
    ];
    const entries = [
      entry({ clock_in: new Date("2026-10-06T15:00:00.000Z") }),
      entry({ clock_in: new Date("2026-10-07T14:30:00.000Z") }),
      entry({ clock_in: new Date("2026-10-08T15:05:00.000Z") }),
    ];
    expect(
      run(entries, {
        scheduledShifts: shifts,
        checks: ["late_arrival", "no_show"],
      }).findings,
    ).toEqual([]);
  });

  it("flags a finished shift with no clock-in as a high-severity no-show", () => {
    const shift = scheduled({ note: "Front desk" });
    const [finding] = only([], "no_show", { scheduledShifts: [shift] });
    expect(finding).toMatchObject({
      type: "no_show",
      severity: "high",
      entry_ids: [],
      scheduled_shift_id: shift.id,
      date: "2026-10-06",
      suggested_fix: null,
      details: { note: "Front desk" },
    });
    expect(finding?.description).toBe(
      `Alex Smith was scheduled 2026-10-06 09:00–17:00 (shift #${shift.id}) but never clocked in.`,
    );
    expect(finding?.fix_note).toMatch(/add_time_entry/);
  });

  it("does not flag shifts still running or not started yet", () => {
    const running = scheduled({
      shift_start: new Date(NOW - 2 * H),
      shift_end: new Date(NOW + 2 * H),
    });
    const future = scheduled({ shift_start: new Date(NOW + 24 * H) });
    expect(run([], { scheduledShifts: [running, future] }).findings).toEqual(
      [],
    );
  });

  it("does not flag a no-show on a day of approved time off", () => {
    const shift = scheduled();
    const timeOff = (
      start_date: string,
      end_date: string,
      user_id = "user_alex",
    ) => [{ user_id, start_date, end_date }];
    expect(
      only([], "no_show", {
        scheduledShifts: [shift],
        approvedTimeOff: timeOff("2026-10-05", "2026-10-07"),
      }),
    ).toEqual([]);
    // Someone else's time off, or other days, don't count.
    expect(
      only([], "no_show", {
        scheduledShifts: [shift],
        approvedTimeOff: [
          ...timeOff("2026-10-06", "2026-10-06", "user_sam"),
          ...timeOff("2026-10-07", "2026-10-08"),
        ],
      }),
    ).toHaveLength(1);
  });

  it("matches clock-ins from scheduleEntries, e.g. the day before the period", () => {
    const shift = scheduled({
      shift_start: new Date("2026-10-06T06:00:00.000Z"),
    });
    const early = entry({ clock_in: new Date("2026-10-06T05:30:00.000Z") });
    expect(only([], "no_show", { scheduledShifts: [shift] })).toHaveLength(1);
    expect(
      only([], "no_show", {
        scheduledShifts: [shift],
        scheduleEntries: [early],
      }),
    ).toEqual([]);
  });

  it("matches one clock-in to one shift, so the second back-to-back shift is a no-show", () => {
    const first = scheduled();
    const second = scheduled({
      shift_start: new Date("2026-10-06T23:00:00.000Z"),
      shift_end: new Date("2026-10-07T03:00:00.000Z"),
    });
    const findings = run([entry()], {
      scheduledShifts: [first, second],
      checks: ["late_arrival", "no_show"],
    }).findings;
    expect(findings.map((f) => [f.type, f.scheduled_shift_id])).toEqual([
      ["no_show", second.id],
    ]);
  });

  it("skips scheduled shifts with unreadable times", () => {
    const broken = scheduled({ shift_end: new Date("not a date") });
    expect(only([], "no_show", { scheduledShifts: [broken] })).toEqual([]);
  });

  it("falls back to the user id for unknown members and orders same-day no-shows", () => {
    const findings = only([], "no_show", {
      scheduledShifts: [
        scheduled({ user_id: "user_gone" }),
        scheduled({ user_id: "user_sam" }),
      ],
    });
    expect(findings.map((f) => f.employee.name)).toEqual([
      "user_gone",
      "Sam Lee",
    ]);
  });

  it("only runs the requested schedule check and counts it", () => {
    const shifts = [
      scheduled(),
      scheduled({ shift_start: new Date("2026-10-07T15:00:00.000Z") }),
    ];
    const late = entry({ clock_in: new Date("2026-10-06T15:40:00.000Z") });
    expect(
      only([late], "late_arrival", { scheduledShifts: shifts }).map(
        (f) => f.type,
      ),
    ).toEqual(["late_arrival"]);
    const result = run([late], { scheduledShifts: shifts });
    expect(result.counts.by_type.late_arrival).toBe(1);
    expect(result.counts.by_type.no_show).toBe(1);
    // No-shows (high) sort ahead of the late arrival (medium).
    expect(result.findings.map((f) => f.type).slice(0, 1)).toEqual(["no_show"]);
  });
});
