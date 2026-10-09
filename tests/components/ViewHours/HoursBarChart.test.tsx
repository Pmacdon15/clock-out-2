import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeEntry } from "../../utils";

const mocks = vi.hoisted(() => ({
  has: vi.fn(),
  downloadElementAsImage: vi.fn(async () => {}),
}));

vi.mock("recharts", () => import("../../mocks/recharts"));
vi.mock("@clerk/nextjs", () => ({ useAuth: () => ({ has: mocks.has }) }));
vi.mock("@/lib/download", () => ({
  downloadElementAsImage: mocks.downloadElementAsImage,
}));

import { HoursBarChart } from "@/components/ViewHours/HoursBarChart";

type Props = Parameters<typeof HoursBarChart>[0];

const members = [
  { id: "u1", name: "Ada" },
  { id: "u2", name: "Grace" },
  { id: "u3", name: "Linus" },
];

const shift = (user_id: string, start: string, end: string | null) =>
  makeEntry({
    user_id,
    clock_in: new Date(start),
    clock_out: end ? new Date(end) : null,
  });

const entries = [
  shift("u1", "2026-03-09T09:00:00Z", "2026-03-09T12:00:00Z"),
  shift("u1", "2026-03-09T13:00:00Z", "2026-03-09T15:00:00Z"),
  shift("u2", "2026-03-09T09:00:00Z", "2026-03-09T10:30:00Z"),
  shift("u2", "2026-03-10T09:00:00Z", "2026-03-10T08:00:00Z"), // negative → 0
  shift("ghost", "2026-03-08T09:00:00Z", null), // still open
];

function renderChart(props: Partial<Props> = {}) {
  return render(
    <HoursBarChart
      endDate="2026-03-14T23:59:59.999"
      filteredEntries={entries}
      previousTotalHours={0}
      startDate="2026-03-08T00:00:00.000"
      timeframe="week"
      {...props}
    />,
  );
}

const chartData = (index = 0) =>
  JSON.parse(
    screen.getAllByTestId("bar-chart")[index].getAttribute("data-chart") ?? "",
  );

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-03-08T11:00:00Z"));
  mocks.has.mockReturnValue(false);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("HoursBarChart summary", () => {
  it.each<[Partial<Props>, string]>([
    [{ timeframe: "week" }, "Week 2 - March 2026"],
    [{ timeframe: "month", startDate: "2026-03-01" }, "March 2026"],
    [{ timeframe: "year" }, "2026"],
    [
      { timeframe: "custom", startDate: "2026-03-01", endDate: "2026-03-10" },
      "Mar 1, 2026 - Mar 10, 2026",
    ],
    [
      { timeframe: "custom", startDate: "2026-03-01", endDate: "" },
      "Mar 1, 2026 -",
    ],
    [{ timeframe: "all" }, "all"],
    [{ timeframe: "week", startDate: "" }, "week"],
  ])("describes %o as %s", (props, text) => {
    renderChart(props);
    expect(screen.getByText(text.trim())).toBeInTheDocument();
  });
});

describe("HoursBarChart for one person", () => {
  it("sums hours per day, counting open shifts up to now", () => {
    renderChart({ employeeName: "Ada" });
    expect(chartData()).toEqual([
      { name: "Mar 08", fullLabel: "Mar 08, 2026", hours: 2 },
      { name: "Mar 09", fullLabel: "Mar 09, 2026", hours: 6.5 },
      { name: "Mar 10", fullLabel: "Mar 10, 2026", hours: 0 },
    ]);
    expect(screen.getByText("8.50h")).toBeInTheDocument();
    expect(screen.getByText("Individual Hours")).toBeInTheDocument();
    expect(screen.getByText("Ada's Hours")).toBeInTheDocument();
    expect(
      screen.getByText("Daily logged work hours for the selected timeframe."),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("cell")).toHaveLength(3);
    expect(screen.getByTestId("bar")).toHaveAttribute("data-key", "hours");
  });

  it("uses the full date in tooltips when available", () => {
    renderChart();
    const tooltip = screen.getByTestId("tooltip");
    expect(within(tooltip).getByText("Full")).toBeInTheDocument();
    expect(within(tooltip).getByText("short")).toBeInTheDocument();
  });

  it("falls back to a generic employee name", () => {
    renderChart();
    expect(screen.getByText("Employee's Hours")).toBeInTheDocument();
  });

  it("hides the download button without the feature", () => {
    renderChart();
    expect(mocks.has).toHaveBeenCalledWith({ feature: "download_graph" });
    expect(screen.queryByText("Download graph")).not.toBeInTheDocument();
  });
});

describe("HoursBarChart trend", () => {
  it.each([
    ["week", 4.25, "100% more than last week"],
    ["month", 17, "50% less than last month"],
    ["year", 8.5, "0% more than last year"],
    ["custom", 17, "50% less"],
  ])(
    "compares %s totals with the previous period",
    (timeframe, previous, text) => {
      renderChart({ timeframe, previousTotalHours: previous });
      expect(screen.getByText(new RegExp(text))).toBeInTheDocument();
    },
  );
});

describe("HoursBarChart for the whole org", () => {
  it("stacks hours per visible member", () => {
    renderChart({
      isViewingAll: true,
      members,
      visibleMemberIds: new Set(["u1", "u2"]),
    });
    expect(chartData()).toEqual([
      { name: "Mar 08", fullLabel: "Mar 08, 2026", u1: 0, u2: 0, total: 0 },
      { name: "Mar 09", fullLabel: "Mar 09, 2026", u1: 5, u2: 1.5, total: 6.5 },
      { name: "Mar 10", fullLabel: "Mar 10, 2026", u1: 0, u2: 0, total: 0 },
    ]);
    expect(screen.getByText("6.50h")).toBeInTheDocument();
    expect(screen.getByText("Team Hours Summary")).toBeInTheDocument();
    expect(screen.getByText("Organization Hours")).toBeInTheDocument();

    const bars = screen.getAllByTestId("bar");
    expect(bars.map((b) => b.getAttribute("data-hidden"))).toEqual([
      "false",
      "false",
      "true",
    ]);
    // Only the top visible segment gets rounded corners.
    expect(bars.map((b) => b.getAttribute("data-radius"))).toEqual([
      "0",
      "[6,6,0,0]",
      "0",
    ]);
  });

  it("treats missing visibility as nobody visible", () => {
    renderChart({ isViewingAll: true, members });
    expect(chartData()[1]).toEqual({
      name: "Mar 09",
      fullLabel: "Mar 09, 2026",
      total: 0,
    });
    expect(
      screen.getAllByTestId("bar").map((b) => b.getAttribute("data-hidden")),
    ).toEqual(["true", "true", "true"]);
  });

  it("handles an org without members", () => {
    renderChart({ isViewingAll: true });
    expect(screen.queryByTestId("bar")).not.toBeInTheDocument();
  });
});

describe("HoursBarChart download", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout"] });
    vi.setSystemTime(new Date("2026-03-08T11:00:00Z"));
    mocks.has.mockReturnValue(true);
  });

  it("renders a printable report and downloads it", async () => {
    renderChart({ employeeName: "Ada Lovelace", members });
    fireEvent.click(screen.getByRole("button", { name: "Download graph" }));

    expect(
      screen.getByRole("button", { name: "Download graph" }),
    ).toBeDisabled();
    expect(
      screen.getByText("Ada Lovelace Hours Report: Week 2 - March 2026"),
    ).toBeInTheDocument();
    expect(screen.getByText("5 entries")).toBeInTheDocument();
    expect(screen.getByTestId("label-list")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.queryByText("Member")).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });

    expect(mocks.downloadElementAsImage).toHaveBeenCalledWith(
      expect.any(HTMLDivElement),
      "hours-report-ada-lovelace-week-2---march-2026",
    );
    expect(screen.queryByText("5 entries")).not.toBeInTheDocument();
  });

  it("includes member names in the org report", async () => {
    renderChart({
      isViewingAll: true,
      members,
      visibleMemberIds: new Set(["u1"]),
      previousTotalHours: 1,
    });
    fireEvent.click(screen.getByRole("button", { name: "Download graph" }));

    expect(
      screen.getByText("Organization Hours Report: Week 2 - March 2026"),
    ).toBeInTheDocument();
    expect(screen.getByText("Member")).toBeInTheDocument();
    expect(screen.getAllByText("Ada")).toHaveLength(2);
    expect(screen.getByText("Unknown")).toBeInTheDocument();
    // The trend is only shown on screen, not in the printable report.
    expect(screen.getAllByText(/more/)).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(mocks.downloadElementAsImage).toHaveBeenCalledWith(
      expect.any(HTMLDivElement),
      "hours-report-employee-week-2---march-2026",
    );
  });

  it("skips the capture if the chart unmounts first", async () => {
    const { unmount } = renderChart();
    fireEvent.click(screen.getByRole("button", { name: "Download graph" }));
    unmount();
    await vi.advanceTimersByTimeAsync(150);
    expect(mocks.downloadElementAsImage).not.toHaveBeenCalled();
  });
});
