import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildExportRows,
  buildPdf,
  downloadFile,
  type ExportRow,
  exportFileName,
  exportTimesheet,
  formatDayLabel,
  formatPeriod,
  formatTime,
  layoutPdfPages,
  pdfText,
  toCsv,
  toPdf,
  totalHours,
} from "@/lib/timesheet-export";
import { makeEntry } from "../utils";

const meta = {
  employee: "Ada Lovelace",
  startDate: "2026-03-08",
  endDate: "2026-03-14T23:59:59.999",
};

const row = (overrides: Partial<ExportRow> = {}): ExportRow => ({
  employee: "Ada",
  date: "2026-03-09",
  clockIn: "9:00 AM",
  clockOut: "5:00 PM",
  hours: 8,
  ...overrides,
});

const decode = (bytes: Uint8Array) => String.fromCharCode(...bytes);

describe("formatting helpers", () => {
  it("formats 12-hour times", () => {
    expect(formatTime(new Date("2026-03-09T00:05:00Z"))).toBe("12:05 AM");
    expect(formatTime(new Date("2026-03-09T09:30:00Z"))).toBe("9:30 AM");
    expect(formatTime(new Date("2026-03-09T12:00:00Z"))).toBe("12:00 PM");
    expect(formatTime(new Date("2026-03-09T17:45:00Z"))).toBe("5:45 PM");
  });

  it("formats day labels and periods, ignoring time parts", () => {
    expect(formatDayLabel("2026-12-01")).toBe("Dec 1, 2026");
    expect(formatPeriod(meta)).toBe("Mar 8, 2026 - Mar 14, 2026");
  });

  it("builds a file name from the employee and period", () => {
    expect(exportFileName(meta, "pdf")).toBe(
      "timesheet-ada-lovelace-2026-03-08-to-2026-03-14.pdf",
    );
    expect(exportFileName({ ...meta, employee: "!!" }, "csv")).toBe(
      "timesheet-employee-2026-03-08-to-2026-03-14.csv",
    );
  });
});

describe("buildExportRows", () => {
  it("sorts chronologically, names employees and computes hours", () => {
    const rows = buildExportRows(
      [
        makeEntry({
          id: 3,
          user_id: "u2",
          clock_in: "2026-03-10T08:00:00Z" as unknown as Date,
          clock_out: "2026-03-10T12:30:00Z" as unknown as Date,
        }),
        makeEntry({
          id: 2,
          user_id: "u1",
          clock_in: new Date("2026-03-09T09:00:00Z"),
          clock_out: null,
        }),
        makeEntry({
          id: 1,
          user_id: "u1",
          clock_in: new Date("2026-03-09T09:00:00Z"),
          clock_out: new Date("2026-03-09T17:00:00Z"),
        }),
      ],
      (id) => (id === "u1" ? "Ada" : "Grace"),
    );

    expect(rows).toEqual([
      row(),
      row({ clockOut: "In progress", hours: null }),
      row({
        employee: "Grace",
        date: "2026-03-10",
        clockIn: "8:00 AM",
        clockOut: "12:30 PM",
        hours: 4.5,
      }),
    ]);
    expect(totalHours(rows)).toBe(12.5);
  });
});

describe("toCsv", () => {
  it("writes a quoted, Excel-friendly table with totals", () => {
    const csv = toCsv(
      [row({ employee: 'Ada "The Count", Jr.' }), row({ hours: null })],
      meta,
    );
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.slice(1).split("\r\n")).toEqual([
      "Employee,Date,Clock In,Clock Out,Hours",
      '"Ada ""The Count"", Jr.",2026-03-09,9:00 AM,5:00 PM,8.00',
      "Ada,2026-03-09,9:00 AM,5:00 PM,",
      "",
      "Total,,,,8.00",
      "Report for,Ada Lovelace",
      'Period,"Mar 8, 2026 - Mar 14, 2026"',
      "",
    ]);
  });
});

describe("PDF output", () => {
  it("escapes PDF string syntax and non-Latin-1 characters", () => {
    expect(pdfText("a (b) \\ c")).toBe("a \\(b\\) \\\\ c");
    expect(pdfText("Zoë 李")).toBe("Zoë ?");
  });

  it("lays out a single page with header, rows and totals", () => {
    const pages = layoutPdfPages(
      [
        row({ employee: "A".repeat(60) }),
        row({ clockOut: "In progress", hours: null }),
      ],
      meta,
    );
    expect(pages).toHaveLength(1);
    expect(pages[0]).toContain("(Timesheet) Tj");
    expect(pages[0]).toContain("(Mar 8, 2026 - Mar 14, 2026) Tj");
    expect(pages[0]).toContain(`(${"A".repeat(35)}...) Tj`);
    expect(pages[0]).toContain("(-) Tj");
    expect(pages[0]).toContain("(Total hours) Tj");
    expect(pages[0]).toContain("(8.00) Tj");
    expect(pages[0]).toContain("(Page 1 of 1) Tj");
  });

  it("notes when there are no entries", () => {
    const [page] = layoutPdfPages([], meta);
    expect(page).toContain("(No time entries in this period.) Tj");
    expect(page).toContain("(0.00) Tj");
  });

  it("continues long reports onto more pages", () => {
    const pages = layoutPdfPages(
      Array.from({ length: 80 }, () => row()),
      meta,
    );
    expect(pages).toHaveLength(3);
    expect(pages[1]).toContain("(Timesheet - Ada Lovelace \\(continued\\)) Tj");
    expect(pages[2]).toContain("(Page 3 of 3) Tj");
    expect(pages[2]).toContain("(640.00) Tj");
  });

  it("assembles a PDF with a correct cross-reference table", () => {
    const text = decode(buildPdf(["BT ET", "BT ET"]));
    expect(text.startsWith("%PDF-1.4\n")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(text).toContain("/Kids [5 0 R 7 0 R] /Count 2");

    const xrefStart = Number(text.match(/startxref\n(\d+)/)?.[1]);
    expect(text.slice(xrefStart, xrefStart + 4)).toBe("xref");
    const offsets = [...text.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) =>
      Number(m[1]),
    );
    expect(offsets).toHaveLength(8);
    offsets.forEach((offset, i) => {
      expect(text.slice(offset).startsWith(`${i + 1} 0 obj`)).toBe(true);
    });
  });

  it("renders rows straight to PDF bytes", () => {
    expect(decode(toPdf([row()], meta))).toContain("(Ada) Tj");
  });
});

describe("downloads", () => {
  let clickSpy: ReturnType<typeof vi.spyOn>;
  const createObjectURL = vi.fn((_blob: Blob) => "blob:report");
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    // jsdom doesn't implement blob URLs.
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
  });

  afterEach(() => {
    clickSpy.mockRestore();
  });

  it("clicks a temporary link and revokes the blob URL afterwards", () => {
    const createSpy = vi.spyOn(document, "createElement");
    downloadFile("a,b", "text/csv", "report.csv");

    const blob = createObjectURL.mock.calls.at(-1)?.[0] as Blob;
    expect(blob.type).toBe("text/csv");
    const link = createSpy.mock.results.at(-1)?.value as HTMLAnchorElement;
    expect(link.download).toBe("report.csv");
    expect(link.href).toBe("blob:report");
    expect(clickSpy).toHaveBeenCalledTimes(1);

    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:report");
    createSpy.mockRestore();
  });

  it("exports PDF and CSV files", () => {
    const createSpy = vi.spyOn(document, "createElement");

    exportTimesheet("pdf", [row()], meta);
    let blob = createObjectURL.mock.calls.at(-1)?.[0] as Blob;
    expect(blob.type).toBe("application/pdf");
    let link = createSpy.mock.results.at(-1)?.value as HTMLAnchorElement;
    expect(link.download).toBe(
      "timesheet-ada-lovelace-2026-03-08-to-2026-03-14.pdf",
    );

    exportTimesheet("csv", [row()], meta);
    blob = createObjectURL.mock.calls.at(-1)?.[0] as Blob;
    expect(blob.type).toBe("text/csv;charset=utf-8");
    link = createSpy.mock.results.at(-1)?.value as HTMLAnchorElement;
    expect(link.download).toBe(
      "timesheet-ada-lovelace-2026-03-08-to-2026-03-14.csv",
    );
    createSpy.mockRestore();
  });
});
