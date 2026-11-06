import { QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BreakSettingsData, TimeEntry } from "@/lib/types";
import {
  createQueryClient,
  makeBreak,
  makeEntry,
  renderWithClient,
} from "../utils";

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

const CLOCK_TOAST = { id: "time-clock" };
const BACK_TO_WORK = "Break's over — time to get back to work";

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

    // Nothing changes until the server has ended the break.
    expect(screen.getByTestId("running-break")).toBeInTheDocument();
    expect(screen.queryByText(BACK_TO_WORK)).not.toBeInTheDocument();

    expect(await screen.findByText(BACK_TO_WORK)).toBeInTheDocument();
    expect(
      screen.getByText(
        "Your paid rest break reached the 15-minute limit set by your organization, so you've been clocked back in automatically.",
      ),
    ).toBeInTheDocument();
    // The break view swaps once the dialog covers the card.
    await waitFor(() =>
      expect(screen.queryByTestId("running-break")).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Break type")).toBeInTheDocument();
    expect(mocks.toast.error).not.toHaveBeenCalled();
    // The swap is local, so a dropped optimistic update can't undo it.
    expect(setOptimisticEntries).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Back to work" }));
    await waitFor(() =>
      expect(screen.queryByText(BACK_TO_WORK)).not.toBeInTheDocument(),
    );
    // Re-renders never end the same break twice.
    expect(mocks.endBreakAction).toHaveBeenCalledTimes(1);
  });

  it("keeps an auto-ended break over when a refresh still shows it running", async () => {
    mocks.endBreakAction.mockResolvedValue({ success: true });
    const stale = onBreak("paid_rest", "2026-01-05T11:40:00Z");
    const client = createQueryClient();
    const ui = (entries: TimeEntry[]) => (
      <QueryClientProvider client={client}>
        <TimeClock
          breakSettings={settings()}
          initialEntries={entries}
          isAdmin={false}
          setOptimisticEntries={vi.fn()}
        />
      </QueryClientProvider>
    );
    const { rerender } = render(ui([stale]));
    await waitFor(() =>
      expect(screen.queryByTestId("running-break")).not.toBeInTheDocument(),
    );

    rerender(ui([{ ...stale }]));
    expect(screen.queryByTestId("running-break")).not.toBeInTheDocument();
    expect(mocks.endBreakAction).toHaveBeenCalledTimes(1);
  });

  it("quietly shows the break as over when the server already ended it", async () => {
    mocks.endBreakAction.mockResolvedValue({
      success: false,
      error: "No break is running",
    });
    renderClock(onBreak("paid_rest", "2026-01-05T11:40:00Z"), settings());

    await waitFor(() =>
      expect(screen.queryByTestId("running-break")).not.toBeInTheDocument(),
    );
    expect(screen.queryByText(BACK_TO_WORK)).not.toBeInTheDocument();
    expect(mocks.toast.error).not.toHaveBeenCalled();
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
    // The mutation runs asynchronously; let real timers drive waitFor.
    vi.useRealTimers();
    expect(await screen.findByText(BACK_TO_WORK)).toBeInTheDocument();
    expect(mocks.endBreakAction).toHaveBeenCalledTimes(1);
  });

  it("leaves the shift's earlier breaks untouched when auto-ending", async () => {
    mocks.endBreakAction.mockResolvedValue({ success: true });
    const entry = onBreak("paid_rest", "2026-01-05T11:40:00Z");
    const earlier = makeBreak({
      id: 49,
      time_entry_id: 3,
      break_type: "unpaid_meal",
      break_start: new Date("2026-01-05T10:30:00Z"),
      break_end: new Date("2026-01-05T11:00:00Z"),
    });
    const setOptimisticEntries = vi.fn();
    renderWithClient(
      <TimeClock
        breakSettings={settings()}
        // An earlier shift without breaks sits under the open one.
        initialEntries={[
          { ...entry, breaks: [earlier, ...(entry.breaks ?? [])] },
          makeEntry({ id: 2 }),
        ]}
        isAdmin={false}
        setOptimisticEntries={setOptimisticEntries}
      />,
    );
    await waitFor(() =>
      expect(screen.queryByTestId("running-break")).not.toBeInTheDocument(),
    );
    // The earlier unpaid lunch still counts; the paid break added nothing.
    expect(
      screen.getByText("30m of unpaid break deducted so far"),
    ).toBeInTheDocument();
  });

  it.each([
    ["the server error", "Gone", "Gone"],
    ["a fallback message", "", "Failed to end break"],
  ])("shows %s when the auto-end fails", async (_l, error, shown) => {
    mocks.endBreakAction.mockResolvedValue({ success: false, error });
    renderClock(onBreak("paid_rest", "2026-01-05T11:40:00Z"), settings());
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(shown, CLOCK_TOAST),
    );
    // The server didn't end it, so the member isn't shown back at work.
    expect(screen.getByTestId("running-break")).toBeInTheDocument();
    expect(screen.queryByText(BACK_TO_WORK)).not.toBeInTheDocument();
  });

  it("reports an auto-end that throws", async () => {
    mocks.endBreakAction.mockRejectedValue(new Error("network"));
    renderClock(onBreak("paid_rest", "2026-01-05T11:40:00Z"), settings());
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(
        "Failed to end break",
        CLOCK_TOAST,
      ),
    );
  });

  it("stays quiet for a failed auto-end without an error field", async () => {
    mocks.endBreakAction.mockResolvedValue({ success: false });
    renderClock(onBreak("paid_rest", "2026-01-05T11:40:00Z"), settings());
    await waitFor(() => expect(mocks.endBreakAction).toHaveBeenCalled());
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });
});
