import { act, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScheduledShift, TimeEntry } from "@/lib/types";
import { makeEntry, renderWithClient } from "../utils";

vi.mock("@/lib/actions", () => ({
  clockInAction: vi.fn(),
  clockOutAction: vi.fn(),
  startBreakAction: vi.fn(),
  endBreakAction: vi.fn(),
}));
vi.mock("@/lib/geolocation", () => ({ captureCurrentPosition: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import TimeClock from "@/components/time-clock";

const NOW = new Date("2026-01-05T12:00:00Z");

const shift: ScheduledShift = {
  id: 1,
  org_id: "org_1",
  user_id: "user_1",
  shift_start: new Date("2026-01-05T09:00:00Z"),
  shift_end: new Date("2026-01-05T17:00:00Z"),
  note: null,
  created_by: "admin_1",
};

const working = makeEntry({
  id: 3,
  clock_in: new Date("2026-01-05T08:55:00Z"),
  clock_out: null,
});

function renderClock(entries: TimeEntry[], scheduledShifts?: ScheduledShift[]) {
  renderWithClient(
    <TimeClock
      initialEntries={entries}
      isAdmin={false}
      scheduledShifts={scheduledShifts}
      setOptimisticEntries={vi.fn()}
    />,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TimeClock shift countdown", () => {
  it("counts down to the end of the shift being worked", () => {
    renderClock([working], [shift]);
    const countdown = screen.getByTestId("shift-countdown");
    expect(countdown).toHaveTextContent("Shift ends in 5h 0m · 5:00 PM");

    act(() => {
      vi.advanceTimersByTime(4 * 60 * 60 * 1000 + 59 * 60 * 1000 + 30_000);
    });
    // The last minute reads "1m", not "0m".
    expect(countdown).toHaveTextContent("Shift ends in 1m");
  });

  it("says how long ago the shift ended while still on the clock", () => {
    vi.setSystemTime(new Date("2026-01-05T17:20:00Z"));
    renderClock([working], [shift]);
    expect(screen.getByTestId("shift-countdown")).toHaveTextContent(
      "Shift ended 20m ago · 5:00 PM",
    );
  });

  it("shows nothing when the punch fits no scheduled shift", () => {
    const tomorrow = {
      ...shift,
      shift_start: new Date("2026-01-06T09:00:00Z"),
      shift_end: new Date("2026-01-06T17:00:00Z"),
    };
    renderClock([working], [tomorrow]);
    expect(screen.queryByTestId("shift-countdown")).not.toBeInTheDocument();
  });

  it("shows nothing without any shifts", () => {
    renderClock([working]);
    expect(screen.queryByTestId("shift-countdown")).not.toBeInTheDocument();
  });

  it("shows nothing while clocked out", () => {
    renderClock([], [shift]);
    expect(screen.queryByTestId("shift-countdown")).not.toBeInTheDocument();
  });
});
