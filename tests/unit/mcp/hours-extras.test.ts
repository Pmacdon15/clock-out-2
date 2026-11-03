import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  dbGetOvertimeSettings: vi.fn(),
  dbGetBreakSettings: vi.fn(),
  dbGetTimeOffRequests: vi.fn(),
  orgHasPlanFeature: vi.fn(),
}));

vi.mock("@/mcp/db", () => ({
  dbGetOvertimeSettings: m.dbGetOvertimeSettings,
  dbGetBreakSettings: m.dbGetBreakSettings,
  dbGetTimeOffRequests: m.dbGetTimeOffRequests,
}));

vi.mock("@/lib/plan-features", () => ({
  TIME_OFF_FEATURE: "time_off",
  orgHasPlanFeature: m.orgHasPlanFeature,
}));

import type { TimeEntry } from "@/lib/types";
import { describeExtras, loadHoursExtras } from "@/mcp/hours-extras";

const entry = (id: number, userId: string, inIso: string, outIso: string) =>
  ({
    id,
    user_id: userId,
    org_id: "org_1",
    clock_in: new Date(inIso),
    clock_out: new Date(outIso),
    breaks: [],
  }) as unknown as TimeEntry;

beforeEach(() => {
  vi.clearAllMocks();
  m.dbGetBreakSettings.mockResolvedValue(undefined);
  m.dbGetTimeOffRequests.mockResolvedValue([]);
  m.orgHasPlanFeature.mockResolvedValue(true);
});

describe("loadHoursExtras", () => {
  it("splits out daily overtime and counts approved time off in the period", async () => {
    m.dbGetOvertimeSettings.mockResolvedValue({
      org_id: "org_1",
      daily_threshold_hours: 8,
      weekly_threshold_hours: null,
    });
    m.dbGetTimeOffRequests.mockResolvedValue([
      {
        id: 4,
        user_id: "sam",
        request_type: "vacation",
        start_date: "2026-11-05",
        end_date: "2026-11-10",
        hours_per_day: 8,
        status: "approved",
      },
      {
        id: 5,
        user_id: "sam",
        request_type: "sick",
        start_date: "2026-11-03",
        end_date: "2026-11-03",
        hours_per_day: 8,
        status: "pending",
      },
    ]);
    const extrasFor = await loadHoursExtras(
      "org_1",
      [entry(1, "sam", "2026-11-02T15:00:00Z", "2026-11-03T01:00:00Z")],
      "2026-11-02",
      "2026-11-08",
      "America/Regina",
    );
    const sam = extrasFor("sam");
    expect(sam.overtime_hours).toBe(2);
    expect(sam.regular_hours).toBe(8);
    expect(sam.time_off_hours).toBe(32);
    expect(sam.time_off.map((r) => r.request_id)).toEqual([4]);
    expect(describeExtras(sam)).toBe(" (2h overtime, 32h time off)");
    expect(extrasFor("pat")).toMatchObject({
      overtime_hours: 0,
      time_off_hours: 0,
    });
    expect(m.dbGetTimeOffRequests).toHaveBeenCalledWith(
      "org_1",
      null,
      "2026-11-02",
    );
  });

  it("leaves overtime out when the org doesn't track it, and survives failed lookups", async () => {
    m.dbGetOvertimeSettings.mockRejectedValue(new Error("db"));
    m.dbGetTimeOffRequests.mockRejectedValue(new Error("db"));
    const extrasFor = await loadHoursExtras(
      "org_1",
      [],
      "2026-11-02",
      "2026-11-08",
      "UTC",
    );
    expect(extrasFor("sam")).toEqual({
      overtime_hours: null,
      regular_hours: null,
      time_off_hours: 0,
      time_off: [],
    });
    expect(describeExtras(extrasFor("sam"))).toBe("");
  });

  it("counts no time off when the plan lacks the time off feature", async () => {
    m.orgHasPlanFeature.mockResolvedValue(false);
    m.dbGetOvertimeSettings.mockResolvedValue(undefined);
    const extrasFor = await loadHoursExtras(
      "org_1",
      [],
      "2026-11-02",
      "2026-11-08",
      "UTC",
    );
    expect(m.orgHasPlanFeature).toHaveBeenCalledWith("org_1", "time_off");
    expect(m.dbGetTimeOffRequests).not.toHaveBeenCalled();
    expect(extrasFor("sam").time_off).toEqual([]);
  });
});
