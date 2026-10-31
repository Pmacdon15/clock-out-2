import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BreakSettingsData, TimeEntry } from "@/lib/types";
import { makeBreak, makeEntry, renderWithClient } from "../utils";

const mocks = vi.hoisted(() => ({
  clockInAction: vi.fn(),
  clockOutAction: vi.fn(),
  startBreakAction: vi.fn(),
  endBreakAction: vi.fn(),
  useTimeframeDefaults: vi.fn(),
  captureCurrentPosition: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/lib/actions", () => ({
  clockInAction: mocks.clockInAction,
  clockOutAction: mocks.clockOutAction,
  startBreakAction: mocks.startBreakAction,
  endBreakAction: mocks.endBreakAction,
}));
vi.mock("@/lib/geolocation", () => ({
  captureCurrentPosition: mocks.captureCurrentPosition,
}));
vi.mock("@/hooks/useTimeframeDefaults", () => ({
  useTimeframeDefaults: mocks.useTimeframeDefaults,
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import TimeClock from "@/components/time-clock";

const NOW = new Date("2026-01-05T12:00:00Z");

const settings = (
  overrides: Partial<BreakSettingsData> = {},
): BreakSettingsData => ({
  org_id: "org_1",
  dock_lunch: false,
  lunch_duration_minutes: 30,
  lunch_min_shift_hours: 5,
  max_paid_break_minutes: 15,
  ...overrides,
});

function onBreak(
  breakType: "paid_rest" | "unpaid_meal" | "unpaid_rest",
  startedAt: string,
): TimeEntry {
  return makeEntry({
    id: 3,
    clock_in: new Date("2026-01-05T10:00:00Z"),
    clock_out: null,
    breaks: [
      makeBreak({
        id: 50,
        time_entry_id: 3,
        break_type: breakType,
        break_start: new Date(startedAt),
        break_end: null,
      }),
    ],
  });
}

function renderClock(entry: TimeEntry, breakSettings: BreakSettingsData) {
  const setOptimisticEntries = vi.fn();
  renderWithClient(
    <TimeClock
      breakSettings={breakSettings}
      initialEntries={[entry]}
      isAdmin={false}
      setOptimisticEntries={setOptimisticEntries}
    />,
  );
  return setOptimisticEntries;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TimeClock break limits", () => {
  it("counts down to the limit while the break runs", () => {
    renderClock(onBreak("paid_rest", "2026-01-05T11:50:00Z"), settings());
    expect(screen.getByTestId("break-remaining")).toHaveTextContent(
      "5m left · you'll be clocked back in automatically",
    );
    expect(mocks.endBreakAction).not.toHaveBeenCalled();
  });

  it("shows no countdown for a break type without a limit", () => {
    renderClock(onBreak("unpaid_rest", "2026-01-05T11:50:00Z"), settings());
    expect(screen.queryByTestId("break-remaining")).not.toBeInTheDocument();
  });

  it("limits meal periods to the lunch deduction while lunch is docked", () => {
    renderClock(
      onBreak("unpaid_meal", "2026-01-05T11:40:00Z"),
      settings({ dock_lunch: true, lunch_duration_minutes: 30 }),
    );
    expect(screen.getByTestId("break-remaining")).toHaveTextContent("10m left");
  });

  it("ends an expired break at its limit and tells the member to get back to work", async () => {
    mocks.endBreakAction.mockResolvedValue({ success: true });
    const setOptimisticEntries = renderClock(
      onBreak("paid_rest", "2026-01-05T11:40:00Z"),
      settings(),
    );

    expect(setOptimisticEntries).toHaveBeenCalledWith({
      type: "UPDATE",
      payload: {
        id: 3,
        updated_at: NOW,
        breaks: [
          expect.objectContaining({
            id: 50,
            break_end: new Date("2026-01-05T11:55:00Z"),
          }),
        ],
      },
    });
    await waitFor(() => expect(mocks.endBreakAction).toHaveBeenCalledTimes(1));
    expect(
      screen.getByText("Break's over — time to get back to work"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Your paid rest break reached the 15-minute limit set by your organization, so you've been clocked back in automatically.",
      ),
    ).toBeInTheDocument();
    expect(mocks.toast.error).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Back to work" }));
    await waitFor(() =>
      expect(
        screen.queryByText("Break's over — time to get back to work"),
      ).not.toBeInTheDocument(),
    );
    // Re-renders never end the same break twice.
    expect(mocks.endBreakAction).toHaveBeenCalledTimes(1);
  });

  it("auto-ends the break when the countdown reaches the limit", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(NOW);
    mocks.endBreakAction.mockResolvedValue({ success: true });
    renderClock(onBreak("paid_rest", "2026-01-05T11:59:30Z"), settings());
    expect(screen.getByTestId("break-remaining")).toHaveTextContent("15m left");
    expect(mocks.endBreakAction).not.toHaveBeenCalled();

    act(() => {
      vi.setSystemTime(new Date("2026-01-05T12:14:30Z"));
      vi.advanceTimersByTime(1000);
    });
    expect(
      screen.getByText("Break's over — time to get back to work"),
    ).toBeInTheDocument();
    // The mutation runs asynchronously; let real timers drive waitFor.
    vi.useRealTimers();
    await waitFor(() => expect(mocks.endBreakAction).toHaveBeenCalledTimes(1));
  });

  it("leaves the shift's earlier breaks untouched when auto-ending", () => {
    mocks.endBreakAction.mockResolvedValue({ success: true });
    const entry = onBreak("paid_rest", "2026-01-05T11:40:00Z");
    const earlier = makeBreak({
      id: 49,
      time_entry_id: 3,
      break_type: "unpaid_meal",
      break_start: new Date("2026-01-05T10:30:00Z"),
      break_end: new Date("2026-01-05T11:00:00Z"),
    });
    const running = entry.breaks?.[0];
    const setOptimisticEntries = renderClock(
      { ...entry, breaks: [earlier, ...(entry.breaks ?? [])] },
      settings(),
    );
    expect(setOptimisticEntries).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          breaks: [
            earlier,
            { ...running, break_end: new Date("2026-01-05T11:55:00Z") },
          ],
        }),
      }),
    );
  });

  it.each([
    ["the server error", "Gone", "Gone"],
    ["a fallback message", "", "Failed to end break"],
  ])("shows %s when the auto-end fails", async (_l, error, shown) => {
    mocks.endBreakAction.mockResolvedValue({ success: false, error });
    renderClock(onBreak("paid_rest", "2026-01-05T11:40:00Z"), settings());
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(shown));
  });

  it("stays quiet for a failed auto-end without an error field", async () => {
    mocks.endBreakAction.mockResolvedValue({ success: false });
    renderClock(onBreak("paid_rest", "2026-01-05T11:40:00Z"), settings());
    await waitFor(() => expect(mocks.endBreakAction).toHaveBeenCalled());
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });
});
