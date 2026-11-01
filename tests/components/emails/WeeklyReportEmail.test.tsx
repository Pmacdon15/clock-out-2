import { render } from "@react-email/render";
import { describe, expect, it } from "vitest";
import WeeklyReportEmail, {
  WeeklyReportEmail as NamedExport,
} from "@/components/emails/WeeklyReportEmail";

type Props = Parameters<typeof WeeklyReportEmail>[0];

const base: Props = {
  userName: "Grace",
  totalHours: "5h 0m",
  periodStart: "Jan 1, 2026",
  periodEnd: "Jan 7, 2026",
  chartUrl: "https://quickchart.io/chart?c=x",
  dashboardUrl: "https://clockout.test",
  breakdown: [
    {
      date: "Jan 2, 2026",
      shifts: [
        { start: "9:00 AM", end: "12:15 PM", duration: "3h 15m" },
        { start: "1:00 PM", end: "1:45 PM", duration: "45m" },
      ],
    },
  ],
};

/** Renders the email and parses it into a document for querying. */
async function renderEmail(props: Props) {
  const html = await render(WeeklyReportEmail(props));
  return new DOMParser().parseFromString(html, "text/html");
}

const dashboardLinks = (doc: Document) =>
  Array.from(doc.querySelectorAll("a")).map((a) => a.getAttribute("href"));

describe("WeeklyReportEmail", () => {
  it("is exported both as default and by name", () => {
    expect(NamedExport).toBe(WeeklyReportEmail);
  });

  it("summarises the period and lists each day's shifts", async () => {
    const doc = await renderEmail(base);
    const text = doc.body.textContent ?? "";
    expect(text).toContain("Here is the weekly hours report for Grace");
    expect(text).toContain("from Jan 1, 2026 to Jan 7, 2026");
    expect(text).toContain("Total Hours Logged: 5h 0m");
    expect(text).toContain("Jan 2, 2026");
    expect(text).toContain("9:00 AM - 12:15 PM");
    expect(text).toContain("3h 15m");
    expect(text).toContain("45m");
    expect(text).not.toContain("No hours logged in this period.");
    expect(doc.querySelector("img")?.getAttribute("src")).toBe(base.chartUrl);
  });

  it("calls on-demand (custom range) reports an hours report, not weekly", async () => {
    const doc = await renderEmail({ ...base, timeframe: "custom" });
    const text = doc.body.textContent ?? "";
    expect(text).toContain("Here is the hours report for Grace");
    expect(text).not.toContain("weekly hours report");
  });

  it("links to the week view with every identifying param", async () => {
    const doc = await renderEmail({
      ...base,
      userId: "user_1",
      orgId: "org_1",
      week: "2",
      month: "0",
      year: "2026",
      customStart: "2026-01-01",
      customEnd: "2026-01-07",
    });
    const expected =
      "https://clockout.test/?defaultTab=view&timeframe=week&userId=user_1&orgId=org_1&week=2&month=0&year=2026";
    expect(dashboardLinks(doc)).toEqual([expected, expected]);
  });

  it("links to a custom range for custom timeframes", async () => {
    const doc = await renderEmail({
      ...base,
      timeframe: "custom",
      week: "2",
      customStart: "2026-01-01",
      customEnd: "2026-01-15",
    });
    expect(dashboardLinks(doc)[0]).toBe(
      "https://clockout.test/?defaultTab=view&timeframe=custom&start=2026-01-01&end=2026-01-15",
    );
  });

  it("omits missing custom range params", async () => {
    const doc = await renderEmail({ ...base, timeframe: "custom" });
    expect(dashboardLinks(doc)[0]).toBe(
      "https://clockout.test/?defaultTab=view&timeframe=custom",
    );
  });

  it("lists the break records of a shift that has them", async () => {
    const doc = await renderEmail({
      ...base,
      breakdown: [
        {
          date: "Jan 2, 2026",
          shifts: [
            {
              start: "9:00 AM",
              end: "5:00 PM",
              duration: "7h 30m",
              breaks: "Meal period 12:00 PM - 12:30 PM (30m, unpaid)",
            },
          ],
        },
      ],
    });
    const text = doc.body.textContent ?? "";
    expect(text).toContain(
      "Breaks: Meal period 12:00 PM - 12:30 PM (30m, unpaid)",
    );
  });

  it("falls back to defaults and an empty state", async () => {
    const doc = await renderEmail({} as Props);
    const text = doc.body.textContent ?? "";
    expect(text).toContain("report for User");
    expect(text).toContain("from Jan 1, 2024 to Jan 7, 2024");
    expect(text).toContain("Total Hours Logged: 0h 0m");
    expect(text).toContain("No hours logged in this period.");
    expect(doc.querySelector("img")).toBeNull();
    expect(dashboardLinks(doc)[0]).toBe(
      "https://clockout.patmac.ca/?defaultTab=view&timeframe=week",
    );
  });

  it("leaves overtime out when the org tracks none", async () => {
    const doc = await renderEmail(base);
    expect(doc.body.textContent).not.toMatch(/overtime/i);
  });

  it("splits out regular and overtime hours, per day and per shift", async () => {
    const doc = await renderEmail({
      ...base,
      totalHours: "10h 0m",
      regularHours: "8h 0m",
      overtimeHours: "2h 0m",
      overtimePolicy: "over 8h/day",
      breakdown: [
        {
          date: "Jan 2, 2026",
          overtime: "2h 0m",
          shifts: [
            { start: "8:00 AM", end: "2:00 PM", duration: "6h 0m" },
            {
              start: "3:00 PM",
              end: "7:00 PM",
              duration: "4h 0m",
              overtime: "2h 0m",
            },
          ],
        },
      ],
    });
    const text = doc.body.textContent ?? "";
    expect(text).toContain("Regular: 8h 0m · Overtime: 2h 0m");
    expect(text).toContain("(hours over 8h/day)");
    expect(text).toContain("Jan 2, 2026 · 2h 0m overtime");
    expect(text).toContain("4h 0m (+2h 0m OT)");
    expect(text).not.toContain("6h 0m (+");
  });

  it("omits the policy note when none is given", async () => {
    const doc = await renderEmail({
      ...base,
      regularHours: "5h 0m",
      overtimeHours: "0m",
    });
    const text = doc.body.textContent ?? "";
    expect(text).toContain("Overtime: 0m");
    expect(text).not.toContain("(hours ");
  });
  it("shows approved time off when there is some", async () => {
    const doc = await renderEmail({
      ...base,
      totalTimeOff: "16h",
      timeOff: [
        { type: "Vacation", dates: "Jan 1 – Jan 2, 2026", hours: "16h" },
      ],
    });
    const text = doc.body.textContent ?? "";
    expect(text).toContain("Approved Time Off: 16h");
    expect(text).toContain("Vacation · Jan 1 – Jan 2, 2026");
  });

  it("leaves time off out when there is none", async () => {
    const text = (await renderEmail(base)).body.textContent ?? "";
    expect(text).not.toContain("Approved Time Off");
    expect(text).not.toContain("Time Off");
  });
});
