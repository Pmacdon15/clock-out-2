import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeEntry } from "../../utils";

const mocks = vi.hoisted(() => ({
  auth: { has: vi.fn() as ((args: unknown) => boolean) | undefined },
  downloadElementAsImage: vi.fn(async () => {}),
}));

vi.mock("recharts", () => import("../../mocks/recharts"));
vi.mock("@clerk/nextjs", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/lib/download", () => ({
  downloadElementAsImage: mocks.downloadElementAsImage,
}));

import { COLORS, HoursLineChart } from "@/components/ViewHours/HoursLineChart";

type Props = Parameters<typeof HoursLineChart>[0];

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

const makeEntries = () => [
  shift("u1", "2026-03-09T09:00:00Z", "2026-03-09T12:00:00Z"),
  shift("u1", "2026-03-09T13:00:00Z", "2026-03-09T15:00:00Z"),
  shift("u2", "2026-03-10T09:00:00Z", "2026-03-10T09:00:00Z"), // zero length
  shift("u2", "2026-03-11T09:00:00Z", "2026-03-11T08:00:00Z"), // negative → 0
  shift("ghost", "2026-03-08T09:00:00Z", null), // still open
];

function renderChart(props: Partial<Props> = {}) {
  return render(
    <HoursLineChart
      endDate="2026-03-14T23:59:59.999"
      filteredEntries={makeEntries()}
      members={members}
      startDate="2026-03-08T00:00:00.000"
      timeframe="week"
      visibleMemberIds={new Set(["u1", "u2"])}
      {...props}
    />,
  );
}

const chartData = () =>
  JSON.parse(
    screen.getAllByTestId("line-chart")[0].getAttribute("data-chart") ?? "",
  );

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-03-08T11:00:00Z"));
  mocks.auth.has = vi.fn(() => false);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("HoursLineChart summary", () => {
  it.each<[Partial<Props>, string]>([
    [{ timeframe: "week" }, "Week 2 - March 2026"],
    [{ timeframe: "month", startDate: "2026-03-01" }, "March 2026"],
    [{ timeframe: "year" }, "2026"],
    [
      { timeframe: "custom", startDate: "2026-03-01", endDate: "2026-03-10" },
      "Mar 1, 2026 - Mar 10, 2026",
    ],
    [
      {
        timeframe: "custom",
        startDate: "2026-03-01T00:00:00",
        endDate: "2026-03-10T00:00:00",
      },
      "Mar 1, 2026 - Mar 10, 2026",
    ],
    [
      { timeframe: "custom", startDate: "2026-03-01", endDate: undefined },
      "Mar 1, 2026 -",
    ],
    [{ timeframe: "all" }, "all"],
    [{ timeframe: undefined }, "custom"],
    [{ timeframe: "year", startDate: undefined }, "year"],
    [{ timeframe: undefined, startDate: undefined }, "custom"],
  ])("describes %o as %s", (props, text) => {
    renderChart(props);
    expect(screen.getByText(text)).toBeInTheDocument();
  });
});

describe("HoursLineChart data", () => {
  it("plots daily hours per member, filling gaps with zero", () => {
    renderChart();
    expect(chartData()).toEqual([
      { name: "Mar 08", fullLabel: "Mar 08, 2026", u1: 0, u2: 0, u3: 0 },
      { name: "Mar 09", fullLabel: "Mar 09, 2026", u1: 5, u2: 0, u3: 0 },
      { name: "Mar 10", fullLabel: "Mar 10, 2026", u1: 0, u2: 0, u3: 0 },
      { name: "Mar 11", fullLabel: "Mar 11, 2026", u1: 0, u2: 0, u3: 0 },
    ]);
    // 5h logged plus 2h for the open shift up to now.
    expect(screen.getByText("7.00h")).toBeInTheDocument();
  });

  it("draws one line per member and hides invisible ones", () => {
    renderChart();
    const lines = screen.getAllByTestId("line");
    expect(lines.map((l) => l.getAttribute("data-key"))).toEqual([
      "u1",
      "u2",
      "u3",
    ]);
    expect(lines.map((l) => l.getAttribute("data-hidden"))).toEqual([
      "false",
      "false",
      "true",
    ]);
    expect(COLORS.length).toBeGreaterThan(members.length);
  });

  it("uses the full date in tooltips when available", () => {
    renderChart();
    const tooltip = screen.getByTestId("tooltip");
    expect(within(tooltip).getByText("Full")).toBeInTheDocument();
    expect(within(tooltip).getByText("short")).toBeInTheDocument();
  });

  it("titles a personal chart with the employee name", () => {
    renderChart({ employeeName: "Ada" });
    expect(screen.getByText("Ada's Hours")).toBeInTheDocument();
    expect(screen.getByText("Individual Hours")).toBeInTheDocument();
    expect(
      screen.getByText("Daily progression of logged hours over this period."),
    ).toBeInTheDocument();
  });

  it("falls back to a generic employee name", () => {
    renderChart();
    expect(screen.getByText("Employee's Hours")).toBeInTheDocument();
  });

  it("titles the org chart", () => {
    renderChart({ isViewingAll: true });
    expect(screen.getByText("Team Hours Over Time")).toBeInTheDocument();
    expect(screen.getByText("Organization Hours")).toBeInTheDocument();
  });
});

describe("HoursLineChart download", () => {
  it.each([
    ["has() returns false", () => false],
    ["has() is unavailable", undefined],
  ])("is hidden when %s", (_label, has) => {
    mocks.auth.has = has;
    renderChart();
    expect(screen.queryByText("Download graph")).not.toBeInTheDocument();
  });

  describe("when allowed", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date", "setTimeout"] });
      vi.setSystemTime(new Date("2026-03-08T11:00:00Z"));
      mocks.auth.has = vi.fn(() => true);
    });

    it("renders a printable org report and downloads it", async () => {
      renderChart({ isViewingAll: true });
      fireEvent.click(screen.getByRole("button", { name: "Download graph" }));
      expect(
        screen.getByRole("button", { name: "Download graph" }),
      ).toBeDisabled();

      expect(
        screen.getByText("Organization Hours Report: Week 2 - March 2026"),
      ).toBeInTheDocument();
      // Only members with logged hours appear in the breakdown.
      expect(screen.getByText("Employee Breakdown")).toBeInTheDocument();
      expect(screen.getByText("5.00h")).toBeInTheDocument();
      expect(screen.getByText("5 entries")).toBeInTheDocument();
      expect(screen.getByText("Unknown")).toBeInTheDocument();
      expect(screen.getByText("Active")).toBeInTheDocument();
      expect(screen.getAllByText("Grace")).toHaveLength(2);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(150);
      });
      expect(mocks.downloadElementAsImage).toHaveBeenCalledWith(
        expect.any(HTMLDivElement),
        "org-hours-report-week-2---march-2026",
      );
      expect(screen.queryByText("Employee Breakdown")).not.toBeInTheDocument();
    });

    it("titles a personal printable report", () => {
      renderChart({ employeeName: "Ada" });
      fireEvent.click(screen.getByRole("button", { name: "Download graph" }));
      expect(
        screen.getByText("Ada Hours Report: Week 2 - March 2026"),
      ).toBeInTheDocument();
    });

    it("falls back to a generic name in a personal printable report", () => {
      renderChart();
      fireEvent.click(screen.getByRole("button", { name: "Download graph" }));
      expect(
        screen.getByText("Employee Hours Report: Week 2 - March 2026"),
      ).toBeInTheDocument();
    });

    it("skips the capture if the chart unmounts first", async () => {
      const { unmount } = renderChart();
      fireEvent.click(screen.getByRole("button", { name: "Download graph" }));
      unmount();
      await vi.advanceTimersByTimeAsync(150);
      expect(mocks.downloadElementAsImage).not.toHaveBeenCalled();
    });
  });
});
