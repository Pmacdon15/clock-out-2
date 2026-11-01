import { describe, expect, it } from "vitest";
import {
  countDays,
  formatDays,
  formatTimeOffDates,
  formatTimeOffHours,
  invalidAllowanceReason,
  invalidTimeOffReason,
  isDateString,
  isPaidTimeOff,
  isTimeOffType,
  ptoDaysUsed,
  ptoOverAllowanceReason,
  timeOffDaysInRange,
  timeOffHoursInRange,
} from "@/lib/time-off-utils";

const valid = {
  type: "vacation",
  startDate: "2026-01-05",
  endDate: "2026-01-07",
  hoursPerDay: 8,
};

describe("isTimeOffType / isDateString", () => {
  it("knows the request types", () => {
    expect(isTimeOffType("vacation")).toBe(true);
    expect(isTimeOffType("sick")).toBe(true);
    expect(isTimeOffType("unpaid")).toBe(true);
    expect(isTimeOffType("party")).toBe(false);
  });

  it("accepts real calendar dates only", () => {
    expect(isDateString("2026-02-28")).toBe(true);
    expect(isDateString("2026-02-31")).toBe(false);
    expect(isDateString("2026-13-01")).toBe(false);
    expect(isDateString("Jan 5")).toBe(false);
  });
});

describe("countDays", () => {
  it("counts both ends", () => {
    expect(countDays("2026-01-05", "2026-01-05")).toBe(1);
    expect(countDays("2026-12-31", "2027-01-02")).toBe(3);
  });
});

describe("invalidTimeOffReason", () => {
  it("accepts a valid request", () => {
    expect(invalidTimeOffReason(valid)).toBeNull();
  });

  it.each([
    [{ type: "party" }, "Unknown time off type"],
    [{ startDate: "nope" }, "Invalid start or end date"],
    [{ endDate: "2026-02-31" }, "Invalid start or end date"],
    [{ endDate: "2026-01-04" }, "End date must be on or after the start date"],
    [{ endDate: "2026-03-06" }, "Time off requests can be at most 60 days"],
    [{ hoursPerDay: 0 }, "Hours per day must be between 0 and 24"],
    [{ hoursPerDay: 25 }, "Hours per day must be between 0 and 24"],
    [{ hoursPerDay: Number.NaN }, "Hours per day must be between 0 and 24"],
  ])("rejects %o", (override, reason) => {
    expect(invalidTimeOffReason({ ...valid, ...override })).toBe(reason);
  });
});

describe("timeOffDaysInRange / timeOffHoursInRange", () => {
  const request = {
    start_date: "2026-01-05",
    end_date: "2026-01-09",
    hours_per_day: 7.5,
  };

  it("counts the whole request without a range", () => {
    expect(timeOffDaysInRange(request)).toBe(5);
    expect(timeOffHoursInRange(request)).toBe(37.5);
  });

  it("clips to the range", () => {
    expect(timeOffDaysInRange(request, "2026-01-07", "2026-01-31")).toBe(3);
    expect(timeOffDaysInRange(request, "2026-01-01", "2026-01-05")).toBe(1);
    expect(timeOffHoursInRange(request, "2026-01-08")).toBe(15);
  });

  it("is zero outside the range", () => {
    expect(timeOffDaysInRange(request, "2026-02-01", "2026-02-28")).toBe(0);
  });

  it("ignores an unparseable range bound", () => {
    expect(timeOffDaysInRange(request, "bad", "bad")).toBe(5);
  });

  it("accepts hours stored as text", () => {
    expect(
      timeOffHoursInRange({
        ...request,
        hours_per_day: "8" as unknown as number,
      }),
    ).toBe(40);
  });
});

describe("formatTimeOffDates", () => {
  it("formats a single day, a range and a range across years", () => {
    expect(
      formatTimeOffDates({ start_date: "2026-01-05", end_date: "2026-01-05" }),
    ).toBe("Jan 5, 2026");
    expect(
      formatTimeOffDates({ start_date: "2026-01-05", end_date: "2026-01-09" }),
    ).toBe("Jan 5 – Jan 9, 2026");
    expect(
      formatTimeOffDates({ start_date: "2025-12-30", end_date: "2026-01-02" }),
    ).toBe("Dec 30, 2025 – Jan 2, 2026");
  });
});

describe("formatTimeOffHours", () => {
  it("keeps whole hours whole", () => {
    expect(formatTimeOffHours(16)).toBe("16h");
    expect(formatTimeOffHours(7.5)).toBe("7.5h");
  });
});

describe("PTO allowances", () => {
  const req = (
    id: number,
    start: string,
    end: string,
    overrides: Record<string, string> = {},
  ) => ({
    id,
    user_id: "u1",
    request_type: "vacation" as const,
    status: "approved" as const,
    start_date: start,
    end_date: end,
    ...overrides,
  });

  it("knows which time off is paid", () => {
    expect(isPaidTimeOff("vacation")).toBe(true);
    expect(isPaidTimeOff("sick")).toBe(true);
    expect(isPaidTimeOff("unpaid")).toBe(false);
  });

  it("validates allowance days", () => {
    expect(invalidAllowanceReason(10)).toBeNull();
    expect(invalidAllowanceReason(0)).toBeNull();
    expect(invalidAllowanceReason(2.5)).toBeNull();
    expect(invalidAllowanceReason(-1)).toBe(
      "PTO days must be between 0 and 365",
    );
    expect(invalidAllowanceReason(366)).toBe(
      "PTO days must be between 0 and 365",
    );
    expect(invalidAllowanceReason(Number.NaN)).toBe(
      "PTO days must be between 0 and 365",
    );
    expect(invalidAllowanceReason(1.25)).toBe("PTO days must be in half days");
  });

  it("counts a member's vacation days in a year", () => {
    const requests = [
      // Only Jan 1 is in 2026.
      req(1, "2025-12-31", "2026-01-01"),
      req(2, "2026-03-02", "2026-03-03", { status: "pending" }),
      req(3, "2026-04-01", "2026-04-01", { request_type: "sick" }),
      req(4, "2026-05-01", "2026-05-01", { user_id: "u2" }),
    ] as Parameters<typeof ptoDaysUsed>[0];
    expect(ptoDaysUsed(requests, "u1", 2026)).toBe(1);
    expect(ptoDaysUsed(requests, "u1", 2026, ["pending", "approved"])).toBe(3);
    expect(ptoDaysUsed(requests, "u1", 2025)).toBe(1);
  });

  it("only limits vacation, and only with an allowance", () => {
    const wanted = req(9, "2026-03-02", "2026-03-04");
    expect(
      ptoOverAllowanceReason({ ...wanted, request_type: "unpaid" }, 0, []),
    ).toBeNull();
    expect(ptoOverAllowanceReason(wanted, null, [])).toBeNull();
    expect(ptoOverAllowanceReason(wanted, undefined, [])).toBeNull();
    expect(ptoOverAllowanceReason(wanted, 3, [])).toBeNull();
    expect(ptoOverAllowanceReason(wanted, 2, [])).toBe(
      "Not enough PTO for 2026: 2 days left, 3 days asked for",
    );
  });

  it("ignores the request itself and checks each year it touches", () => {
    const wanted = req(9, "2025-12-31", "2026-01-01");
    const existing = [
      req(9, "2025-12-31", "2026-01-01"),
      req(1, "2026-02-02", "2026-02-02"),
    ];
    expect(ptoOverAllowanceReason(wanted, 2, existing)).toBeNull();
    expect(ptoOverAllowanceReason(wanted, 1, existing)).toBe(
      "Not enough PTO for 2026: 0 days left, 1 day asked for",
    );
    expect(
      ptoOverAllowanceReason(wanted, 1, [req(2, "2025-06-01", "2025-06-01")]),
    ).toBe("Not enough PTO for 2025: 0 days left, 1 day asked for");
  });

  it("formats days", () => {
    expect(formatDays(1)).toBe("1 day");
    expect(formatDays(0)).toBe("0 days");
    expect(formatDays(2.5)).toBe("2.5 days");
  });
});
