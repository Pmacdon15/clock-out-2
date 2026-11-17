import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JobsPanelProps } from "@/components/JobsPanel";
import type { JobHours, JobsHoursView } from "@/lib/jobs";
import { resolved } from "../utils";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  search: "timeframe=week",
  selector: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  usePathname: () => "/jobs",
  useSearchParams: () => new URLSearchParams(mocks.search),
}));
vi.mock("recharts", () => import("../mocks/recharts"));
vi.mock("@/components/ViewHours/TimeframeSelector", () => ({
  TimeframeSelector: (props: Record<string, unknown>) => {
    mocks.selector(props);
    return <div data-testid="timeframe" />;
  },
}));

import JobsPanel from "@/components/JobsPanel";

const acme: JobHours = {
  orgId: "org_a",
  name: "Acme",
  isAdmin: true,
  totalHours: 12,
  shifts: 2,
  members: [
    { userId: "me", name: "You", hours: 8, shifts: 1 },
    { userId: "u2", name: "Sam", hours: 4, shifts: 1 },
  ],
  entries: [
    {
      id: 2,
      userId: "u2",
      memberName: "Sam",
      clockIn: "2026-03-03T09:00:00.000Z",
      clockOut: null,
      hours: 4,
    },
    {
      id: 1,
      userId: "me",
      memberName: "You",
      clockIn: "2026-03-02T09:00:00.000Z",
      clockOut: "2026-03-02T17:00:00.000Z",
      hours: 8,
    },
  ],
};

const bakery: JobHours = {
  orgId: "org_b",
  name: "Bakery",
  isAdmin: false,
  totalHours: 0,
  shifts: 0,
  members: [],
  entries: [],
};

const view = (overrides: Partial<JobsHoursView> = {}): JobsHoursView => ({
  jobs: [acme, bakery].map(({ orgId, name, isAdmin }) => ({
    orgId,
    name,
    isAdmin,
  })),
  selected: ["org_a", "org_b"],
  results: [acme, bakery],
  totalHours: 12,
  shifts: 2,
  ...overrides,
});

function renderPanel(
  value: JobsHoursView | null,
  overrides: Partial<JobsPanelProps> = {},
) {
  render(
    <JobsPanel
      endDatePromise={resolved("2026-03-07")}
      startDatePromise={resolved("2026-03-01")}
      timeframePromise={resolved("month")}
      viewPromise={resolved(
        value
          ? { ok: true as const, value }
          : { ok: false as const, error: { reason: "boom" } },
      )}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  mocks.search = "timeframe=week";
});

describe("JobsPanel", () => {
  it("shows the error when the jobs can't be loaded", () => {
    renderPanel(null);
    expect(screen.getByText(/Error loading your jobs/)).toHaveTextContent(
      "boom",
    );
  });

  it("shows each job's hours, with members only in admin jobs", () => {
    renderPanel(view());
    expect(mocks.selector).toHaveBeenLastCalledWith(
      expect.objectContaining({
        timeframe: "month",
        startDate: "2026-03-01",
        endDate: "2026-03-07",
      }),
    );
    expect(screen.getByText("Total across 2 jobs")).toBeInTheDocument();
    expect(screen.getByText("12.00 h")).toBeInTheDocument();
    expect(screen.getByText("2 shifts")).toBeInTheDocument();

    const admin = within(screen.getByRole("region", { name: "Acme" }));
    expect(admin.getByText(/Admin · all members/)).toBeInTheDocument();
    expect(admin.getByText("12.00 h · 2 shifts")).toBeInTheDocument();
    // Member total, chart chip and shift row.
    expect(admin.getAllByText("Sam")).toHaveLength(3);
    expect(admin.getByText(/– now/)).toBeInTheDocument();
    expect(admin.getByText(/Mon Mar 2, 9:00 AM – 5:00 PM/)).toBeInTheDocument();

    const member = within(screen.getByRole("region", { name: "Bakery" }));
    expect(member.getByText(/Your hours only/)).toBeInTheDocument();
    expect(member.getByText("0.00 h · 0 shifts")).toBeInTheDocument();
    expect(member.getByText("No shifts in this range.")).toBeInTheDocument();
  });

  it("uses singular labels and defaults the range to today", () => {
    const one = { ...acme, shifts: 1, entries: acme.entries.slice(1) };
    renderPanel(view({ selected: ["org_a"], results: [one], shifts: 1 }), {
      timeframePromise: resolved(undefined),
      startDatePromise: resolved(undefined),
      endDatePromise: resolved(undefined),
    });
    const today = new Date().toLocaleDateString("en-CA");
    expect(mocks.selector).toHaveBeenLastCalledWith(
      expect.objectContaining({
        timeframe: "week",
        startDate: today,
        endDate: today,
      }),
    );
    expect(screen.getByText("Total across 1 job")).toBeInTheDocument();
    expect(screen.getByText("1 shift")).toBeInTheDocument();
    expect(screen.getByText("12.00 h · 1 shift")).toBeInTheDocument();
  });

  it("shows a job that failed to load", () => {
    renderPanel(
      view({ results: [{ ...bakery, error: "Could not load this job" }] }),
    );
    expect(screen.getByText("Could not load this job")).toBeInTheDocument();
  });

  it("says when the user has no jobs", () => {
    renderPanel(
      view({ jobs: [], selected: [], results: [], totalHours: 0, shifts: 0 }),
    );
    expect(
      screen.getByText("You aren't a member of any organization yet."),
    ).toBeInTheDocument();
  });

  it("narrows to the jobs ticked and keeps the other params", () => {
    renderPanel(view());
    fireEvent.click(screen.getByRole("checkbox", { name: "Acme" }));
    expect(mocks.push).toHaveBeenLastCalledWith(
      "/jobs?timeframe=week&jobs=org_b",
    );
  });

  it("never unticks the last job", () => {
    renderPanel(view({ selected: ["org_b"], results: [bakery] }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Bakery" }));
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("adds a job back and drops the param once all are ticked", () => {
    mocks.search = "jobs=org_b";
    renderPanel(view({ selected: ["org_b"], results: [bakery] }));
    expect(screen.getByRole("button", { name: "All jobs" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Acme" }));
    expect(mocks.push).toHaveBeenLastCalledWith("/jobs");
  });

  it("selects every job from the All jobs button", () => {
    mocks.search = "jobs=org_b&timeframe=week";
    renderPanel(view({ selected: ["org_b"], results: [bakery] }));
    fireEvent.click(screen.getByRole("button", { name: "All jobs" }));
    expect(mocks.push).toHaveBeenLastCalledWith("/jobs?timeframe=week");
  });

  it("charts each member in their own colour and switches bar/line", () => {
    renderPanel(view());
    const admin = within(screen.getByRole("region", { name: "Acme" }));
    const bars = admin.getAllByTestId("bar");
    expect(bars.map((b) => b.dataset.key)).toEqual(["me", "u2"]);
    expect(admin.getByRole("button", { name: "Day" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(admin.getByRole("button", { name: "Line" }));
    expect(admin.getByTestId("line-chart")).toBeInTheDocument();
    expect(admin.getAllByTestId("line")).toHaveLength(2);

    fireEvent.click(admin.getByRole("button", { name: "Month" }));
    const rows = JSON.parse(
      admin.getByTestId("line-chart").dataset.chart ?? "[]",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ total: 12, me: 8, u2: 4 });

    // No chart for a job without shifts.
    const member = within(screen.getByRole("region", { name: "Bakery" }));
    expect(member.queryByTestId("bar-chart")).toBeNull();
  });

  it("hides and shows a member's series but never the last one", () => {
    renderPanel(view());
    const admin = within(screen.getByRole("region", { name: "Acme" }));
    const sam = admin.getByRole("button", { name: "Sam" });
    fireEvent.click(sam);
    expect(sam).toHaveAttribute("aria-pressed", "false");
    expect(admin.getAllByTestId("bar").map((b) => b.dataset.hidden)).toEqual([
      "false",
      "true",
    ]);

    const you = admin.getByRole("button", { name: "You" });
    fireEvent.click(you);
    expect(you).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(sam);
    expect(admin.getAllByTestId("bar").map((b) => b.dataset.hidden)).toEqual([
      "false",
      "false",
    ]);
  });

  it("lists shifts a page at a time", () => {
    const entries = Array.from({ length: 25 }, (_, i) => ({
      id: i + 1,
      userId: "me",
      memberName: "You",
      clockIn: new Date(Date.UTC(2026, 2, 1 + i, 9)).toISOString(),
      clockOut: new Date(Date.UTC(2026, 2, 1 + i, 10)).toISOString(),
      hours: 1,
    }));
    const big = { ...bakery, totalHours: 25, shifts: 25, entries };
    renderPanel(view({ selected: ["org_b"], results: [big] }));
    const job = within(screen.getByRole("region", { name: "Bakery" }));
    const items = () => job.getAllByRole("listitem");

    expect(items()).toHaveLength(10);
    expect(job.getByText("Showing 10 of 25")).toBeInTheDocument();
    fireEvent.click(job.getByRole("button", { name: "Show 10 more" }));
    expect(items()).toHaveLength(20);
    fireEvent.click(job.getByRole("button", { name: "Show 5 more" }));
    expect(items()).toHaveLength(25);
    expect(job.queryByRole("button", { name: /more/ })).toBeNull();

    fireEvent.click(job.getByRole("button", { name: "Show less" }));
    expect(items()).toHaveLength(10);
    fireEvent.click(job.getByRole("button", { name: "Show all" }));
    expect(items()).toHaveLength(25);

    fireEvent.click(job.getByRole("button", { name: /Shifts \(25\)/ }));
    expect(job.queryAllByRole("listitem")).toHaveLength(0);
  });
});
