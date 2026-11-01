import { describe, expect, it } from "vitest";
import {
  countDays,
  formatTimeOffDates,
  formatTimeOffHours,
  invalidTimeOffReason,
  isDateString,
  isTimeOffType,
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
