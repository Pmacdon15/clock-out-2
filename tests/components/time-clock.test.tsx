import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeBreak, makeEntry, renderWithClient } from "../utils";

const mocks = vi.hoisted(() => ({
  clockInAction: vi.fn(),
  clockOutAction: vi.fn(),
  startBreakAction: vi.fn(),
  endBreakAction: vi.fn(),
  useTimeframeDefaults: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/actions", () => ({
  clockInAction: mocks.clockInAction,
  clockOutAction: mocks.clockOutAction,
  startBreakAction: mocks.startBreakAction,
  endBreakAction: mocks.endBreakAction,
}));
vi.mock("@/hooks/useTimeframeDefaults", () => ({
  useTimeframeDefaults: mocks.useTimeframeDefaults,
}));
vi.mock("@/components/DeleteConfirmDialog", () => ({
  DeleteConfirmDialog: ({
    entryId,
    trigger,
  }: {
    entryId: number;
    trigger: React.ReactNode;
  }) => <div data-testid={`delete-${entryId}`}>{trigger}</div>,
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import TimeClock from "@/components/time-clock";

const NOW = new Date("2026-01-05T12:00:00Z");

function renderClock(
  entries: ReturnType<typeof makeEntry>[] = [],
  isAdmin = false,
) {
  const setOptimisticEntries = vi.fn();
  renderWithClient(
    <TimeClock
      initialEntries={entries}
      isAdmin={isAdmin}
      setOptimisticEntries={setOptimisticEntries}
    />,
  );
  return setOptimisticEntries;
}

beforeEach(() => {
  // Only fake the clock; waitFor needs real timers to poll.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TimeClock when clocked out", () => {
  it("sets up timeframe defaults and offers to clock in", () => {
    renderClock();
    expect(mocks.useTimeframeDefaults).toHaveBeenCalled();
    expect(screen.getByText("Offline")).toBeInTheDocument();
    expect(screen.getByText("Ready to start your shift?")).toBeInTheDocument();
  });

  it("adds an optimistic entry and clocks in", async () => {
    mocks.clockInAction.mockResolvedValue({ success: true });
    const setOptimisticEntries = renderClock();
    fireEvent.click(screen.getByRole("button", { name: "Clock In" }));

    expect(setOptimisticEntries).toHaveBeenCalledWith({
      type: "ADD",
      payload: expect.objectContaining({
        user_id: "current",
        org_id: "current",
        clock_in: NOW,
        clock_out: null,
      }),
    });
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith("Clocked in"),
    );
  });

  it.each([
    ["the server error", "Over limit", "Over limit"],
    ["a fallback message", "", "Failed to clock in"],
  ])("shows %s when clocking in fails", async (_l, error, shown) => {
    mocks.clockInAction.mockResolvedValue({ success: false, error });
    renderClock();
    fireEvent.click(screen.getByRole("button", { name: "Clock In" }));
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(shown));
  });

  it("stays quiet for a failed result without an error field", async () => {
    mocks.clockInAction.mockResolvedValue({ success: false });
    renderClock();
    fireEvent.click(screen.getByRole("button", { name: "Clock In" }));
    await waitFor(() => expect(mocks.clockInAction).toHaveBeenCalled());
    expect(mocks.toast.success).not.toHaveBeenCalled();
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });

  it("disables the button while clocking in", async () => {
    mocks.clockInAction.mockReturnValue(new Promise(() => {}));
    renderClock();
    const button = screen.getByRole("button", { name: "Clock In" });
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
  });
});

describe("TimeClock when clocked in", () => {
  const older = makeEntry({
    id: 1,
    clock_in: new Date("2026-01-05T08:00:00Z"),
    clock_out: null,
  });
  const active = makeEntry({
    id: 2,
    clock_in: new Date("2026-01-05T10:55:00Z"),
    clock_out: null,
  });

  it("shows the most recent open session and ticks the timer", () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(NOW);
    renderClock([older, active]);
    expect(screen.getByText("Active Session")).toBeInTheDocument();
    expect(screen.getByText("1h 5m")).toBeInTheDocument();

    act(() => {
      vi.setSystemTime(new Date("2026-01-05T12:01:00Z"));
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText("1h 6m")).toBeInTheDocument();
  });

  it("shows minutes only for sessions under an hour", () => {
    renderClock([
      makeEntry({
        clock_in: new Date("2026-01-05T11:35:00Z"),
        clock_out: null,
      }),
    ]);
    expect(screen.getByText("25m")).toBeInTheDocument();
  });

  it("closes the active entry optimistically and clocks out", async () => {
    mocks.clockOutAction.mockResolvedValue({ success: true });
    const setOptimisticEntries = renderClock([active]);
    fireEvent.click(screen.getByRole("button", { name: "Clock Out" }));

    expect(setOptimisticEntries).toHaveBeenCalledWith({
      type: "UPDATE",
      payload: { id: 2, clock_out: NOW, updated_at: NOW },
    });
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith("Clocked out"),
    );
  });

  it.each([
    ["the server error", "DB down", "DB down"],
    ["a fallback message", "", "Failed to clock out"],
  ])("shows %s when clocking out fails", async (_l, error, shown) => {
    mocks.clockOutAction.mockResolvedValue({ success: false, error });
    renderClock([active]);
    fireEvent.click(screen.getByRole("button", { name: "Clock Out" }));
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(shown));
  });

  it("stays quiet for a failed clock-out without an error field", async () => {
    mocks.clockOutAction.mockResolvedValue({ success: false });
    renderClock([active]);
    fireEvent.click(screen.getByRole("button", { name: "Clock Out" }));
    await waitFor(() => expect(mocks.clockOutAction).toHaveBeenCalled());
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });

  it("disables the button while clocking out", async () => {
    mocks.clockOutAction.mockReturnValue(new Promise(() => {}));
    renderClock([active]);
    const button = screen.getByRole("button", { name: "Clock Out" });
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
  });

  it("stops the timer on unmount", () => {
    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    const { unmount } = renderWithClient(
      <TimeClock
        initialEntries={[active]}
        isAdmin={false}
        setOptimisticEntries={vi.fn()}
      />,
    );
    unmount();
    expect(clearSpy).toHaveBeenCalled();
  });
});

describe("TimeClock recent activity", () => {
  const entries = Array.from({ length: 6 }, (_, i) =>
    makeEntry({
      id: 100 + i,
      clock_in: new Date(`2026-01-0${i + 1}T09:00:00Z`),
      clock_out: new Date(`2026-01-0${i + 1}T11:30:00Z`),
    }),
  );

  it("lists the five most recent entries with durations", () => {
    renderClock([
      makeEntry({
        id: 99,
        clock_in: new Date("2026-01-05T11:00:00Z"),
        clock_out: null,
      }),
      ...entries,
    ]);
    expect(screen.getByText("Recent Activity")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText(/- Current/)).toBeInTheDocument();
    expect(screen.getAllByText("2h 30m")).toHaveLength(4);
  });

  it("shows delete controls only to admins", () => {
    renderClock(entries.slice(0, 2), true);
    expect(screen.getByTestId("delete-100")).toBeInTheDocument();
    expect(screen.getByTestId("delete-101")).toBeInTheDocument();
  });

  it("hides delete controls from members", () => {
    renderClock(entries.slice(0, 2), false);
    expect(screen.queryByTestId("delete-100")).not.toBeInTheDocument();
  });

  it("defaults to an empty list", () => {
    renderWithClient(
      <TimeClock
        initialEntries={undefined as never}
        isAdmin={false}
        setOptimisticEntries={vi.fn()}
      />,
    );
    expect(screen.getByText("Offline")).toBeInTheDocument();
  });

  it("displays docked break badge or Not docked badge in recent activity", () => {
    renderWithClient(
      <TimeClock
        breakSettings={{
          dock_lunch: true,
          lunch_duration_minutes: 30,
          lunch_min_shift_hours: 5,
        }}
        initialEntries={[
          makeEntry({
            id: 201,
            clock_in: new Date("2026-01-01T09:00:00Z"),
            clock_out: new Date("2026-01-01T17:30:00Z"),
            skip_lunch: false,
          }),
          makeEntry({
            id: 202,
            clock_in: new Date("2026-01-02T09:00:00Z"),
            clock_out: new Date("2026-01-02T17:30:00Z"),
            skip_lunch: true,
          }),
          makeEntry({
            id: 203,
            clock_in: new Date("2026-01-03T09:00:00Z"),
            clock_out: new Date("2026-01-03T09:45:00Z"),
          }),
        ]}
        isAdmin={false}
        setOptimisticEntries={vi.fn()}
      />,
    );
    expect(screen.getByText("8h 0m")).toBeInTheDocument();
    expect(screen.getByText("-30m break")).toBeInTheDocument();
    expect(screen.getByText("8h 30m")).toBeInTheDocument();
    expect(screen.getByText("Not docked")).toBeInTheDocument();
    expect(screen.getByText("45m")).toBeInTheDocument();
  });
});

describe("TimeClock break control", () => {
  const active = makeEntry({
    id: 2,
    clock_in: new Date("2026-01-05T10:00:00Z"),
    clock_out: null,
    breaks: [],
  });

  it("is hidden while clocked out", () => {
    renderClock();
    expect(
      screen.queryByRole("button", { name: "Start Break" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Break type")).not.toBeInTheDocument();
  });

  it("offers every break type with its paid/unpaid wording", () => {
    renderClock([active]);
    const select = screen.getByLabelText("Break type") as HTMLSelectElement;
    expect(select.value).toBe("unpaid_meal");
    expect(
      Array.from(select.options).map((option) => option.textContent),
    ).toEqual([
      "Meal period (unpaid)",
      "Unpaid rest break (unpaid)",
      "Paid rest break (paid)",
    ]);
  });

  it("records the break optimistically and starts it", async () => {
    mocks.startBreakAction.mockResolvedValue({ success: true });
    const setOptimisticEntries = renderClock([active]);
    fireEvent.click(screen.getByRole("button", { name: "Start Break" }));

    expect(setOptimisticEntries).toHaveBeenCalledWith({
      type: "UPDATE",
      payload: {
        id: 2,
        updated_at: NOW,
        breaks: [
          expect.objectContaining({
            time_entry_id: 2,
            break_type: "unpaid_meal",
            break_start: NOW,
            break_end: null,
          }),
        ],
      },
    });
    await waitFor(() =>
      expect(mocks.startBreakAction).toHaveBeenCalledWith("unpaid_meal"),
    );
    expect(mocks.toast.success).toHaveBeenCalledWith("Break started");
  });

  it("starts a break on an entry that has no break list yet", async () => {
    mocks.startBreakAction.mockResolvedValue({ success: true });
    const entry = makeEntry({
      id: 8,
      clock_in: new Date("2026-01-05T10:00:00Z"),
      clock_out: null,
    });
    const setOptimisticEntries = renderClock([entry]);
    fireEvent.click(screen.getByRole("button", { name: "Start Break" }));

    expect(setOptimisticEntries).toHaveBeenCalledWith({
      type: "UPDATE",
      payload: expect.objectContaining({
        id: 8,
        breaks: [expect.objectContaining({ time_entry_id: 8 })],
      }),
    });
  });

  it("starts the selected break type", async () => {
    mocks.startBreakAction.mockResolvedValue({ success: true });
    renderClock([active]);
    fireEvent.change(screen.getByLabelText("Break type"), {
      target: { value: "paid_rest" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start Break" }));
    await waitFor(() =>
      expect(mocks.startBreakAction).toHaveBeenCalledWith("paid_rest"),
    );
  });

  it.each([
    ["the server error", "No shift", "No shift"],
    ["a fallback message", "", "Failed to start break"],
  ])("shows %s when starting a break fails", async (_l, error, shown) => {
    mocks.startBreakAction.mockResolvedValue({ success: false, error });
    renderClock([active]);
    fireEvent.click(screen.getByRole("button", { name: "Start Break" }));
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(shown));
  });

  it("stays quiet for a failed start without an error field", async () => {
    mocks.startBreakAction.mockResolvedValue({ success: false });
    renderClock([active]);
    fireEvent.click(screen.getByRole("button", { name: "Start Break" }));
    await waitFor(() => expect(mocks.startBreakAction).toHaveBeenCalled());
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });

  it("disables the button while starting a break", async () => {
    mocks.startBreakAction.mockReturnValue(new Promise(() => {}));
    renderClock([active]);
    const button = screen.getByRole("button", { name: "Start Break" });
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
  });

  describe("while a break is running", () => {
    const onBreak = makeEntry({
      id: 3,
      clock_in: new Date("2026-01-05T10:00:00Z"),
      clock_out: null,
      breaks: [
        makeBreak({
          id: 50,
          time_entry_id: 3,
          break_type: "unpaid_meal",
          break_start: new Date("2026-01-05T11:40:00Z"),
          break_end: null,
        }),
      ],
    });

    it("shows the running break, its type and the deduction so far", () => {
      renderClock([onBreak]);
      expect(screen.getByTestId("running-break")).toHaveTextContent(
        "On Meal period · 20m · unpaid (deducted)",
      );
      expect(
        screen.getByText("20m of unpaid break deducted so far"),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Start Break" }),
      ).not.toBeInTheDocument();
    });

    it("ticks the running break timer", () => {
      vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
      vi.setSystemTime(NOW);
      renderClock([onBreak]);
      act(() => {
        vi.setSystemTime(new Date("2026-01-05T12:02:00Z"));
        vi.advanceTimersByTime(1000);
      });
      expect(screen.getByTestId("running-break")).toHaveTextContent("22m");
    });

    it("says a paid break is not deducted", () => {
      renderClock([
        makeEntry({
          id: 4,
          clock_in: new Date("2026-01-05T10:00:00Z"),
          clock_out: null,
          breaks: [
            makeBreak({
              id: 51,
              time_entry_id: 4,
              break_type: "paid_rest",
              break_start: new Date("2026-01-05T11:50:00Z"),
              break_end: null,
            }),
          ],
        }),
      ]);
      expect(screen.getByTestId("running-break")).toHaveTextContent(
        "On Paid rest break · 10m · paid",
      );
      expect(
        screen.queryByText(/unpaid break deducted so far/),
      ).not.toBeInTheDocument();
    });

    it("closes the break optimistically and ends it", async () => {
      mocks.endBreakAction.mockResolvedValue({ success: true });
      const setOptimisticEntries = renderClock([onBreak]);
      fireEvent.click(screen.getByRole("button", { name: "End Break" }));

      expect(setOptimisticEntries).toHaveBeenCalledWith({
        type: "UPDATE",
        payload: {
          id: 3,
          updated_at: NOW,
          breaks: [expect.objectContaining({ id: 50, break_end: NOW })],
        },
      });
      await waitFor(() =>
        expect(mocks.toast.success).toHaveBeenCalledWith("Break ended"),
      );
    });

    it("leaves the shift's earlier breaks untouched when ending one", async () => {
      mocks.endBreakAction.mockResolvedValue({ success: true });
      const earlier = makeBreak({
        id: 49,
        time_entry_id: 3,
        break_type: "paid_rest",
        break_start: new Date("2026-01-05T10:30:00Z"),
        break_end: new Date("2026-01-05T10:45:00Z"),
      });
      const running = makeBreak({
        id: 50,
        time_entry_id: 3,
        break_start: new Date("2026-01-05T11:40:00Z"),
        break_end: null,
      });
      const setOptimisticEntries = renderClock([
        makeEntry({
          id: 3,
          clock_in: new Date("2026-01-05T10:00:00Z"),
          clock_out: null,
          breaks: [earlier, running],
        }),
      ]);
      fireEvent.click(screen.getByRole("button", { name: "End Break" }));

      expect(setOptimisticEntries).toHaveBeenCalledWith({
        type: "UPDATE",
        payload: {
          id: 3,
          updated_at: NOW,
          breaks: [earlier, { ...running, break_end: NOW }],
        },
      });
    });

    it.each([
      ["the server error", "Gone", "Gone"],
      ["a fallback message", "", "Failed to end break"],
    ])("shows %s when ending a break fails", async (_l, error, shown) => {
      mocks.endBreakAction.mockResolvedValue({ success: false, error });
      renderClock([onBreak]);
      fireEvent.click(screen.getByRole("button", { name: "End Break" }));
      await waitFor(() =>
        expect(mocks.toast.error).toHaveBeenCalledWith(shown),
      );
    });

    it("stays quiet for a failed end without an error field", async () => {
      mocks.endBreakAction.mockResolvedValue({ success: false });
      renderClock([onBreak]);
      fireEvent.click(screen.getByRole("button", { name: "End Break" }));
      await waitFor(() => expect(mocks.endBreakAction).toHaveBeenCalled());
      expect(mocks.toast.error).not.toHaveBeenCalled();
    });

    it("disables the button while ending a break", async () => {
      mocks.endBreakAction.mockReturnValue(new Promise(() => {}));
      renderClock([onBreak]);
      const button = screen.getByRole("button", { name: "End Break" });
      fireEvent.click(button);
      await waitFor(() => expect(button).toBeDisabled());
    });
  });

  it("subtracts recorded unpaid breaks from a finished shift's duration", () => {
    renderClock([
      makeEntry({
        id: 9,
        clock_in: new Date("2026-01-05T09:00:00Z"),
        clock_out: new Date("2026-01-05T17:00:00Z"),
        breaks: [
          makeBreak({
            id: 60,
            time_entry_id: 9,
            break_start: new Date("2026-01-05T12:00:00Z"),
            break_end: new Date("2026-01-05T12:30:00Z"),
          }),
        ],
      }),
    ]);
    expect(screen.getByText("-30m unpaid break")).toBeInTheDocument();
    expect(screen.getByText("7h 30m")).toBeInTheDocument();
  });
});
