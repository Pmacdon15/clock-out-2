import type { ScheduledShift } from "./types";

/**
 * Adding scheduled shifts to the user's own calendar straight from the app,
 * without going through the AI: a Google Calendar "add event" link per shift,
 * and an iCalendar (.ics) file for one or many shifts that Apple Calendar,
 * Outlook and Google Calendar can all import.
 */

export type CalendarShiftEvent = {
  uid: string;
  title: string;
  description: string;
  start: Date;
  end: Date;
};

const DEFAULT_TITLE = "Shift · Clock Out";

/** A stable id per shift, so re-importing a shift updates it instead of duplicating it. */
export const shiftEventUid = (shift: Pick<ScheduledShift, "id" | "org_id">) =>
  `clockout-${shift.org_id}-shift-${shift.id}@clockout`;

export function shiftToCalendarEvent(
  shift: ScheduledShift,
  memberName?: string,
): CalendarShiftEvent {
  return {
    uid: shiftEventUid(shift),
    title: memberName ? `${memberName}: ${DEFAULT_TITLE}` : DEFAULT_TITLE,
    description: [
      ...(shift.note ? [shift.note, ""] : []),
      memberName
        ? `Scheduled in Clock Out for ${memberName}.`
        : "Scheduled in Clock Out.",
    ].join("\n"),
    start: new Date(shift.shift_start),
    end: new Date(shift.shift_end),
  };
}

/** UTC in the compact iCalendar / Google form: 20260105T090000Z. */
export const formatUtcStamp = (date: Date) =>
  `${date.toISOString().slice(0, 19).replace(/[-:]/g, "")}Z`;

/** A Google Calendar link that opens a prefilled "new event" page. */
export function googleCalendarUrl(event: CalendarShiftEvent): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${formatUtcStamp(event.start)}/${formatUtcStamp(event.end)}`,
    details: event.description,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Escapes text for an iCalendar TEXT value (RFC 5545 §3.3.11). */
export const escapeIcsText = (text: string) =>
  text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");

/** Folds a content line to at most 75 octets (RFC 5545 §3.1). */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const charSize = encoder.encode(char).length;
    const limit = parts.length === 0 ? 75 : 74;
    if (size + charSize > limit) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += char;
    size += charSize;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

/** An iCalendar file with one VEVENT per shift. */
export function buildIcsCalendar(
  events: CalendarShiftEvent[],
  now: Date = new Date(),
): string {
  const stamp = formatUtcStamp(now);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Clock Out//Schedule//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...events.flatMap((event) => [
      "BEGIN:VEVENT",
      `UID:${event.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${formatUtcStamp(event.start)}`,
      `DTEND:${formatUtcStamp(event.end)}`,
      `SUMMARY:${escapeIcsText(event.title)}`,
      `DESCRIPTION:${escapeIcsText(event.description)}`,
      "END:VEVENT",
    ]),
    "END:VCALENDAR",
  ];
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}

/** Downloads an .ics file in the browser. */
export function downloadIcs(events: CalendarShiftEvent[], fileName: string) {
  const blob = new Blob([buildIcsCalendar(events)], {
    type: "text/calendar;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName.endsWith(".ics") ? fileName : `${fileName}.ics`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
