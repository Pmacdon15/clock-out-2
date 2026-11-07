import { describe, expect, it } from "vitest";
import {
  buildEmployeeSummaryTable,
  buildShiftDetailTable,
  datesInRange,
  type ExportRow,
  MAX_DAILY_SUMMARY_COLUMNS,
} from "@/lib/timesheet-export";

const row = (overrides: Partial<ExportRow> = {}): ExportRow => ({
  employee: "Ada",
  date: "2026-11-02",
  dayOfWeek: "Mon",
  clockIn: "9:00 AM",
  clockOut: "5:00 PM",
  hours: 8,
  ...overrides,
});

const rate = { hourlyRate: 20, overtimeMultiplier: 1.5 };
const pay = (grossPay: number) => ({
  regularPay: grossPay,
  overtimePay: 0,
  grossPay,
});

describe("datesInRange", () => {
  it("lists every day inclusive, ignoring a trailing time part", () => {
    expect(datesInRange("2026-10-30", "2026-11-02T23:59:59.999")).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ]);
  });

  it("is empty when the end is before the start", () => {
    expect(datesInRange("2026-11-02", "2026-11-01")).toEqual([]);
  });
});

describe("buildShiftDetailTable", () => {
  it("has one row per shift with numeric hours and only the base columns", () => {
    const table = buildShiftDetailTable([
      row({ unpaidBreakHours: 0.5, paidBreakHours: 0.25, hours: 7.5 }),
      row({ employee: "Bob", date: "2026-11-03", dayOfWeek: undefined }),
    ]);
    expect(table.title).toBe("Shifts");
    expect(table.headers).toEqual([
      "Employee",
      "Date",
      "Day",
      "Clock In",
      "Clock Out",
      "Unpaid Breaks (hrs)",
      "Paid Breaks (hrs)",
      "Hours",
    ]);
    expect(table.rows).toEqual([
      ["Ada", "2026-11-02", "Mon", "9:00 AM", "5:00 PM", 0.5, 0.25, 7.5],
      // The day is worked out from the date when the row has none.
      ["Bob", "2026-11-03", "Tue", "9:00 AM", "5:00 PM", 0, 0, 8],
    ]);
  });

  it("leaves hours blank for an open shift and rounds to 2 decimals", () => {
    const table = buildShiftDetailTable([
      row({ clockOut: "In progress", hours: null }),
      row({ hours: 7.123456 }),
    ]);
    expect(table.rows[0]?.[7]).toBeNull();
    expect(table.rows[1]?.[7]).toBe(7.12);
  });

  it("adds overtime, pay and location columns when any row has them", () => {
    const table = buildShiftDetailTable([
      row({
        hours: 10,
        overtimeHours: 2,
        payRate: rate,
        pay: pay(220),
        location: "Shop (51.0, -114.0)",
      }),
      // No rate, no location, open shift: those cells stay empty.
      row({ employee: "Bob", hours: null, clockOut: "In progress" }),
      // A rate but still open: no pay yet.
      row({ employee: "Cy", hours: null, payRate: rate, pay: pay(0) }),
    ]);
    expect(table.headers.slice(8)).toEqual([
      "Overtime Hours",
      "Hourly Rate",
      "Gross Pay",
      "Location",
    ]);
    expect(table.rows[0]?.slice(8)).toEqual([
      2,
      20,
      220,
      "Shop (51.0, -114.0)",
    ]);
    expect(table.rows[1]?.slice(8)).toEqual([0, null, null, null]);
    expect(table.rows[2]?.slice(8)).toEqual([0, 20, null, null]);
  });

  it("neutralizes formula-looking text so a sheet won't evaluate it", () => {
    const table = buildShiftDetailTable([
      row({ employee: '=HYPERLINK("x")', location: "+1 Main St" }),
    ]);
    expect(table.rows[0]?.[0]).toBe('\'=HYPERLINK("x")');
    expect(table.rows[0]?.[8]).toBe("'+1 Main St");
  });
});

describe("buildEmployeeSummaryTable", () => {
  const week = {
    employee: "all",
    startDate: "2026-11-02",
    endDate: "2026-11-04",
  };

  it("is an employee × day grid with totals, blanks for days off and a Total row", () => {
    const table = buildEmployeeSummaryTable(
      [
        row({ employee: "Zed", date: "2026-11-03", hours: 6 }),
        row({ date: "2026-11-02", hours: 4 }),
        row({ date: "2026-11-02", hours: 3.333 }),
        row({ date: "2026-11-04", hours: null, clockOut: "In progress" }),
      ],
      week,
    );
    expect(table.title).toBe("Summary");
    expect(table.headers).toEqual([
      "Employee",
      "Mon Nov 2",
      "Tue Nov 3",
      "Wed Nov 4",
      "Total Hours",
    ]);
    expect(table.rows).toEqual([
      // Sorted by name; an open shift counts as 0 hours on its day.
      ["Ada", 7.33, null, 0, 7.33],
      ["Zed", null, 6, null, 6],
      ["Total", 7.33, 6, 0, 13.33],
    ]);
  });

  it("adds overtime and gross pay totals when the rows have them", () => {
    const table = buildEmployeeSummaryTable(
      [
        row({ hours: 10, overtimeHours: 2, payRate: rate, pay: pay(220) }),
        row({ employee: "Bob", date: "2026-11-03" }),
        row({
          employee: "Bob",
          date: "2026-11-04",
          hours: null,
          payRate: rate,
          pay: pay(0),
        }),
      ],
      week,
    );
    expect(table.headers.slice(-3)).toEqual([
      "Total Hours",
      "Overtime Hours",
      "Gross Pay",
    ]);
    expect(table.rows).toEqual([
      ["Ada", 10, null, null, 10, 2, 220],
      ["Bob", null, 8, 0, 8, 0, 0],
      ["Total", 10, 8, 0, 18, 2, 220],
    ]);
  });

  it("uses one column per Monday–Sunday week for long periods", () => {
    const table = buildEmployeeSummaryTable(
      [
        row({ date: "2026-10-01", hours: 8 }),
        row({ date: "2026-10-02", hours: 4 }),
        row({ date: "2026-11-02", hours: 5 }),
      ],
      { employee: "Ada", startDate: "2026-10-01", endDate: "2026-11-05" },
    );
    expect(MAX_DAILY_SUMMARY_COLUMNS).toBe(31);
    expect(table.headers).toEqual([
      "Employee",
      "Week of Mon Sep 28",
      "Week of Mon Oct 5",
      "Week of Mon Oct 12",
      "Week of Mon Oct 19",
      "Week of Mon Oct 26",
      "Week of Mon Nov 2",
      "Total Hours",
    ]);
    expect(table.rows).toEqual([
      ["Ada", 12, null, null, null, null, 5, 17],
      ["Total", 12, null, null, null, null, 5, 17],
    ]);
  });

  it("still has a Total row when nobody worked", () => {
    const table = buildEmployeeSummaryTable([], week);
    expect(table.rows).toEqual([["Total", null, null, null, 0]]);
  });

  it("neutralizes formula-looking employee names", () => {
    const table = buildEmployeeSummaryTable(
      [row({ employee: "@SUM(A1)" })],
      week,
    );
    expect(table.rows[0]?.[0]).toBe("'@SUM(A1)");
  });
});
