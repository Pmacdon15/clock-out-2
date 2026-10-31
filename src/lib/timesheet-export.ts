import { formatInTimeZone } from "date-fns-tz";
import {
  type BreakLike,
  breakTypeLabel,
  getBreakDurationMs,
  getEffectiveHours,
  getPaidBreakMs,
  getUnpaidBreakMs,
  isPaidBreakType,
} from "./break-utils";
import { formatCoordinates } from "./geo";
import type { PdfImage } from "./pdf-image";
import type { BreakSettingsData } from "./types";

/**
 * Timesheet export: turns time entries into a downloadable Excel spreadsheet
 * (.xlsx), a PDF, or a flat CSV. Dependency-free on purpose — every file is
 * written by hand (the PDF with the built-in Helvetica fonts), so nothing
 * extra ships in the client bundle.
 */

export type ExportableEntry = {
  id: number;
  user_id: string;
  clock_in: Date | string;
  clock_out: Date | string | null;
  skip_lunch?: boolean;
  breaks?: BreakLike[] | null;
  /** Present only for orgs that capture location. */
  clock_in_latitude?: number | null;
  clock_in_longitude?: number | null;
  clock_in_site_name?: string | null;
  clock_in_address?: string | null;
  clock_out_latitude?: number | null;
  clock_out_longitude?: number | null;
  clock_out_site_name?: string | null;
  clock_out_address?: string | null;
};

export type ExportFormat = "pdf" | "xlsx" | "csv";

export type ExportGrouping = "auto" | "week" | "month" | "none";

/** One break record, as it appears in the exported compliance listing. */
export type ExportBreak = {
  /** Human label for the break type, e.g. "Meal period". */
  type: string;
  start: string;
  end: string;
  hours: number;
  paid: boolean;
};

export type ExportRow = {
  employee: string;
  date: string;
  dayOfWeek?: string;
  clockIn: string;
  clockOut: string;
  /** Null while the shift is still open. Net of unpaid breaks. */
  hours: number | null;
  /** Only present when the shift has break records. */
  breaks?: ExportBreak[];
  unpaidBreakHours?: number;
  paidBreakHours?: number;
  /**
   * Where the shift punches happened, as "<site> (lat, lon)" or "In: ... | Out: ..."
   * — empty for orgs that do not capture location. Included across XLSX, CSV, and PDF
   * exports when punch locations are captured.
   */
  location?: string;
};

export type ExportMeta = {
  /** Who the report is for, e.g. "Ada" or "Entire Organization". */
  employee: string;
  /** yyyy-MM-dd (a trailing time part is ignored). */
  startDate: string;
  /** yyyy-MM-dd (a trailing time part is ignored). */
  endDate: string;
  /** Optional grouping mode ('week', 'month', 'none', or 'auto'). */
  groupBy?: ExportGrouping;
  /** Organization name shown in the PDF header (e.g. the Clerk org name). */
  orgName?: string;
  /** Organization logo drawn next to the name in the PDF header. */
  orgLogo?: PdfImage | null;
};

export type EmployeeSummaryRow = {
  employee: string;
  shiftsCount: number;
  daysWorked: number;
  totalHours: number;
};

export type PeriodSection = {
  key: string;
  label: string;
  rows: ExportRow[];
  totalHours: number;
  shiftsCount: number;
  daysWorked: number;
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

const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const pad = (n: number) => String(n).padStart(2, "0");

export const formatDate = (d: Date, timezone?: string) =>
  timezone
    ? formatInTimeZone(d, timezone, "yyyy-MM-dd")
    : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const formatTime = (d: Date, timezone?: string) => {
  if (timezone) {
    return formatInTimeZone(d, timezone, "h:mm a");
  }
  const hours = d.getHours();
  const suffix = hours < 12 ? "AM" : "PM";
  return `${hours % 12 || 12}:${pad(d.getMinutes())} ${suffix}`;
};

/** "2026-03-08" or "2026-03-08T00:00:00" -> "Mar 8, 2026" */
export const formatDayLabel = (value: string) => {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return `${MONTHS[month - 1]} ${day}, ${year}`;
};

/** Parse "yyyy-MM-dd" into a UTC Date at noon to avoid DST edge cases. */
const parseDateString = (ymd: string): Date => {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
};

const toYmd = (utcDate: Date): string =>
  `${utcDate.getUTCFullYear()}-${pad(utcDate.getUTCMonth() + 1)}-${pad(utcDate.getUTCDate())}`;

export const getDayOfWeekShort = (ymd: string): string => {
  const dt = parseDateString(ymd);
  return DAYS_SHORT[dt.getUTCDay()] as string;
};

/** Get the Monday-Sunday week key and label for a given "yyyy-MM-dd". */
export const getWeekBounds = (ymd: string): { key: string; label: string } => {
  const dt = parseDateString(ymd);
  const dow = dt.getUTCDay(); // 0 = Sun, 1 = Mon, ...
  const diffToMon = dow === 0 ? -6 : 1 - dow;
  const mon = new Date(dt.getTime() + diffToMon * 86_400_000);
  const sun = new Date(mon.getTime() + 6 * 86_400_000);
  const monStr = toYmd(mon);
  const sunStr = toYmd(sun);
  return {
    key: monStr,
    label: `Week of ${formatDayLabel(monStr)} - ${formatDayLabel(sunStr)}`,
  };
};

/** Get the month key ("yyyy-MM") and label ("Oct 2026") for a given "yyyy-MM-dd". */
export const getMonthBounds = (ymd: string): { key: string; label: string } => {
  const [year, month] = ymd.slice(0, 10).split("-").map(Number);
  const key = `${year}-${pad(month)}`;
  return {
    key,
    label: `Month of ${MONTHS[month - 1]} ${year}`,
  };
};

export const formatPeriod = (meta: ExportMeta) =>
  `${formatDayLabel(meta.startDate)} - ${formatDayLabel(meta.endDate)}`;

export const formatHours = (hours: number) => hours.toFixed(2);

export function buildExportRows(
  entries: ExportableEntry[],
  getEmployeeName: (userId: string) => string,
  timezone?: string,
  breakSettings?: BreakSettingsData | null,
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
    .map(({ entry, clockIn, clockOut }) => {
      const date = formatDate(clockIn, timezone);
      const breaks = (entry.breaks ?? []).map((brk) => ({
        type: breakTypeLabel(brk.break_type),
        start: formatTime(new Date(brk.break_start), timezone),
        end: brk.break_end
          ? formatTime(new Date(brk.break_end), timezone)
          : "In progress",
        hours: getBreakDurationMs(brk) / 3_600_000,
        paid: isPaidBreakType(brk.break_type),
      }));
      const location = formatEntryLocation(entry);
      return {
        employee: getEmployeeName(entry.user_id),
        date,
        dayOfWeek: getDayOfWeekShort(date),
        clockIn: formatTime(clockIn, timezone),
        clockOut: clockOut ? formatTime(clockOut, timezone) : "In progress",
        hours: clockOut ? getEffectiveHours(entry, breakSettings) : null,
        // Only shifts with recorded breaks carry the break columns.
        ...(breaks.length > 0
          ? {
              breaks,
              unpaidBreakHours: getUnpaidBreakMs(entry) / 3_600_000,
              paidBreakHours: getPaidBreakMs(entry) / 3_600_000,
            }
          : {}),
        // Absent, not empty, for orgs that capture no location at all.
        ...(location ? { location } : {}),
      };
    });
}

/** Every break record in the report, flattened for the listing sections. */
export function collectBreakRecords(
  rows: ExportRow[],
): { row: ExportRow; brk: ExportBreak }[] {
  return rows.flatMap((row) => (row.breaks ?? []).map((brk) => ({ row, brk })));
}

function formatPunchLocation(
  latitude?: number | null,
  longitude?: number | null,
  siteName?: string | null,
  address?: string | null,
): string {
  if (typeof latitude !== "number" || typeof longitude !== "number") {
    return address ?? siteName ?? "";
  }
  const place = address || formatCoordinates(latitude, longitude);
  return siteName ? `${siteName} (${place})` : place;
}

/**
 * Returns formatted location text for a shift:
 * - If only clock-in location: "<site> (<address/coords>)" or "<address/coords>" or "<site>"
 * - If only clock-out location: "Out: <location>"
 * - If both are identical: "<location>"
 * - If both are present and differ: "In: <in-location> | Out: <out-location>"
 * - If neither is present: ""
 */
export function formatEntryLocation(entry: ExportableEntry): string {
  const inLoc = formatPunchLocation(
    entry.clock_in_latitude,
    entry.clock_in_longitude,
    entry.clock_in_site_name,
    entry.clock_in_address,
  );
  const outLoc = formatPunchLocation(
    entry.clock_out_latitude,
    entry.clock_out_longitude,
    entry.clock_out_site_name,
    entry.clock_out_address,
  );

  if (inLoc && outLoc) {
    if (inLoc === outLoc) return inLoc;
    return `In: ${inLoc} | Out: ${outLoc}`;
  }
  if (inLoc) return inLoc;
  if (outLoc) return `Out: ${outLoc}`;
  return "";
}

export const totalHours = (rows: ExportRow[]) =>
  rows.reduce((sum, row) => sum + (row.hours ?? 0), 0);

export function resolveGrouping(
  rows: ExportRow[],
  meta: ExportMeta,
): "week" | "month" | "none" {
  if (meta.groupBy && meta.groupBy !== "auto") {
    return meta.groupBy;
  }
  const start = parseDateString(meta.startDate);
  const end = parseDateString(meta.endDate);
  const spanDays =
    Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (spanDays > 35) return "month";
  if (spanDays > 7) return "week";
  const weeks = new Set(rows.map((r) => getWeekBounds(r.date).key));
  return weeks.size > 1 ? "week" : "none";
}

export function buildPeriodSections(
  rows: ExportRow[],
  meta: ExportMeta,
): PeriodSection[] {
  const mode = resolveGrouping(rows, meta);
  if (mode === "none" || rows.length === 0) {
    const days = new Set(rows.map((r) => r.date));
    return [
      {
        key: "all",
        label: formatPeriod(meta),
        rows,
        totalHours: totalHours(rows),
        shiftsCount: rows.length,
        daysWorked: days.size,
      },
    ];
  }

  const map = new Map<string, { label: string; rows: ExportRow[] }>();
  for (const row of rows) {
    const bounds =
      mode === "month" ? getMonthBounds(row.date) : getWeekBounds(row.date);
    const existing = map.get(bounds.key);
    if (existing) {
      existing.rows.push(row);
    } else {
      map.set(bounds.key, { label: bounds.label, rows: [row] });
    }
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, group]) => {
      const days = new Set(group.rows.map((r) => r.date));
      return {
        key,
        label: group.label,
        rows: group.rows,
        totalHours: totalHours(group.rows),
        shiftsCount: group.rows.length,
        daysWorked: days.size,
      };
    });
}

export function buildEmployeeSummary(rows: ExportRow[]): EmployeeSummaryRow[] {
  const map = new Map<
    string,
    { shiftsCount: number; days: Set<string>; totalHours: number }
  >();
  for (const row of rows) {
    const existing = map.get(row.employee) ?? {
      shiftsCount: 0,
      days: new Set<string>(),
      totalHours: 0,
    };
    existing.shiftsCount += 1;
    existing.days.add(row.date);
    existing.totalHours += row.hours ?? 0;
    map.set(row.employee, existing);
  }
  return Array.from(map.entries()).map(([employee, data]) => ({
    employee,
    shiftsCount: data.shiftsCount,
    daysWorked: data.days.size,
    totalHours: data.totalHours,
  }));
}

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

const COLUMN_LETTERS = "ABCDEFGH";

const cellXml = (cell: Cell, ref: string) => {
  if (!cell) return "";
  const s = cell.style ? ` s="${cell.style}"` : "";
  if ("text" in cell) {
    return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlText(cell.text)}</t></is></c>`;
  }
  if ("number" in cell) return `<c r="${ref}"${s}><v>${cell.number}</v></c>`;
  return `<c r="${ref}"${s}><f>${cell.formula}</f><v>${cell.cached}</v></c>`;
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function buildSheetXml(rows: ExportRow[], meta: ExportMeta): string {
  const HEADER_ROW = 5;
  const firstData = HEADER_ROW + 1;
  const total = totalHours(rows);
  const uniqueDays = new Set(rows.map((r) => r.date)).size;
  const sections = buildPeriodSections(rows, meta);
  const showSections =
    sections.length > 1 || meta.groupBy === "week" || meta.groupBy === "month";
  const employeeSummaries = buildEmployeeSummary(rows);
  const showLocation = rows.some((r) => Boolean(r.location));

  const grid: Cell[][] = [
    [{ text: "Timesheet", style: STYLE.title }],
    [{ text: "Report for", style: STYLE.bold }, { text: meta.employee }],
    [{ text: "Period", style: STYLE.bold }, { text: formatPeriod(meta) }],
    [],
    [
      "Employee",
      "Date",
      "Day",
      "Clock In",
      "Clock Out",
      "Hours",
      "Daily Total",
      ...(showLocation ? ["Location"] : []),
    ].map((text) => ({
      text,
      style: STYLE.header,
    })),
  ];

  // Calculate daily totals per employee+date
  const dayTotals = new Map<string, number>();
  const dayLastIndex = new Map<string, number>();
  rows.forEach((r, idx) => {
    const key = `${r.employee}__${r.date}`;
    dayTotals.set(key, (dayTotals.get(key) ?? 0) + (r.hours ?? 0));
    dayLastIndex.set(key, idx);
  });

  const shiftRowIndices: number[] = [];
  let globalRowIdx = 0;

  for (const section of sections) {
    if (showSections && rows.length > 0) {
      grid.push([
        { text: section.label, style: STYLE.bold },
        null,
        null,
        null,
        null,
        null,
        null,
      ]);
    }

    const sectionShiftExcelRows: number[] = [];

    for (const r of section.rows) {
      const excelRowNumber = grid.length + 1;
      shiftRowIndices.push(excelRowNumber);
      sectionShiftExcelRows.push(excelRowNumber);

      const dayKey = `${r.employee}__${r.date}`;
      const isLastOfDay = dayLastIndex.get(dayKey) === globalRowIdx;
      const dayTotal = dayTotals.get(dayKey) as number;

      grid.push([
        { text: r.employee },
        { text: r.date },
        { text: r.dayOfWeek ?? getDayOfWeekShort(r.date) },
        { text: r.clockIn },
        { text: r.clockOut },
        r.hours === null ? null : { number: r.hours, style: STYLE.hours },
        isLastOfDay ? { number: dayTotal, style: STYLE.boldHours } : null,
        ...(showLocation ? [{ text: r.location ?? "" }] : []),
      ]);
      globalRowIdx += 1;
    }

    if (showSections && section.rows.length > 0) {
      const firstSecRow = sectionShiftExcelRows[0];
      const lastSecRow =
        sectionShiftExcelRows[sectionShiftExcelRows.length - 1];
      grid.push([
        { text: `Subtotal — ${section.label}`, style: STYLE.bold },
        {
          text: plural(section.daysWorked, "day"),
          style: STYLE.bold,
        },
        {
          text: plural(section.shiftsCount, "shift"),
          style: STYLE.bold,
        },
        null,
        null,
        {
          formula: `SUM(F${firstSecRow}:F${lastSecRow})`,
          cached: section.totalHours,
          style: STYLE.boldHours,
        },
        null,
      ]);
    }
  }

  // Grand total row
  const grandTotalFormula =
    rows.length === 0
      ? null
      : showSections
        ? `SUM(${shiftRowIndices.map((idx) => `F${idx}`).join(",")})`
        : `SUM(F${firstData}:F${firstData + rows.length - 1})`;

  grid.push([
    { text: "Total hours", style: STYLE.bold },
    rows.length > 0
      ? {
          text: plural(uniqueDays, "day"),
          style: STYLE.bold,
        }
      : null,
    rows.length > 0
      ? {
          text: plural(rows.length, "shift"),
          style: STYLE.bold,
        }
      : null,
    null,
    null,
    grandTotalFormula
      ? {
          formula: grandTotalFormula,
          cached: total,
          style: STYLE.boldHours,
        }
      : { number: 0, style: STYLE.boldHours },
    null,
  ]);

  // Summary breakdown section (by employee and/or by week/month)
  if (rows.length > 0) {
    grid.push([]);
    grid.push([
      { text: "Summary by Employee", style: STYLE.header },
      { text: "Days Worked", style: STYLE.header },
      { text: "Shifts", style: STYLE.header },
      { text: "Avg Hrs/Day", style: STYLE.header },
      null,
      { text: "Total Hours", style: STYLE.header },
      null,
    ]);
    for (const emp of employeeSummaries) {
      const avg = emp.totalHours / emp.daysWorked;
      grid.push([
        { text: emp.employee },
        { number: emp.daysWorked },
        { number: emp.shiftsCount },
        { number: avg, style: STYLE.hours },
        null,
        { number: emp.totalHours, style: STYLE.boldHours },
        null,
      ]);
    }

    const breakRecords = collectBreakRecords(rows);
    if (breakRecords.length > 0) {
      grid.push([]);
      grid.push([
        { text: "Break Records", style: STYLE.header },
        { text: "Date", style: STYLE.header },
        { text: "Break", style: STYLE.header },
        { text: "Start", style: STYLE.header },
        { text: "End", style: STYLE.header },
        { text: "Hours", style: STYLE.header },
        { text: "Paid", style: STYLE.header },
      ]);
      for (const { row, brk } of breakRecords) {
        grid.push([
          { text: row.employee },
          { text: row.date },
          { text: brk.type },
          { text: brk.start },
          { text: brk.end },
          { number: brk.hours, style: STYLE.hours },
          { text: brk.paid ? "Paid" : "Unpaid (deducted)" },
        ]);
      }
    }

    if (sections.length > 1) {
      grid.push([]);
      grid.push([
        { text: "Summary by Period", style: STYLE.header },
        { text: "Days Worked", style: STYLE.header },
        { text: "Shifts", style: STYLE.header },
        null,
        null,
        { text: "Total Hours", style: STYLE.header },
        null,
      ]);
      for (const sec of sections) {
        grid.push([
          { text: sec.label },
          { number: sec.daysWorked },
          { number: sec.shiftsCount },
          null,
          null,
          { number: sec.totalHours, style: STYLE.boldHours },
          null,
        ]);
      }
    }
  }

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
<cols><col min="1" max="1" width="26" customWidth="1"/><col min="2" max="2" width="13" customWidth="1"/><col min="3" max="3" width="8" customWidth="1"/><col min="4" max="5" width="12" customWidth="1"/><col min="6" max="7" width="12" customWidth="1"/><col min="8" max="8" width="34" customWidth="1"/></cols>
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

export type PdfColumn = {
  title: string;
  x: number;
  width: number;
  alignRight?: boolean;
};

export const COLUMNS: PdfColumn[] = [
  { title: "Employee", x: MARGIN, width: 135 },
  { title: "Date", x: 187, width: 68 },
  { title: "Day", x: 259, width: 32 },
  { title: "Clock In", x: 295, width: 64 },
  { title: "Clock Out", x: 363, width: 72 },
  { title: "Hours", x: 498, width: 0, alignRight: true },
  { title: "Day Total", x: PAGE_WIDTH - MARGIN, width: 0, alignRight: true },
];

export const COLUMNS_WITH_LOCATION: PdfColumn[] = [
  { title: "Employee", x: MARGIN, width: 90 },
  { title: "Date", x: 142, width: 56 },
  { title: "Day", x: 202, width: 24 },
  { title: "Clock In", x: 230, width: 48 },
  { title: "Clock Out", x: 282, width: 50 },
  { title: "Location", x: 336, width: 130 },
  { title: "Hours", x: 512, width: 0, alignRight: true },
  { title: "Day Total", x: PAGE_WIDTH - MARGIN, width: 0, alignRight: true },
];

export const getPdfColumns = (showLocation: boolean): PdfColumn[] =>
  showLocation ? COLUMNS_WITH_LOCATION : COLUMNS;

/**
 * The break-records table at the end of the report: its own columns, so a
 * break type and window never get squeezed into the shift columns.
 */
const BREAK_COLUMNS = [
  { title: "Employee", x: MARGIN, width: 108 },
  { title: "Date", x: 160, width: 68 },
  { title: "Break", x: 232, width: 118 },
  { title: "Start", x: 354, width: 60 },
  { title: "End", x: 418, width: 60 },
  { title: "Paid", x: 482, width: 44 },
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
  column: PdfColumn,
  text: string,
  y: number,
  bold = false,
) => {
  const size = 9;
  const value = fitText(text, column.width, size);
  const x = column.alignRight ? column.x - textWidth(value, size) : column.x;
  write(pen, value, x, y, size, bold);
};

const writeHeaderRow = (pen: Pen, y: number, columns: PdfColumn[]) => {
  for (const column of columns) writeCell(pen, column, column.title, y, true);
  line(pen, y - 6, 0.2);
};

/** Name the logo XObject is registered under in each page's resources. */
export const PDF_LOGO_NAME = "Im1";
const LOGO_BOX = 40;

/**
 * Draw the organization logo and name at the top of the first page.
 * Returns how much vertical space was used (0 when there's no branding).
 */
const drawOrgBranding = (pen: Pen, meta: ExportMeta, top: number) => {
  const logo = meta.orgLogo;
  if (!logo && !meta.orgName) return 0;
  let textX = MARGIN;
  if (logo) {
    // Fit inside a square box, preserving the aspect ratio.
    const scale = LOGO_BOX / Math.max(logo.width, logo.height);
    const w = logo.width * scale;
    const h = logo.height * scale;
    const x = MARGIN + (LOGO_BOX - w) / 2;
    const y = top - LOGO_BOX + (LOGO_BOX - h) / 2;
    pen.push(
      `q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /${PDF_LOGO_NAME} Do Q`,
    );
    textX += LOGO_BOX + 12;
  }
  if (meta.orgName) {
    const size = 16;
    const name = fitText(meta.orgName, PAGE_WIDTH - MARGIN - textX, size);
    write(pen, name, textX, top - (logo ? LOGO_BOX / 2 + 6 : 14), size, true);
  }
  return (logo ? LOGO_BOX : 18) + 14;
};

/** Lay the rows out over as many pages as needed; returns each page's content stream. */
export function layoutPdfPages(rows: ExportRow[], meta: ExportMeta): string[] {
  const pages: Pen[] = [];
  let pen: Pen = [];
  let y = 0;

  const showLocation = rows.some((r) => Boolean(r.location));
  const columns = getPdfColumns(showLocation);
  const colEmp = columns[0];
  const colDate = columns[1];
  const colDay = columns[2];
  const colClockIn = columns[3];
  const colClockOut = columns[4];
  const colLocation = showLocation ? columns[5] : undefined;
  const colHours = showLocation ? columns[6] : columns[5];
  const colDayTotal = showLocation ? columns[7] : columns[6];

  const ensureSpace = (neededRows: number) => {
    if (y < MARGIN + ROW_HEIGHT * neededRows) startPage(false);
  };

  const startPage = (first: boolean) => {
    pen = [];
    pages.push(pen);
    y = PAGE_HEIGHT - MARGIN;
    if (first) {
      y -= drawOrgBranding(pen, meta, y);
      write(pen, "Timesheet", MARGIN, y - 14, 20, true);
      write(pen, meta.employee, MARGIN, y - 36, 11);
      write(pen, formatPeriod(meta), MARGIN, y - 52, 11);
      y -= 84;
    } else {
      const prefix = meta.orgName ? `${meta.orgName} - ` : "";
      write(
        pen,
        `${prefix}Timesheet - ${meta.employee} (continued)`,
        MARGIN,
        y - 10,
        10,
        true,
      );
      y -= 34;
    }
    writeHeaderRow(pen, y, columns);
    y -= ROW_HEIGHT + 2;
  };

  startPage(true);

  if (rows.length === 0) {
    write(pen, "No time entries in this period.", MARGIN, y, 9);
    y -= ROW_HEIGHT;
  }

  const sections = buildPeriodSections(rows, meta);
  const showSections =
    sections.length > 1 || meta.groupBy === "week" || meta.groupBy === "month";

  const dayTotals = new Map<string, number>();
  const dayLastIndex = new Map<string, number>();
  rows.forEach((r, idx) => {
    const key = `${r.employee}__${r.date}`;
    dayTotals.set(key, (dayTotals.get(key) ?? 0) + (r.hours ?? 0));
    dayLastIndex.set(key, idx);
  });

  let globalIdx = 0;

  for (const section of sections) {
    if (showSections && section.rows.length > 0) {
      ensureSpace(3);
      write(pen, section.label, MARGIN, y, 9, true);
      line(pen, y - 5, 0.5);
      y -= ROW_HEIGHT;
    }

    for (const row of section.rows) {
      ensureSpace(2);
      const dayKey = `${row.employee}__${row.date}`;
      const isLastOfDay = dayLastIndex.get(dayKey) === globalIdx;
      const dayTotal = dayTotals.get(dayKey) as number;

      writeCell(pen, colEmp, row.employee, y);
      writeCell(pen, colDate, row.date, y);
      writeCell(pen, colDay, row.dayOfWeek ?? getDayOfWeekShort(row.date), y);
      writeCell(pen, colClockIn, row.clockIn, y);
      writeCell(pen, colClockOut, row.clockOut, y);
      if (colLocation) {
        writeCell(pen, colLocation, row.location ?? "", y);
      }
      writeCell(
        pen,
        colHours,
        row.hours === null ? "-" : formatHours(row.hours),
        y,
      );
      writeCell(
        pen,
        colDayTotal,
        isLastOfDay ? formatHours(dayTotal) : "",
        y,
        true,
      );
      line(pen, y - 6);
      y -= ROW_HEIGHT;
      globalIdx += 1;
    }

    if (showSections && section.rows.length > 0) {
      ensureSpace(2);
      writeCell(pen, colEmp, `Subtotal (${section.label})`, y, true);
      writeCell(
        pen,
        colClockIn,
        `${section.daysWorked}d / ${section.shiftsCount}s`,
        y,
        true,
      );
      writeCell(pen, colHours, formatHours(section.totalHours), y, true);
      writeCell(pen, colDayTotal, formatHours(section.totalHours), y, true);
      line(pen, y - 6, 0.4);
      y -= ROW_HEIGHT + 4;
    }
  }

  const uniqueDays = new Set(rows.map((r) => r.date)).size;
  ensureSpace(2);
  writeCell(pen, colEmp, "Total hours", y - 4, true);
  if (rows.length > 0) {
    writeCell(pen, colClockIn, `${uniqueDays}d / ${rows.length}s`, y - 4, true);
  }
  writeCell(pen, colHours, formatHours(totalHours(rows)), y - 4, true);
  writeCell(pen, colDayTotal, formatHours(totalHours(rows)), y - 4, true);
  y -= ROW_HEIGHT + 10;

  // Employee summary table when there are multiple employees
  const employeeSummaries = buildEmployeeSummary(rows);
  if (employeeSummaries.length > 1) {
    ensureSpace(employeeSummaries.length + 3);
    write(pen, "Summary by Employee", MARGIN, y, 10, true);
    line(pen, y - 5, 0.3);
    y -= ROW_HEIGHT;
    for (const emp of employeeSummaries) {
      ensureSpace(2);
      writeCell(pen, colEmp, emp.employee, y, true);
      writeCell(pen, colDate, `${emp.daysWorked} days`, y);
      writeCell(pen, colClockIn, `${emp.shiftsCount} shifts`, y);
      writeCell(pen, colHours, formatHours(emp.totalHours), y, true);
      line(pen, y - 6);
      y -= ROW_HEIGHT;
    }
  }

  // Break / meal-period records: the compliance log behind the net hours.
  const breakRecords = collectBreakRecords(rows);
  if (breakRecords.length > 0) {
    ensureSpace(4);
    write(pen, "Break Records", MARGIN, y, 10, true);
    line(pen, y - 5, 0.3);
    y -= ROW_HEIGHT;
    for (const column of BREAK_COLUMNS) {
      writeCell(pen, column, column.title, y, true);
    }
    line(pen, y - 6, 0.2);
    y -= ROW_HEIGHT;
    for (const { row, brk } of breakRecords) {
      ensureSpace(2);
      const cells = [
        row.employee,
        row.date,
        brk.type,
        brk.start,
        brk.end,
        brk.paid ? "Paid" : "Unpaid",
        formatHours(brk.hours),
      ];
      for (const [i, text] of cells.entries()) {
        writeCell(pen, BREAK_COLUMNS[i], text, y);
      }
      line(pen, y - 6);
      y -= ROW_HEIGHT;
    }
  }

  return pages.map((p, i) => {
    write(p, `Page ${i + 1} of ${pages.length}`, MARGIN, MARGIN / 2, 8);
    return p.join("\n");
  });
}

/** Bytes -> a string of 0–255 char codes, so binary data survives in `out`. */
const latin1 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return s;
};

/**
 * Assemble a valid PDF 1.4 file from page content streams, optionally
 * embedding one image (referenced from the streams as `/Im1`).
 */
export function buildPdf(
  pageStreams: string[],
  image?: PdfImage | null,
): Uint8Array {
  const objects: string[] = [];
  const pageCount = pageStreams.length;
  // 1: catalog, 2: page tree, 3–4: fonts, then a page + content pair per page,
  // then the optional image so existing object ids stay stable.
  const pageIds = pageStreams.map((_, i) => 5 + i * 2);
  const imageId = 5 + pageCount * 2;
  const xObjects = image
    ? ` /XObject << /${PDF_LOGO_NAME} ${imageId} 0 R >>`
    : "";

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
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >>${xObjects} >> /Contents ${pageIds[i] + 1} 0 R >>`,
    );
    objects.push(
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  }
  if (image) {
    objects.push(
      `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} ` +
        `/ColorSpace /${image.colorSpace} /BitsPerComponent 8 /Filter /${image.filter} ` +
        `/Length ${image.data.length} >>\nstream\n${latin1(image.data)}\nendstream`,
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
  buildPdf(layoutPdfPages(rows, meta), meta.orgLogo);

/* ------------------------------------------------------------------ CSV -- */

/*
 * The CSV is the flat, machine-readable sibling of the spreadsheet: one header
 * row and one record per row, so payroll tools can import it without having to
 * understand the PDF's visual grouping or the workbook's summary blocks. Every
 * row names its own "Record Type", which lets a consumer keep just the shift
 * rows (or read the subtotals and summaries too) with a single filter.
 */

export const CSV_COLUMNS = [
  "Record Type",
  "Employee",
  "Date",
  "Day",
  "Clock In",
  "Clock Out",
  "Hours",
  "Daily Total",
  "Period",
  "Days Worked",
  "Shifts",
  "Avg Hours/Day",
] as const;

/** RFC 4180 record separator; Excel on Windows still expects CRLF. */
const CSV_EOL = "\r\n";

/**
 * Excel and Google Sheets evaluate any cell whose text starts with one of
 * these as a formula, so a member name (or, soon, a free-text note) like
 * `=1+1` or `@SUM(A1)` would run when the file is opened. An apostrophe in
 * front forces the value to be read as text.
 */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/**
 * The guard is deliberately unconditional: a leading `-` or `+` is prefixed
 * even on something that looks like a number, because Excel treats `+1` and
 * `-2+3` alike as formulas and the exported columns never hold a negative
 * value anyway.
 */
export const neutralizeCsvValue = (value: string) =>
  FORMULA_PREFIX.test(value) ? `'${value}` : value;

/**
 * Quote one CSV field: anything containing a comma, a double quote, a line
 * break or padding whitespace is wrapped in double quotes, and embedded quotes
 * are doubled. Formula-looking values are neutralised first.
 */
export const csvField = (value: string | number | null | undefined) => {
  if (value === null || value === undefined) return "";
  const text = neutralizeCsvValue(
    typeof value === "number" ? String(value) : value,
  );
  return /[",\r\n]|^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const csvRow = (fields: (string | number | null | undefined)[]) =>
  fields.map(csvField).join(",");

type CsvCell = string | number | null;

export function buildCsvRows(rows: ExportRow[], meta: ExportMeta): CsvCell[][] {
  const sections = buildPeriodSections(rows, meta);
  const showSections =
    sections.length > 1 || meta.groupBy === "week" || meta.groupBy === "month";
  const periodLabel = formatPeriod(meta);

  // Daily totals per employee+date, exactly as the spreadsheet computes them.
  const dayTotals = new Map<string, number>();
  const dayLastIndex = new Map<string, number>();
  rows.forEach((r, idx) => {
    const key = `${r.employee}__${r.date}`;
    dayTotals.set(key, (dayTotals.get(key) ?? 0) + (r.hours ?? 0));
    dayLastIndex.set(key, idx);
  });

  const showLocation = rows.some((r) => Boolean(r.location));
  const headers: CsvCell[] = showLocation
    ? [...CSV_COLUMNS, "Location"]
    : [...CSV_COLUMNS];
  const out: CsvCell[][] = [headers];
  let globalRowIdx = 0;

  for (const section of sections) {
    const label = showSections ? section.label : periodLabel;

    for (const r of section.rows) {
      const dayKey = `${r.employee}__${r.date}`;
      const isLastOfDay = dayLastIndex.get(dayKey) === globalRowIdx;
      out.push([
        "Shift",
        r.employee,
        r.date,
        r.dayOfWeek ?? getDayOfWeekShort(r.date),
        r.clockIn,
        r.clockOut,
        r.hours === null ? null : formatHours(r.hours),
        isLastOfDay ? formatHours(dayTotals.get(dayKey) as number) : null,
        label,
        null,
        null,
        null,
        ...(showLocation ? [r.location ?? ""] : []),
      ]);
      globalRowIdx += 1;
    }

    if (showSections && section.rows.length > 0) {
      out.push([
        "Period Subtotal",
        null,
        null,
        null,
        null,
        null,
        formatHours(section.totalHours),
        null,
        section.label,
        section.daysWorked,
        section.shiftsCount,
        null,
        ...(showLocation ? [null] : []),
      ]);
    }
  }

  out.push([
    "Total",
    null,
    null,
    null,
    null,
    null,
    formatHours(totalHours(rows)),
    null,
    periodLabel,
    new Set(rows.map((r) => r.date)).size,
    rows.length,
    null,
    ...(showLocation ? [null] : []),
  ]);

  for (const emp of buildEmployeeSummary(rows)) {
    out.push([
      "Employee Summary",
      emp.employee,
      null,
      null,
      null,
      null,
      formatHours(emp.totalHours),
      null,
      periodLabel,
      emp.daysWorked,
      emp.shiftsCount,
      formatHours(emp.totalHours / emp.daysWorked),
      ...(showLocation ? [null] : []),
    ]);
  }

  if (sections.length > 1) {
    for (const sec of sections) {
      out.push([
        "Period Summary",
        null,
        null,
        null,
        null,
        null,
        formatHours(sec.totalHours),
        null,
        sec.label,
        sec.daysWorked,
        sec.shiftsCount,
        null,
        ...(showLocation ? [null] : []),
      ]);
    }
  }

  return out;
}

export const toCsvText = (rows: ExportRow[], meta: ExportMeta) =>
  `${buildCsvRows(rows, meta).map(csvRow).join(CSV_EOL)}${CSV_EOL}`;

/**
 * Byte-order mark. Without it Excel reads a .csv as the machine's legacy
 * 8-bit codepage and mangles every non-ASCII name; every other spreadsheet
 * app skips it silently.
 */
const UTF8_BOM = "﻿";

export const toCsv = (rows: ExportRow[], meta: ExportMeta) =>
  utf8(`${UTF8_BOM}${toCsvText(rows, meta)}`);

export const CSV_MIME = "text/csv; charset=utf-8";

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
  } else if (format === "csv") {
    downloadFile(toCsv(rows, meta) as BlobPart, CSV_MIME, fileName);
  } else {
    downloadFile(toXlsx(rows, meta) as BlobPart, XLSX_MIME, fileName);
  }
}
