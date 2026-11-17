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
    expect(admin.getAllByText("Sam")).toHaveLength(2);
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
});
