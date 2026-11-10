import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BreakSettingsData, BreakType, TimeEntry } from "@/lib/types";
import { makeBreak, makeEntry, renderWithClient } from "../utils";

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
vi.mock("sonner", () => ({ toast: mocks.toast }));

import TimeClock from "@/components/time-clock";

const settings = (
  overrides: Partial<BreakSettingsData> = {},
): BreakSettingsData => ({
  org_id: "org_1",
  dock_lunch: false,
  lunch_duration_minutes: 30,
  lunch_min_shift_hours: 5,
  ...overrides,
});

/** A running shift whose earlier breaks are all finished. */
function shiftWith(...types: BreakType[]): TimeEntry {
  return makeEntry({
    id: 3,
    clock_in: new Date(Date.now() - 4 * 3_600_000),
    clock_out: null,
    breaks: types.map((break_type, i) =>
      makeBreak({
        id: 50 + i,
        time_entry_id: 3,
        break_type,
        break_start: new Date(Date.now() - (3 - i * 0.5) * 3_600_000),
        break_end: new Date(Date.now() - (2.9 - i * 0.5) * 3_600_000),
      }),
    ),
  });
}

function renderClock(entry: TimeEntry, breakSettings?: BreakSettingsData) {
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

const startButton = () => screen.getByRole("button", { name: /Start Break/ });
const option = (name: RegExp) =>
  screen.getByRole("option", { name }) as HTMLOptionElement;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TimeClock break count limits", () => {
  it("shows nothing extra when the org sets no count limits", () => {
    renderClock(shiftWith("unpaid_meal"), settings());
    expect(screen.queryByTestId("breaks-left")).not.toBeInTheDocument();
    expect(screen.queryByTestId("break-count-limit")).not.toBeInTheDocument();
    expect(startButton()).toBeEnabled();
  });

  it("shows how many breaks of the selected kind are left", () => {
    renderClock(
      shiftWith("paid_rest"),
      settings({ max_paid_breaks_per_shift: 3 }),
    );
    fireEvent.change(screen.getByLabelText("Break type"), {
      target: { value: "paid_rest" },
    });
    expect(screen.getByTestId("breaks-left")).toHaveTextContent(
      "2 paid breaks left this shift",
    );
  });

  it("uses the singular for the last break", () => {
    renderClock(shiftWith(), settings({ max_unpaid_breaks_per_shift: 1 }));
    expect(screen.getByTestId("breaks-left")).toHaveTextContent(
      "1 unpaid break left this shift",
    );
  });

  it("blocks starting a break once that kind is used up", () => {
    const setOptimisticEntries = renderClock(
      shiftWith("unpaid_meal"),
      settings({ max_unpaid_breaks_per_shift: 1 }),
    );
    fireEvent.change(screen.getByLabelText("Break type"), {
      target: { value: "unpaid_meal" },
    });
    expect(screen.getByTestId("break-count-limit")).toHaveTextContent(
      "You've used all 1 unpaid break allowed this shift.",
    );
    expect(startButton()).toBeDisabled();
    expect(option(/Meal period/).disabled).toBe(true);
    expect(option(/Unpaid rest break/).disabled).toBe(true);
    expect(option(/Paid rest break/).disabled).toBe(false);
    expect(setOptimisticEntries).not.toHaveBeenCalled();
  });

  it("still lets the member take the other kind of break", async () => {
    mocks.startBreakAction.mockResolvedValue({ success: true });
    renderClock(
      shiftWith("unpaid_meal"),
      settings({ max_unpaid_breaks_per_shift: 1 }),
    );
    fireEvent.change(screen.getByLabelText("Break type"), {
      target: { value: "paid_rest" },
    });
    expect(screen.queryByTestId("break-count-limit")).not.toBeInTheDocument();
    expect(startButton()).toBeEnabled();
    fireEvent.click(startButton());
    await waitFor(() =>
      expect(mocks.startBreakAction).toHaveBeenCalledWith("paid_rest"),
    );
  });

  it("defaults to a kind that is still allowed this shift", () => {
    renderClock(shiftWith(), settings({ max_unpaid_breaks_per_shift: 0 }));
    expect(screen.getByLabelText("Break type")).toHaveValue("paid_rest");
    expect(option(/Meal period/).disabled).toBe(true);
    expect(option(/Unpaid rest break/).disabled).toBe(true);
    expect(startButton()).toBeEnabled();
  });

  it("blocks every break when both kinds are limited to zero", () => {
    const setOptimisticEntries = renderClock(
      shiftWith(),
      settings({
        max_paid_breaks_per_shift: 0,
        max_unpaid_breaks_per_shift: 0,
      }),
    );
    expect(screen.getByTestId("break-count-limit")).toHaveTextContent(
      "Your organization doesn't allow unpaid breaks.",
    );
    expect(startButton()).toBeDisabled();
    expect(option(/Paid rest break/).disabled).toBe(true);
    expect(setOptimisticEntries).not.toHaveBeenCalled();
  });
});
