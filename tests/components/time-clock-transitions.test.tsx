import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { useOptimistic } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeBreak, makeEntry, renderWithClient } from "../utils";

/*
 * Kept in its own file on purpose: React ties every pending async action in a
 * module together, so a test elsewhere that leaves a punch hanging forever
 * would stop these transitions from ever settling. Every promise started
 * here is resolved before its test ends.
 */

const mocks = vi.hoisted(() => ({
  clockInAction: vi.fn(),
  clockOutAction: vi.fn(),
  startBreakAction: vi.fn(),
  endBreakAction: vi.fn(),
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
  useTimeframeDefaults: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import TimeClock from "@/components/time-clock";
import { timeEntriesReducer } from "@/lib/reducers/time-entries";
import type { TimeEntry } from "@/lib/types";

const CLOCK_TOAST = { id: "time-clock" };
const LOCATION_TOAST = { id: "time-clock-location" };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-05T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

/** Hosts TimeClock on a real useOptimistic, the way DashboardTabs does. */
function OptimisticHost({
  entries,
  locationSettings,
}: {
  entries: TimeEntry[];
  locationSettings?: {
    org_id: string;
    capture_mode: string;
    restrict_clock_in: boolean;
  };
}) {
  const [optimistic, setOptimistic] = useOptimistic(
    entries,
    timeEntriesReducer,
  );
  return (
    <TimeClock
      initialEntries={optimistic}
      isAdmin={false}
      // biome-ignore lint/suspicious/noExplicitAny: test settings shape
      locationSettings={locationSettings as any}
      setOptimisticEntries={setOptimistic}
    />
  );
}

/** Presses Clock Out and confirms it in the dialog. */
function clockOut() {
  fireEvent.click(screen.getByRole("button", { name: "Clock Out" }));
  fireEvent.click(screen.getByRole("button", { name: "Yes, clock out" }));
}

/**
 * Issue #93: these drive TimeClock through a real `useOptimistic`, the way
 * DashboardTabs does, so they catch the punch flickering back to the old view
 * before the server answers, and the punch waiting on the location check.
 */
describe("TimeClock punch transitions", () => {
  function renderHost(
    entries: TimeEntry[] = [],
    locationSettings?: Parameters<typeof OptimisticHost>[0]["locationSettings"],
  ) {
    return renderWithClient(
      <OptimisticHost entries={entries} locationSettings={locationSettings} />,
    );
  }

  /** A promise the test resolves by hand. */
  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  it("keeps the active view up until the clock-in lands", async () => {
    const server = deferred<{ success: boolean }>();
    mocks.clockInAction.mockReturnValue(server.promise);
    renderHost();

    fireEvent.click(screen.getByRole("button", { name: "Clock In" }));
    expect(await screen.findByText("Active Session")).toBeInTheDocument();
    expect(
      screen.queryByText("Ready to start your shift?"),
    ).not.toBeInTheDocument();

    // Give a fire-and-forget transition every chance to end and roll back.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.getByText("Active Session")).toBeInTheDocument();
    expect(
      screen.queryByText("Ready to start your shift?"),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("Recent Activity")).toHaveLength(1);

    await act(async () => {
      server.resolve({ success: true });
      await server.promise;
    });
    expect(mocks.toast.success).toHaveBeenCalledWith("Clocked in", CLOCK_TOAST);
  });

  it("keeps the ready view up until the clock-out lands", async () => {
    const server = deferred<{ success: boolean }>();
    mocks.clockOutAction.mockReturnValue(server.promise);
    renderHost([
      makeEntry({
        id: 2,
        clock_in: new Date("2026-01-05T10:55:00Z"),
        clock_out: null,
      }),
    ]);

    clockOut();
    expect(
      await screen.findByText("Ready to start your shift?"),
    ).toBeInTheDocument();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.getByText("Ready to start your shift?")).toBeInTheDocument();
    expect(screen.queryByText("Active Session")).not.toBeInTheDocument();
    // A second punch can't start while this one is in flight.
    expect(screen.getByRole("button", { name: "Clock In" })).toBeDisabled();

    await act(async () => {
      server.resolve({ success: true });
      await server.promise;
    });
  });

  it("shows the punch before the location check finishes", async () => {
    const position = deferred<unknown>();
    const server = deferred<{ success: boolean }>();
    mocks.captureCurrentPosition.mockReturnValue(position.promise);
    mocks.clockInAction.mockReturnValue(server.promise);
    renderHost([], {
      org_id: "org_1",
      capture_mode: "optional",
      restrict_clock_in: false,
    });

    fireEvent.click(screen.getByRole("button", { name: "Clock In" }));
    expect(await screen.findByText("Active Session")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Checking location...",
    );
    expect(mocks.clockInAction).not.toHaveBeenCalled();

    const coordinates = { latitude: 1, longitude: 2, accuracy: 3 };
    await act(async () => {
      position.resolve({ ok: true, coordinates });
      await position.promise;
    });
    await waitFor(() =>
      expect(mocks.clockInAction).toHaveBeenCalledWith(coordinates),
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByText("Active Session")).toBeInTheDocument();

    await act(async () => {
      server.resolve({ success: true });
      await server.promise;
    });
  });

  it("rolls the punch back when a required location is refused", async () => {
    const failure = { code: "denied", message: "Location access is blocked." };
    mocks.captureCurrentPosition.mockResolvedValue({ ok: false, failure });
    renderHost([], {
      org_id: "org_1",
      capture_mode: "required",
      restrict_clock_in: false,
    });

    fireEvent.click(screen.getByRole("button", { name: "Clock In" }));
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(
        failure.message,
        LOCATION_TOAST,
      ),
    );
    expect(
      await screen.findByText("Ready to start your shift?"),
    ).toBeInTheDocument();
    expect(mocks.clockInAction).not.toHaveBeenCalled();
  });

  it("reports a thrown clock-in in the same toast slot", async () => {
    mocks.clockInAction.mockRejectedValue(new Error("network"));
    renderHost();

    fireEvent.click(screen.getByRole("button", { name: "Clock In" }));
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(
        "Failed to clock in",
        CLOCK_TOAST,
      ),
    );
    expect(
      await screen.findByText("Ready to start your shift?"),
    ).toBeInTheDocument();
  });

  const active = (breaks: ReturnType<typeof makeBreak>[] = []) =>
    makeEntry({
      id: 2,
      clock_in: new Date("2026-01-05T10:55:00Z"),
      clock_out: null,
      breaks,
    });

  it.each([
    [
      "clock-out",
      () => mocks.clockOutAction,
      () => [active()],
      clockOut,
      "Failed to clock out",
    ],
    [
      "break start",
      () => mocks.startBreakAction,
      () => [active()],
      () =>
        fireEvent.click(screen.getByRole("button", { name: "Start Break" })),
      "Failed to start break",
    ],
    [
      "break end",
      () => mocks.endBreakAction,
      () => [
        active([
          makeBreak({
            break_start: new Date("2026-01-05T11:50:00Z"),
            break_end: null,
          }),
        ]),
      ],
      () => fireEvent.click(screen.getByRole("button", { name: "End Break" })),
      "Failed to end break",
    ],
  ])(
    "reports a thrown %s in the same toast slot",
    async (_l, action, entries, press, shown) => {
      action().mockRejectedValue(new Error("network"));
      renderHost(entries());

      press();
      await waitFor(() =>
        expect(mocks.toast.error).toHaveBeenCalledWith(shown, CLOCK_TOAST),
      );
    },
  );
});
