import { describe, expect, it } from "vitest";
import {
  buildIcsCalendar,
  escapeIcsText,
  foldIcsLine,
  formatUtcStamp,
  googleCalendarUrl,
  outlookCalendarUrl,
  shiftEventUid,
  shiftToCalendarEvent,
} from "@/lib/calendar-export";
import type { ScheduledShift } from "@/lib/types";

const shift: ScheduledShift = {
  id: 7,
  org_id: "org_1",
  user_id: "user_1",
  shift_start: new Date("2026-01-05T09:00:00Z"),
  shift_end: new Date("2026-01-05T17:30:00Z"),
  note: "Front desk, bring keys",
  created_by: "admin_1",
};

describe("calendar export", () => {
  it("turns a shift into a calendar event with a stable uid", () => {
    expect(shiftEventUid(shift)).toBe("clockout-org_1-shift-7@clockout");
    expect(shiftToCalendarEvent(shift)).toEqual({
      uid: "clockout-org_1-shift-7@clockout",
      title: "Shift · Clock Out",
      description: "Front desk, bring keys\n\nScheduled in Clock Out.",
      start: shift.shift_start,
      end: shift.shift_end,
    });
    const named = shiftToCalendarEvent({ ...shift, note: null }, "Sam");
    expect(named.title).toBe("Sam: Shift · Clock Out");
    expect(shiftToCalendarEvent(shift, undefined, "Acme Coffee").title).toBe(
      "Shift · Acme Coffee",
    );
    expect(shiftToCalendarEvent(shift, "Sam", "Acme").title).toBe(
      "Sam: Shift · Acme",
    );
    expect(shiftToCalendarEvent(shift, undefined, "  ").title).toBe(
      "Shift · Clock Out",
    );
    expect(named.description).toBe("Scheduled in Clock Out for Sam.");
  });

  it("builds a Google Calendar link with UTC times", () => {
    expect(formatUtcStamp(shift.shift_start)).toBe("20260105T090000Z");
    const url = new URL(googleCalendarUrl(shiftToCalendarEvent(shift)));
    expect(url.origin).toBe("https://calendar.google.com");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("text")).toBe("Shift · Clock Out");
    expect(url.searchParams.get("dates")).toBe(
      "20260105T090000Z/20260105T173000Z",
    );
    expect(url.searchParams.get("details")).toContain("Front desk");
  });

  it("escapes and folds iCalendar text", () => {
    expect(escapeIcsText("a;b,c\\d\ne")).toBe("a\\;b\\,c\\\\d\\ne");
    expect(foldIcsLine("short")).toBe("short");
    const folded = foldIcsLine(`SUMMARY:${"é".repeat(80)}`);
    for (const line of folded.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(folded.replace(/\r\n /g, "")).toBe(`SUMMARY:${"é".repeat(80)}`);
  });

  it("builds an iCalendar file with one event per shift", () => {
    const ics = buildIcsCalendar(
      [
        shiftToCalendarEvent(shift),
        shiftToCalendarEvent({ ...shift, id: 8 }, "Sam"),
      ],
      new Date("2026-01-01T00:00:00Z"),
    );
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain("UID:clockout-org_1-shift-7@clockout");
    expect(ics).toContain("UID:clockout-org_1-shift-8@clockout");
    expect(ics).toContain("DTSTAMP:20260101T000000Z");
    expect(ics).toContain("DTSTART:20260105T090000Z");
    expect(ics).toContain("DTEND:20260105T173000Z");
    expect(ics).toContain("SUMMARY:Sam: Shift · Clock Out");
    expect(ics).toContain(
      "DESCRIPTION:Front desk\\, bring keys\\n\\nScheduled in Clock Out.",
    );
  });

  it("builds an Outlook link with the shift's times", () => {
    const url = new URL(outlookCalendarUrl(shiftToCalendarEvent(shift)));
    expect(url.origin).toBe("https://outlook.live.com");
    expect(url.searchParams.get("rru")).toBe("addevent");
    expect(url.searchParams.get("subject")).toBe("Shift · Clock Out");
    expect(url.searchParams.get("startdt")).toBe("2026-01-05T09:00:00.000Z");
    expect(url.searchParams.get("enddt")).toBe("2026-01-05T17:30:00.000Z");
  });

  it("names the calendar and asks apps to refresh it hourly", () => {
    const ics = buildIcsCalendar([], new Date(), "Shifts, Acme");
    expect(ics).toContain("X-WR-CALNAME:Shifts\\, Acme");
    expect(ics).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT1H");
    expect(ics).not.toContain("BEGIN:VEVENT");
  });
});
