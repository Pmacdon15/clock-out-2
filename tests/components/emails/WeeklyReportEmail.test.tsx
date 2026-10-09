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
});
