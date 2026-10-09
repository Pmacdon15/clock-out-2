import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeEntry, renderWithClient } from "../utils";

const mocks = vi.hoisted(() => ({
  clockInAction: vi.fn(),
  clockOutAction: vi.fn(),
  useTimeframeDefaults: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/actions", () => ({
  clockInAction: mocks.clockInAction,
  clockOutAction: mocks.clockOutAction,
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
});
