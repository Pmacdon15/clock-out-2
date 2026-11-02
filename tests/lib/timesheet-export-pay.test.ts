import { describe, expect, it } from "vitest";
import {
  applyPay,
  buildCsvRows,
  buildExportRows,
  buildPaySummary,
  buildPeriodSections,
  buildSheetXml,
  type ExportRow,
  hasPay,
  layoutPdfPages,
  totalPay,
} from "@/lib/timesheet-export";
import { makeEntry } from "../utils";

const rate = { hourlyRate: 20, overtimeMultiplier: 1.5 };

const meta = {
  employee: "Entire Organization",
  startDate: "2026-03-09",
  endDate: "2026-03-15",
};

const row = (overrides: Partial<ExportRow> = {}): ExportRow => ({
  employee: "Ada",
  date: "2026-03-09",
  dayOfWeek: "Mon",
  clockIn: "9:00 AM",
  clockOut: "5:00 PM",
  hours: 8,
  ...overrides,
});

const paid = (overrides: Partial<ExportRow> = {}) =>
  applyPay([row({ payRate: rate, ...overrides })])[0];

describe("pay on export rows", () => {
  it("adds each rated employee's pay, with overtime at the multiplier", () => {
    const entries = [
      makeEntry({
        id: 1,
        user_id: "ada",
        clock_in: new Date("2026-03-09T08:00:00Z"),
        clock_out: new Date("2026-03-09T18:00:00Z"),
      }),
      makeEntry({
        id: 2,
        user_id: "bo",
        clock_in: new Date("2026-03-09T09:00:00Z"),
        clock_out: new Date("2026-03-09T13:00:00Z"),
      }),
    ];
    const rows = buildExportRows(
      entries,
      (id) => (id === "ada" ? "Ada" : "Bo"),
      "UTC",
      null,
      { daily_threshold_hours: 8, weekly_threshold_hours: null },
      (id) => (id === "ada" ? rate : undefined),
    );
    expect(rows[0]).toMatchObject({
      employee: "Ada",
      hours: 10,
      overtimeHours: 2,
      payRate: rate,
      pay: { regularPay: 160, overtimePay: 60, grossPay: 220 },
    });
    expect(rows[1].payRate).toBeUndefined();
    expect(rows[1].pay).toBeUndefined();
    expect(hasPay(rows)).toBe(true);
    expect(totalPay(rows).grossPay).toBe(220);
  });

  it("pays every hour as regular without overtime tracking", () => {
    expect(paid().pay).toEqual({
      regularPay: 160,
      overtimePay: 0,
      grossPay: 160,
    });
  });

  it("pays nothing yet for a shift that is still open", () => {
    expect(paid({ hours: null }).pay?.grossPay).toBe(0);
  });

  it("leaves rows alone without rates", () => {
    const rows = buildExportRows([makeEntry()], () => "Ada");
    expect(hasPay(rows)).toBe(false);
    expect(totalPay(rows)).toEqual({
      regularPay: 0,
      overtimePay: 0,
      grossPay: 0,
    });
  });

  it("summarises pay per rated employee", () => {
    const rows = [
      paid({ overtimeHours: 0 }),
      paid({ date: "2026-03-10", hours: 10, overtimeHours: 2 }),
      row({ employee: "Bo" }),
    ];
    expect(buildPaySummary(rows)).toEqual([
      {
        employee: "Ada",
        payRate: rate,
        regularHours: 16,
        overtimeHours: 2,
        pay: { regularPay: 320, overtimePay: 60, grossPay: 380 },
      },
    ]);
  });

  it("totals pay in each period section", () => {
    const rows = [paid(), paid({ date: "2026-03-17" })];
    const sections = buildPeriodSections(rows, {
      ...meta,
      endDate: "2026-03-22",
      groupBy: "week",
    });
    expect(sections.map((s) => s.pay.grossPay)).toEqual([160, 160]);
    expect(
      buildPeriodSections(rows, { ...meta, groupBy: "none" })[0].pay.grossPay,
    ).toBe(320);
  });
});

describe("pay in the spreadsheet", () => {
  it("adds an estimated gross pay table with money formatting", () => {
    const xml = buildSheetXml(
      [paid({ hours: 10, overtimeHours: 2 }), row({ employee: "Bo" })],
      meta,
    );
    expect(xml).toContain("Estimated Gross Pay");
    expect(xml).toContain("Total gross pay");
    expect(xml).toContain("1.5x");
    expect(xml).toContain('s="7"><v>220</v>');
    expect(xml).not.toContain("Gross Pay by Period");
  });

  it("adds gross pay by period when the report has several", () => {
    const xml = buildSheetXml([paid(), paid({ date: "2026-03-17" })], {
      ...meta,
      endDate: "2026-03-22",
      groupBy: "week",
    });
    expect(xml).toContain("Gross Pay by Period");
  });

  it("has no pay table without rates", () => {
    expect(buildSheetXml([row()], meta)).not.toContain("Gross Pay");
  });
});

describe("pay in the PDF", () => {
  it("adds an estimated gross pay table", () => {
    const text = layoutPdfPages(
      [paid({ hours: 10, overtimeHours: 2 }), row({ employee: "Bo" })],
      meta,
    ).join("\n");
    expect(text).toContain("(Estimated Gross Pay)");
    expect(text).toContain("($20.00)");
    expect(text).toContain("(1.5x)");
    expect(text).toContain("($220.00)");
    expect(text).toContain("(Total gross pay)");
    expect(text).toContain("Estimate only");
  });

  it("lists gross pay per period when the report has several", () => {
    const text = layoutPdfPages([paid(), paid({ date: "2026-03-17" })], {
      ...meta,
      endDate: "2026-03-22",
      groupBy: "week",
    }).join("\n");
    // One $160.00 per week; the employee row and the total are $320.00.
    expect(text.match(/\(\$160\.00\)/g)).toHaveLength(2);
    expect(text.match(/\(\$320\.00\)/g)).toHaveLength(2);
  });

  it("has no pay table without rates", () => {
    expect(layoutPdfPages([row()], meta).join("\n")).not.toContain(
      "Estimated Gross Pay",
    );
  });
});

describe("pay in the CSV", () => {
  it("adds rate, multiplier and gross pay columns", () => {
    const csv = buildCsvRows(
      [
        paid({ hours: 10, overtimeHours: 0 }),
        paid({ date: "2026-03-17", hours: null, clockOut: "In progress" }),
        row({ employee: "Bo", date: "2026-03-18" }),
      ],
      { ...meta, endDate: "2026-03-22", groupBy: "week" },
    );
    const [header, ...records] = csv;
    const col = (name: string) => header.indexOf(name);
    expect(col("Hourly Rate")).toBeGreaterThan(-1);
    const pick = (r: (string | number | null)[]) => [
      r[0],
      r[1],
      r[col("Hourly Rate")],
      r[col("OT Multiplier")],
      r[col("Gross Pay")],
    ];
    expect(records.map(pick)).toEqual([
      ["Shift", "Ada", "20.00", "1.5", "200.00"],
      ["Period Subtotal", null, null, null, "200.00"],
      ["Shift", "Ada", "20.00", "1.5", null],
      ["Shift", "Bo", null, null, null],
      ["Period Subtotal", null, null, null, "0.00"],
      ["Total", null, null, null, "200.00"],
      ["Employee Summary", "Ada", "20.00", "1.5", "200.00"],
      ["Employee Summary", "Bo", null, null, null],
      ["Period Summary", null, null, null, "200.00"],
      ["Period Summary", null, null, null, "0.00"],
    ]);
  });

  it("keeps location as the last column", () => {
    const [header, shift] = buildCsvRows([paid({ location: "Depot" })], meta);
    expect(header.at(-1)).toBe("Location");
    expect(header.at(-2)).toBe("Gross Pay");
    expect(shift.at(-1)).toBe("Depot");
  });

  it("has no pay columns without rates", () => {
    expect(buildCsvRows([row()], meta)[0]).not.toContain("Gross Pay");
  });
});
