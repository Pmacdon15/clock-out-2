import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildExportRows,
  buildPdf,
  buildPeriodSections,
  buildSheetXml,
  buildZip,
  crc32,
  downloadFile,
  type ExportRow,
  exportFileName,
  exportTimesheet,
  formatDayLabel,
  formatPeriod,
  formatTime,
  getMonthBounds,
  getWeekBounds,
  layoutPdfPages,
  pdfText,
  resolveGrouping,
  toPdf,
  totalHours,
  toXlsx,
  XLSX_MIME,
  xmlText,
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
  dayOfWeek: "Mon",
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

  it("computes week and month bounds including Sunday dates", () => {
    expect(getWeekBounds("2026-03-08")).toEqual({
      key: "2026-03-02",
      label: "Week of Mar 2, 2026 - Mar 8, 2026",
    });
    expect(getWeekBounds("2026-03-09")).toEqual({
      key: "2026-03-09",
      label: "Week of Mar 9, 2026 - Mar 15, 2026",
    });
    expect(getMonthBounds("2026-10-26")).toEqual({
      key: "2026-10",
      label: "Month of Oct 2026",
    });
  });

  it("resolves grouping modes and builds period sections", () => {
    expect(resolveGrouping([row()], { ...meta, groupBy: "week" })).toBe("week");
    expect(
      resolveGrouping([row()], {
        ...meta,
        startDate: "2026-01-01",
        endDate: "2026-03-01",
      }),
    ).toBe("month");
    expect(
      resolveGrouping([row()], {
        ...meta,
        startDate: "2026-03-01",
        endDate: "2026-03-20",
      }),
    ).toBe("week");
    expect(
      resolveGrouping(
        [row({ date: "2026-03-08" }), row({ date: "2026-03-09" })],
        meta,
      ),
    ).toBe("week");

    const monthSections = buildPeriodSections(
      [
        row({ date: "2026-02-10", hours: 4 }),
        row({ date: "2026-01-15", hours: 6 }),
        row({ date: "2026-01-16", hours: 2 }),
      ],
      { ...meta, groupBy: "month" },
    );
    expect(monthSections.map((s) => s.key)).toEqual(["2026-01", "2026-02"]);
    expect(monthSections[0]?.totalHours).toBe(8);
  });

  it("builds a file name from the employee and period", () => {
    expect(exportFileName(meta, "pdf")).toBe(
      "timesheet-ada-lovelace-2026-03-08-to-2026-03-14.pdf",
    );
    expect(exportFileName({ ...meta, employee: "!!" }, "xlsx")).toBe(
      "timesheet-employee-2026-03-08-to-2026-03-14.xlsx",
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
        dayOfWeek: "Tue",
        clockIn: "8:00 AM",
        clockOut: "12:30 PM",
        hours: 4.5,
      }),
    ]);
    expect(totalHours(rows)).toBe(12.5);
  });

  it("formats dates and times in the requested IANA timezone when provided", () => {
    const rows = buildExportRows(
      [
        makeEntry({
          id: 1,
          user_id: "u1",
          clock_in: new Date("2026-10-26T15:00:00Z"),
          clock_out: new Date("2026-10-26T23:30:00Z"),
        }),
      ],
      () => "Ada",
      "America/Edmonton",
    );

    expect(rows).toEqual([
      {
        employee: "Ada",
        date: "2026-10-26",
        dayOfWeek: "Mon",
        clockIn: "9:00 AM",
        clockOut: "5:30 PM",
        hours: 8.5,
      },
    ]);
  });

  it("docks lunch when breakSettings is active unless skip_lunch is true", () => {
    const breakSettings = {
      dock_lunch: true,
      lunch_duration_minutes: 30,
      lunch_min_shift_hours: 5,
    };
    const rows = buildExportRows(
      [
        makeEntry({
          id: 1,
          user_id: "u1",
          clock_in: new Date("2026-03-09T09:00:00Z"),
          clock_out: new Date("2026-03-09T17:30:00Z"),
          skip_lunch: false,
        }),
        makeEntry({
          id: 2,
          user_id: "u1",
          clock_in: new Date("2026-03-10T09:00:00Z"),
          clock_out: new Date("2026-03-10T17:30:00Z"),
          skip_lunch: true,
        }),
      ],
      () => "Ada",
      undefined,
      breakSettings,
    );

    expect(rows.map((r) => r.hours)).toEqual([8, 8.5]);
  });
});

/** Minimal reader for the stored (uncompressed) zips that buildZip writes. */
function readZip(zip: Uint8Array): Record<string, string> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const endAt = zip.length - 22;
  expect(view.getUint32(endAt, true)).toBe(0x06054b50);
  const count = view.getUint16(endAt + 10, true);
  let at = view.getUint32(endAt + 16, true);
  const files: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(
      zip.subarray(at + 46, at + 46 + nameLength),
    );
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    const start = local + 30 + view.getUint16(local + 26, true);
    const data = zip.subarray(start, start + size);
    expect(crc32(data)).toBe(crc);
    files[name] = new TextDecoder().decode(data);
    at += 46 + nameLength;
  }
  return files;
}

describe("XLSX output", () => {
  it("computes standard CRC-32 checksums", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it("writes a readable zip archive", () => {
    const files = readZip(
      buildZip([
        { name: "a.txt", content: "hello" },
        { name: "dir/ü.xml", content: "<x>é</x>" },
      ]),
    );
    expect(files).toEqual({ "a.txt": "hello", "dir/ü.xml": "<x>é</x>" });
  });

  it("escapes XML and strips forbidden control characters", () => {
    expect(xmlText(`a & <b> "c"\u0001\tz`)).toBe(
      "a &amp; &lt;b&gt; &quot;c&quot;\tz",
    );
  });

  it("lays out the sheet with header, styled rows and a live total", () => {
    const xml = buildSheetXml(
      [
        row({ employee: "Ada & Co", dayOfWeek: undefined, hours: 25 / 3 }),
        row({ clockOut: "In progress", hours: null }),
      ],
      meta,
    );
    expect(xml).toContain(
      '<c r="A1" s="2" t="inlineStr"><is><t xml:space="preserve">Timesheet</t></is></c>',
    );
    expect(xml).toContain(
      '<c r="B2" t="inlineStr"><is><t xml:space="preserve">Ada Lovelace</t></is></c>',
    );
    expect(xml).toContain("Mar 8, 2026 - Mar 14, 2026");
    expect(xml).toContain('<row r="4"></row>');
    expect(xml).toContain(
      '<c r="F5" s="5" t="inlineStr"><is><t xml:space="preserve">Hours</t></is></c>',
    );
    expect(xml).toContain("Ada &amp; Co");
    expect(xml).toContain(`<c r="F6" s="3"><v>${25 / 3}</v></c>`);
    expect(xml).toMatch(/<row r="7">(?:(?!<c r="F7").)*<\/row>/);
    expect(xml).toContain(
      `<c r="F8" s="4"><f>SUM(F6:F7)</f><v>${25 / 3}</v></c>`,
    );
    expect(xml).toContain('<pane ySplit="5" topLeftCell="A6"');
  });

  it("renders grouped sections and period summaries when spanning multiple weeks", () => {
    const xml = buildSheetXml(
      [
        row({ date: "2026-03-08", hours: 4 }),
        row({ date: "2026-03-09", hours: 3 }),
        row({ date: "2026-03-09", hours: 5 }),
        row({ date: "2026-03-10", hours: 6 }),
      ],
      meta,
    );
    expect(xml).toContain("Subtotal — Week of Mar 2, 2026 - Mar 8, 2026");
    expect(xml).toContain("Subtotal — Week of Mar 9, 2026 - Mar 15, 2026");
    expect(xml).toContain("Summary by Period");
    expect(xml).toContain("<f>SUM(F7,F10,F11,F12)</f>");

    const singleShiftXml = buildSheetXml([row({ hours: 8 })], {
      ...meta,
      groupBy: "none",
    });
    expect(singleShiftXml).toContain("1 day");
    expect(singleShiftXml).toContain("1 shift");
  });

  it("writes a zero total when there are no entries", () => {
    const xml = buildSheetXml([], meta);
    expect(xml).toContain('<c r="F6" s="4"><v>0</v></c>');
    expect(xml).not.toContain("<f>");
  });

  it("packages a complete workbook", () => {
    const files = readZip(toXlsx([row()], meta));
    expect(Object.keys(files)).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/worksheets/sheet1.xml",
    ]);
    expect(files["xl/workbook.xml"]).toContain('<sheet name="Timesheet"');
    expect(files["xl/styles.xml"]).toContain('<cellXfs count="6">');
    expect(files["xl/worksheets/sheet1.xml"]).toBe(
      buildSheetXml([row()], meta),
    );
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
        row({ employee: "A".repeat(60), dayOfWeek: undefined }),
        row({ clockOut: "In progress", hours: null }),
      ],
      meta,
    );
    expect(pages).toHaveLength(1);
    expect(pages[0]).toContain("(Timesheet) Tj");
    expect(pages[0]).toContain("(Mar 8, 2026 - Mar 14, 2026) Tj");
    expect(pages[0]).toContain(`(${"A".repeat(27)}...) Tj`);
    expect(pages[0]).toContain("(-) Tj");
    expect(pages[0]).toContain("(Total hours) Tj");
    expect(pages[0]).toContain("(8.00) Tj");
    expect(pages[0]).toContain("(Page 1 of 1) Tj");
  });

  it("renders grouped sections and subtotals in PDF when spanning weeks", () => {
    const pages = layoutPdfPages(
      [
        row({ date: "2026-03-08", hours: 4 }),
        row({ date: "2026-03-09", hours: 3 }),
        row({ date: "2026-03-09", hours: 5 }),
      ],
      meta,
    );
    expect(pages[0]).toContain("(Week of Mar 2, 2026 - Mar 8, 2026) Tj");
    expect(pages[0]).toContain("(Subtotal \\(Week of Mar 2, 20...) Tj");
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

    // Multi-employee summary near bottom of page triggers page break
    const empPages = layoutPdfPages(
      Array.from({ length: 32 }, (_, i) =>
        row({ employee: i % 2 === 0 ? "Ada" : "Grace" }),
      ),
      meta,
    );
    expect(empPages.length).toBeGreaterThanOrEqual(2);
    expect(empPages.join("\n")).toContain("(Summary by Employee) Tj");
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

  it("exports PDF and Excel files", () => {
    const createSpy = vi.spyOn(document, "createElement");

    exportTimesheet("pdf", [row()], meta);
    let blob = createObjectURL.mock.calls.at(-1)?.[0] as Blob;
    expect(blob.type).toBe("application/pdf");
    let link = createSpy.mock.results.at(-1)?.value as HTMLAnchorElement;
    expect(link.download).toBe(
      "timesheet-ada-lovelace-2026-03-08-to-2026-03-14.pdf",
    );

    exportTimesheet("xlsx", [row()], meta);
    blob = createObjectURL.mock.calls.at(-1)?.[0] as Blob;
    expect(blob.type).toBe(XLSX_MIME);
    link = createSpy.mock.results.at(-1)?.value as HTMLAnchorElement;
    expect(link.download).toBe(
      "timesheet-ada-lovelace-2026-03-08-to-2026-03-14.xlsx",
    );
    createSpy.mockRestore();
  });

  it("renders section subtotals when groupBy is explicitly week or month with 1 section", () => {
    expect(buildSheetXml([row()], { ...meta, groupBy: "week" })).toContain(
      "Subtotal",
    );
    expect(buildSheetXml([row()], { ...meta, groupBy: "month" })).toContain(
      "Subtotal",
    );
    expect(
      layoutPdfPages([row()], { ...meta, groupBy: "week" })[0],
    ).toContain("Subtotal");
    expect(
      layoutPdfPages([row()], { ...meta, groupBy: "month" })[0],
    ).toContain("Subtotal");
  });
});

