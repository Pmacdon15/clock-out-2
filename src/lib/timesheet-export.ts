/**
 * Timesheet export: turns time entries into a downloadable Excel spreadsheet
 * (.xlsx) or PDF. Dependency-free on purpose — both files are written by hand
 * (the PDF with the built-in Helvetica fonts), so nothing extra ships in the
 * client bundle.
 */

type ExportableEntry = {
  id: number;
  user_id: string;
  clock_in: Date | string;
  clock_out: Date | string | null;
};

export type ExportFormat = "pdf" | "xlsx";

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
    .sort(
      (a, b) =>
        a.clockIn.getTime() - b.clockIn.getTime() || a.entry.id - b.entry.id,
    )
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

/* ----------------------------------------------------------------- XLSX -- */

/*
 * An .xlsx file is a zip of XML parts. We write the smallest valid workbook:
 * one sheet with inline strings, a few cell styles, and a live SUM formula
 * for the total. Parts are stored uncompressed, which every spreadsheet app
 * (Excel, Google Sheets, Numbers, LibreOffice) accepts.
 */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const utf8 = (text: string) => Uint8Array.from(new TextEncoder().encode(text));

/** Build a zip archive using the "stored" (no compression) method. */
export function buildZip(
  files: { name: string; content: string }[],
): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  const header = (size: number) => {
    const bytes = new Uint8Array(size);
    return { bytes, view: new DataView(bytes.buffer) };
  };

  for (const file of files) {
    const name = utf8(file.name);
    const data = utf8(file.content);
    const crc = crc32(data);

    // Local file header. Timestamps are fixed (1980-01-01) so output is stable.
    const local = header(30);
    local.view.setUint32(0, 0x04034b50, true);
    local.view.setUint16(4, 20, true); // version needed
    local.view.setUint16(12, 0x21, true); // DOS date: 1980-01-01
    local.view.setUint32(14, crc, true);
    local.view.setUint32(18, data.length, true);
    local.view.setUint32(22, data.length, true);
    local.view.setUint16(26, name.length, true);
    chunks.push(local.bytes, name, data);

    // Central directory entry pointing back at the local header.
    const entry = header(46);
    entry.view.setUint32(0, 0x02014b50, true);
    entry.view.setUint16(4, 20, true); // version made by
    entry.view.setUint16(6, 20, true); // version needed
    entry.view.setUint16(14, 0x21, true);
    entry.view.setUint32(16, crc, true);
    entry.view.setUint32(20, data.length, true);
    entry.view.setUint32(24, data.length, true);
    entry.view.setUint16(28, name.length, true);
    entry.view.setUint32(42, offset, true);
    central.push(entry.bytes, name);

    offset += 30 + name.length + data.length;
  }

  const centralSize = central.reduce((sum, c) => sum + c.length, 0);
  const end = header(22);
  end.view.setUint32(0, 0x06054b50, true);
  end.view.setUint16(8, files.length, true);
  end.view.setUint16(10, files.length, true);
  end.view.setUint32(12, centralSize, true);
  end.view.setUint32(16, offset, true);

  const parts = [...chunks, ...central, end.bytes];
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let position = 0;
  for (const part of parts) {
    out.set(part, position);
    position += part.length;
  }
  return out;
}

/** Escape XML special characters and drop control characters XML forbids. */
export const xmlText = (value: string) =>
  value
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// Cell style ids, matching <cellXfs> in STYLES_XML.
const STYLE = {
  plain: 0,
  bold: 1,
  title: 2,
  hours: 3,
  boldHours: 4,
  header: 5,
};

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="16"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="2" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

type Cell =
  | { text: string; style?: number }
  | { number: number; style?: number }
  | { formula: string; cached: number; style?: number }
  | null;

const COLUMN_LETTERS = "ABCDE";

const cellXml = (cell: Cell, ref: string) => {
  if (!cell) return "";
  const s = cell.style ? ` s="${cell.style}"` : "";
  if ("text" in cell) {
    return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlText(cell.text)}</t></is></c>`;
  }
  if ("number" in cell) return `<c r="${ref}"${s}><v>${cell.number}</v></c>`;
  return `<c r="${ref}"${s}><f>${cell.formula}</f><v>${cell.cached}</v></c>`;
};

export function buildSheetXml(rows: ExportRow[], meta: ExportMeta): string {
  const HEADER_ROW = 5;
  const firstData = HEADER_ROW + 1;
  const lastData = HEADER_ROW + rows.length;
  // Full precision in the cells; the 0.00 number format handles display, so
  // a recalculated SUM matches the PDF total exactly.
  const total = totalHours(rows);

  const grid: Cell[][] = [
    [{ text: "Timesheet", style: STYLE.title }],
    [{ text: "Report for", style: STYLE.bold }, { text: meta.employee }],
    [{ text: "Period", style: STYLE.bold }, { text: formatPeriod(meta) }],
    [],
    ["Employee", "Date", "Clock In", "Clock Out", "Hours"].map((text) => ({
      text,
      style: STYLE.header,
    })),
    ...rows.map((r): Cell[] => [
      { text: r.employee },
      { text: r.date },
      { text: r.clockIn },
      { text: r.clockOut },
      r.hours === null ? null : { number: r.hours, style: STYLE.hours },
    ]),
    [
      { text: "Total hours", style: STYLE.bold },
      null,
      null,
      null,
      rows.length
        ? {
            formula: `SUM(E${firstData}:E${lastData})`,
            cached: total,
            style: STYLE.boldHours,
          }
        : { number: 0, style: STYLE.boldHours },
    ],
  ];

  const sheetRows = grid
    .map((cells, i) => {
      const r = i + 1;
      const xml = cells.map((c, j) => cellXml(c, `${COLUMN_LETTERS[j]}${r}`));
      return `<row r="${r}">${xml.join("")}</row>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="${HEADER_ROW}" topLeftCell="A${firstData}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols><col min="1" max="1" width="28" customWidth="1"/><col min="2" max="2" width="13" customWidth="1"/><col min="3" max="4" width="12" customWidth="1"/><col min="5" max="5" width="10" customWidth="1"/></cols>
<sheetData>${sheetRows}</sheetData>
</worksheet>`;
}

export function toXlsx(rows: ExportRow[], meta: ExportMeta): Uint8Array {
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  return buildZip([
    {
      name: "[Content_Types].xml",
      content: `${xml}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    },
    {
      name: "_rels/.rels",
      content: `${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      content: `${xml}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Timesheet" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content: `${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    { name: "xl/styles.xml", content: STYLES_XML },
    { name: "xl/worksheets/sheet1.xml", content: buildSheetXml(rows, meta) },
  ]);
}

export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

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
  pen.push(`${gray} G 0.75 w ${MARGIN} ${y} m ${PAGE_WIDTH - MARGIN} ${y} l S`);
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
      write(
        pen,
        `Timesheet - ${meta.employee} (continued)`,
        MARGIN,
        y - 10,
        10,
        true,
      );
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
    writeCell(
      pen,
      COLUMNS[4],
      row.hours === null ? "-" : formatHours(row.hours),
      y,
    );
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
    downloadFile(toXlsx(rows, meta) as BlobPart, XLSX_MIME, fileName);
  }
}
