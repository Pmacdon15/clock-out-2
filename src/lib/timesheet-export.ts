/**
 * Timesheet export: turns time entries into a downloadable CSV spreadsheet or
 * PDF. Dependency-free on purpose — the PDF is written by hand using the
 * built-in Helvetica fonts, so nothing extra ships in the client bundle.
 */

type ExportableEntry = {
  id: number;
  user_id: string;
  clock_in: Date | string;
  clock_out: Date | string | null;
};

export type ExportFormat = "pdf" | "csv";

export type ExportRow = {
  employee: string;
  date: string;
  clockIn: string;
  clockOut: string;
  /** Null while the shift is still open. */
  hours: number | null;
};

export type ExportMeta = {
  /** Who the report is for, e.g. "Ada" or "Entire Organization". */
  employee: string;
  /** yyyy-MM-dd (a trailing time part is ignored). */
  startDate: string;
  /** yyyy-MM-dd (a trailing time part is ignored). */
  endDate: string;
};

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const pad = (n: number) => String(n).padStart(2, "0");

export const formatDate = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const formatTime = (d: Date) => {
  const hours = d.getHours();
  const suffix = hours < 12 ? "AM" : "PM";
  return `${hours % 12 || 12}:${pad(d.getMinutes())} ${suffix}`;
};

/** "2026-03-08" or "2026-03-08T00:00:00" -> "Mar 8, 2026" */
export const formatDayLabel = (value: string) => {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return `${MONTHS[month - 1]} ${day}, ${year}`;
};

export const formatPeriod = (meta: ExportMeta) =>
  `${formatDayLabel(meta.startDate)} - ${formatDayLabel(meta.endDate)}`;

export const formatHours = (hours: number) => hours.toFixed(2);

export function buildExportRows(
  entries: ExportableEntry[],
  getEmployeeName: (userId: string) => string,
): ExportRow[] {
  return entries
    .map((entry) => ({
      entry,
      clockIn: new Date(entry.clock_in),
      clockOut: entry.clock_out ? new Date(entry.clock_out) : null,
    }))
    .sort((a, b) => a.clockIn.getTime() - b.clockIn.getTime() || a.entry.id - b.entry.id)
    .map(({ entry, clockIn, clockOut }) => ({
      employee: getEmployeeName(entry.user_id),
      date: formatDate(clockIn),
      clockIn: formatTime(clockIn),
      clockOut: clockOut ? formatTime(clockOut) : "In progress",
      hours: clockOut
        ? (clockOut.getTime() - clockIn.getTime()) / 3_600_000
        : null,
    }));
}

export const totalHours = (rows: ExportRow[]) =>
  rows.reduce((sum, row) => sum + (row.hours ?? 0), 0);

export const exportFileName = (meta: ExportMeta, format: ExportFormat) => {
  const who =
    meta.employee
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "employee";
  return `timesheet-${who}-${meta.startDate.slice(0, 10)}-to-${meta.endDate.slice(0, 10)}.${format}`;
};

/* ------------------------------------------------------------------ CSV -- */

const csvCell = (value: string) =>
  /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

export function toCsv(rows: ExportRow[], meta: ExportMeta): string {
  const lines = [
    ["Employee", "Date", "Clock In", "Clock Out", "Hours"],
    ...rows.map((r) => [
      r.employee,
      r.date,
      r.clockIn,
      r.clockOut,
      r.hours === null ? "" : formatHours(r.hours),
    ]),
    [],
    ["Total", "", "", "", formatHours(totalHours(rows))],
    ["Report for", meta.employee],
    ["Period", formatPeriod(meta)],
  ];
  // Leading BOM so Excel opens it as UTF-8 (names with accents survive).
  return `﻿${lines.map((cells) => cells.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

/* ------------------------------------------------------------------ PDF -- */

const PAGE_WIDTH = 612; // US Letter, in points
const PAGE_HEIGHT = 792;
const MARGIN = 48;
const ROW_HEIGHT = 18;
const COLUMNS = [
  { title: "Employee", x: MARGIN, width: 170 },
  { title: "Date", x: 222, width: 80 },
  { title: "Clock In", x: 306, width: 80 },
  { title: "Clock Out", x: 390, width: 90 },
  { title: "Hours", x: PAGE_WIDTH - MARGIN, width: 0, alignRight: true },
];

/** Escape PDF string delimiters and keep to the WinAnsi (Latin-1) range. */
export const pdfText = (value: string) =>
  value
    .replace(/[^\x20-\x7e\xa0-\xff]/g, "?")
    .replace(/[\\()]/g, (c) => `\\${c}`);

/** Rough Helvetica width so long names can be truncated and numbers right-aligned. */
const textWidth = (value: string, size: number) => value.length * size * 0.52;

const fitText = (value: string, width: number, size: number) => {
  if (!width || textWidth(value, size) <= width) return value;
  const maxChars = Math.floor(width / (size * 0.52)) - 1;
  return `${value.slice(0, maxChars)}...`;
};

type Pen = string[];

const write = (
  pen: Pen,
  text: string,
  x: number,
  y: number,
  size: number,
  bold = false,
) => {
  pen.push(
    `BT /${bold ? "F2" : "F1"} ${size} Tf ${x.toFixed(2)} ${y} Td (${pdfText(text)}) Tj ET`,
  );
};

const line = (pen: Pen, y: number, gray = 0.8) => {
  pen.push(
    `${gray} G 0.75 w ${MARGIN} ${y} m ${PAGE_WIDTH - MARGIN} ${y} l S`,
  );
};

const writeCell = (
  pen: Pen,
  column: (typeof COLUMNS)[number],
  text: string,
  y: number,
  bold = false,
) => {
  const size = 9;
  const value = fitText(text, column.width, size);
  const x = column.alignRight ? column.x - textWidth(value, size) : column.x;
  write(pen, value, x, y, size, bold);
};

const writeHeaderRow = (pen: Pen, y: number) => {
  for (const column of COLUMNS) writeCell(pen, column, column.title, y, true);
  line(pen, y - 6, 0.2);
};

/** Lay the rows out over as many pages as needed; returns each page's content stream. */
export function layoutPdfPages(rows: ExportRow[], meta: ExportMeta): string[] {
  const pages: Pen[] = [];
  let pen: Pen = [];
  let y = 0;

  const startPage = (first: boolean) => {
    pen = [];
    pages.push(pen);
    y = PAGE_HEIGHT - MARGIN;
    if (first) {
      write(pen, "Timesheet", MARGIN, y - 14, 20, true);
      write(pen, meta.employee, MARGIN, y - 36, 11);
      write(pen, formatPeriod(meta), MARGIN, y - 52, 11);
      y -= 84;
    } else {
      write(pen, `Timesheet - ${meta.employee} (continued)`, MARGIN, y - 10, 10, true);
      y -= 34;
    }
    writeHeaderRow(pen, y);
    y -= ROW_HEIGHT + 2;
  };

  startPage(true);

  if (rows.length === 0) {
    write(pen, "No time entries in this period.", MARGIN, y, 9);
    y -= ROW_HEIGHT;
  }

  for (const row of rows) {
    if (y < MARGIN + ROW_HEIGHT * 2) startPage(false);
    writeCell(pen, COLUMNS[0], row.employee, y);
    writeCell(pen, COLUMNS[1], row.date, y);
    writeCell(pen, COLUMNS[2], row.clockIn, y);
    writeCell(pen, COLUMNS[3], row.clockOut, y);
    writeCell(pen, COLUMNS[4], row.hours === null ? "-" : formatHours(row.hours), y);
    line(pen, y - 6);
    y -= ROW_HEIGHT;
  }

  // The row loop breaks pages early enough that the total always fits here.
  writeCell(pen, COLUMNS[0], "Total hours", y - 4, true);
  writeCell(pen, COLUMNS[4], formatHours(totalHours(rows)), y - 4, true);

  return pages.map((p, i) => {
    write(p, `Page ${i + 1} of ${pages.length}`, MARGIN, MARGIN / 2, 8);
    return p.join("\n");
  });
}

/** Assemble a valid PDF 1.4 file from page content streams. */
export function buildPdf(pageStreams: string[]): Uint8Array {
  const objects: string[] = [];
  const pageCount = pageStreams.length;
  // 1: catalog, 2: page tree, 3–4: fonts, then a page + content pair per page.
  const pageIds = pageStreams.map((_, i) => 5 + i * 2);

  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>`,
  );
  objects.push(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  );
  objects.push(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  );
  for (const [i, stream] of pageStreams.entries()) {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageIds[i] + 1} 0 R >>`,
    );
    objects.push(
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  }

  // Every character is in the 0–255 range, so string length === byte length.
  let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets: number[] = [];
  for (const [i, body] of objects.entries()) {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xrefOffset = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i);
  return bytes;
}

export const toPdf = (rows: ExportRow[], meta: ExportMeta) =>
  buildPdf(layoutPdfPages(rows, meta));

/* ------------------------------------------------------------- download -- */

export function downloadFile(
  data: BlobPart,
  mimeType: string,
  fileName: string,
) {
  const url = URL.createObjectURL(new Blob([data], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  // Give the browser a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportTimesheet(
  format: ExportFormat,
  rows: ExportRow[],
  meta: ExportMeta,
) {
  const fileName = exportFileName(meta, format);
  if (format === "pdf") {
    downloadFile(toPdf(rows, meta) as BlobPart, "application/pdf", fileName);
  } else {
    downloadFile(toCsv(rows, meta), "text/csv;charset=utf-8", fileName);
  }
}
