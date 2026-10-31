import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeBreak, makeEntry, renderWithClient } from "../../utils";

const mocks = vi.hoisted(() => ({
  updateTimeEntryAction: vi.fn(),
  deleteBreakAction: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/actions", () => ({
  updateTimeEntryAction: mocks.updateTimeEntryAction,
  deleteBreakAction: mocks.deleteBreakAction,
}));
vi.mock("@/components/DeleteConfirmDialog", () => ({
  DeleteConfirmDialog: ({ entryId }: { entryId: number }) => (
    <span data-testid="delete">{entryId}</span>
  ),
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import { EntryItem } from "@/components/ViewHours/EntryItem";

const entry = makeEntry({
  id: 5,
  clock_in: new Date("2026-01-05T09:00:00Z"),
  clock_out: new Date("2026-01-05T17:30:00Z"),
});

function renderItem(props: Partial<Parameters<typeof EntryItem>[0]> = {}) {
  const setOptimisticEntries = vi.fn();
  const utils = renderWithClient(
    <EntryItem
      entry={entry}
      isAdmin
      setOptimisticEntries={setOptimisticEntries}
      {...props}
    />,
  );
  return { ...utils, setOptimisticEntries };
}

function startEditing() {
  fireEvent.click(screen.getAllByRole("button")[0]);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-05T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("EntryItem display", () => {
  it("shows the day, times and hours", () => {
    renderItem({ isAdmin: false });
    expect(screen.getByText("Monday, Jan 5")).toBeInTheDocument();
    expect(screen.getByText("8.50h")).toBeInTheDocument();
    expect(screen.getByText("09:00 AM - 05:30 PM")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("delete")).not.toBeInTheDocument();
  });

  it("measures open entries up to now", () => {
    renderItem({ entry: { ...entry, clock_out: null }, isAdmin: false });
    expect(screen.getByText("3.00h")).toBeInTheDocument();
    expect(screen.getByText("09:00 AM - ...")).toBeInTheDocument();
  });

  it("shows the member name when given", () => {
    renderItem({ memberName: "Ada" });
    expect(screen.getByText("Ada")).toBeInTheDocument();
  });

  it("shows edit and delete controls to admins", () => {
    renderItem();
    expect(screen.getByTestId("delete")).toHaveTextContent("5");
  });

  it("shows docked break badge and reduced hours when breakSettings docks lunch", () => {
    renderItem({
      isAdmin: false,
      breakSettings: {
        dock_lunch: true,
        lunch_duration_minutes: 30,
        lunch_min_shift_hours: 5,
      },
    });
    expect(screen.getByText("8.00h")).toBeInTheDocument();
    expect(screen.getByText("-30m break")).toBeInTheDocument();
  });

  it("shows Not docked badge and full hours when skip_lunch is true", () => {
    renderItem({
      entry: { ...entry, skip_lunch: true },
      isAdmin: false,
      breakSettings: {
        dock_lunch: true,
        lunch_duration_minutes: 30,
        lunch_min_shift_hours: 5,
      },
    });
    expect(screen.getByText("8.50h")).toBeInTheDocument();
    expect(screen.getByText("Not docked")).toBeInTheDocument();
  });
});

describe("EntryItem editing", () => {
  it("prefills the inputs and can be cancelled", () => {
    renderItem();
    startEditing();
    expect(screen.getByLabelText("Clock In")).toHaveValue("2026-01-05T09:00");
    expect(screen.getByLabelText("Clock Out")).toHaveValue("2026-01-05T17:30");

    fireEvent.click(screen.getAllByRole("button")[0]);
    expect(screen.queryByLabelText("Clock In")).not.toBeInTheDocument();
  });

  it("starts with an empty clock-out for open entries", () => {
    renderItem({ entry: { ...entry, clock_out: null } });
    startEditing();
    expect(screen.getByLabelText("Clock Out")).toHaveValue("");
  });

  it("saves edited times optimistically and closes on success", async () => {
    mocks.updateTimeEntryAction.mockResolvedValue({ success: true });
    const { setOptimisticEntries } = renderItem();
    startEditing();
    fireEvent.change(screen.getByLabelText("Clock In"), {
      target: { value: "2026-01-05T08:00" },
    });
    fireEvent.change(screen.getByLabelText("Clock Out"), {
      target: { value: "2026-01-05T16:00" },
    });
    fireEvent.click(
      screen.getByLabelText("Skipped lunch / break (do not dock)"),
    );
    fireEvent.click(screen.getAllByRole("button")[1]);

    expect(setOptimisticEntries).toHaveBeenCalledWith({
      type: "UPDATE",
      payload: {
        id: 5,
        clock_in: new Date("2026-01-05T08:00"),
        clock_out: new Date("2026-01-05T16:00"),
        skip_lunch: true,
        updated_at: new Date("2026-01-05T12:00:00Z"),
      },
    });
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith("Entry updated"),
    );
    expect(mocks.updateTimeEntryAction).toHaveBeenCalledWith(
      5,
      "2026-01-05T08:00:00.000Z",
      "2026-01-05T16:00:00.000Z",
      true,
    );
    await waitFor(() =>
      expect(screen.queryByLabelText("Clock In")).not.toBeInTheDocument(),
    );
  });

  it("sends an empty clock-out when it is cleared", async () => {
    mocks.updateTimeEntryAction.mockResolvedValue({ success: true });
    const { setOptimisticEntries } = renderItem();
    startEditing();
    fireEvent.change(screen.getByLabelText("Clock Out"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getAllByRole("button")[1]);

    expect(setOptimisticEntries.mock.calls[0][0].payload.clock_out).toBeNull();
    await waitFor(() =>
      expect(mocks.updateTimeEntryAction).toHaveBeenCalledWith(
        5,
        "2026-01-05T09:00:00.000Z",
        "",
        false,
      ),
    );
  });

  it.each([
    ["the server error", "Unauthorized", "Unauthorized"],
    ["a fallback message", "", "Failed to update"],
  ])("shows %s and stays in edit mode on failure", async (_l, error, shown) => {
    mocks.updateTimeEntryAction.mockResolvedValue({ success: false, error });
    renderItem();
    startEditing();
    fireEvent.click(screen.getAllByRole("button")[1]);
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(shown));
    expect(screen.getByLabelText("Clock In")).toBeInTheDocument();
  });

  it("stays quiet for a failed result without an error field", async () => {
    mocks.updateTimeEntryAction.mockResolvedValue({ success: false });
    renderItem();
    startEditing();
    fireEvent.click(screen.getAllByRole("button")[1]);
    await waitFor(() => expect(mocks.updateTimeEntryAction).toHaveBeenCalled());
    expect(mocks.toast.error).not.toHaveBeenCalled();
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });

  it("disables saving while the update is in flight", async () => {
    mocks.updateTimeEntryAction.mockReturnValue(new Promise(() => {}));
    renderItem();
    startEditing();
    const save = screen.getAllByRole("button")[1];
    fireEvent.click(save);
    await waitFor(() => expect(save).toBeDisabled());
  });
});

describe("EntryItem break records", () => {
  const withBreaks = makeEntry({
    id: 6,
    clock_in: new Date("2026-01-05T09:00:00Z"),
    clock_out: new Date("2026-01-05T17:00:00Z"),
    breaks: [
      makeBreak({
        id: 11,
        time_entry_id: 6,
        break_type: "unpaid_meal",
        break_start: new Date("2026-01-05T12:00:00Z"),
        break_end: new Date("2026-01-05T12:30:00Z"),
      }),
      makeBreak({
        id: 12,
        time_entry_id: 6,
        break_type: "paid_rest",
        break_start: new Date("2026-01-05T15:00:00Z"),
        break_end: new Date("2026-01-05T15:15:00Z"),
      }),
    ],
  });

  it("lists each break with its type, window, length and paid flag", () => {
    renderItem({ entry: withBreaks, isAdmin: false });
    const list = screen.getByTestId("breaks-6");
    expect(list).toHaveTextContent("Meal period");
    expect(list).toHaveTextContent("12:00 PM - 12:30 PM");
    expect(list).toHaveTextContent("30m");
    expect(list).toHaveTextContent("Unpaid");
    expect(list).toHaveTextContent("Paid rest break");
    expect(list).toHaveTextContent("15m");
    expect(list).toHaveTextContent("Paid");
  });

  it("deducts only the unpaid break from the hours shown", () => {
    renderItem({ entry: withBreaks, isAdmin: false });
    expect(screen.getByText("7.50h")).toBeInTheDocument();
    expect(screen.getByText("-30m unpaid break")).toBeInTheDocument();
  });

  it("shows a running break with no end time", () => {
    renderItem({
      entry: makeEntry({
        id: 7,
        clock_in: new Date("2026-01-05T09:00:00Z"),
        clock_out: null,
        breaks: [
          makeBreak({
            id: 13,
            time_entry_id: 7,
            break_start: new Date("2026-01-05T11:30:00Z"),
            break_end: null,
          }),
        ],
      }),
      isAdmin: false,
    });
    expect(screen.getByTestId("breaks-7")).toHaveTextContent("11:30 AM - ...");
  });

  it("renders no break list when the entry has none", () => {
    renderItem({ isAdmin: false });
    expect(screen.queryByTestId("breaks-5")).not.toBeInTheDocument();
  });

  it("lets an admin remove a break optimistically", async () => {
    mocks.deleteBreakAction.mockResolvedValue({ success: true });
    const { setOptimisticEntries } = renderItem({ entry: withBreaks });
    fireEvent.click(screen.getAllByRole("button", { name: "Remove break" })[0]);

    expect(setOptimisticEntries).toHaveBeenCalledWith({
      type: "UPDATE",
      payload: {
        id: 6,
        breaks: [expect.objectContaining({ id: 12 })],
        updated_at: expect.any(Date),
      },
    });
    await waitFor(() =>
      expect(mocks.deleteBreakAction).toHaveBeenCalledWith(11),
    );
    expect(mocks.toast.success).toHaveBeenCalledWith("Break removed");
  });

  it("hides the remove control from members", () => {
    renderItem({ entry: withBreaks, isAdmin: false });
    expect(
      screen.queryByRole("button", { name: "Remove break" }),
    ).not.toBeInTheDocument();
  });

  it.each([
    ["the server error", "Nope", "Nope"],
    ["a fallback message", "", "Failed to remove break"],
  ])("shows %s when removing a break fails", async (_l, error, shown) => {
    mocks.deleteBreakAction.mockResolvedValue({ success: false, error });
    renderItem({ entry: withBreaks });
    fireEvent.click(screen.getAllByRole("button", { name: "Remove break" })[0]);
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(shown));
  });

  it("stays quiet for a failed removal without an error field", async () => {
    mocks.deleteBreakAction.mockResolvedValue({ success: false });
    renderItem({ entry: withBreaks });
    fireEvent.click(screen.getAllByRole("button", { name: "Remove break" })[0]);
    await waitFor(() => expect(mocks.deleteBreakAction).toHaveBeenCalled());
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });
});
describe("EntryItem captured location", () => {
  const located = makeEntry({
    id: 6,
    clock_in: new Date("2026-01-05T09:00:00Z"),
    clock_out: new Date("2026-01-05T17:30:00Z"),
    clock_in_latitude: 45.4215,
    clock_in_longitude: -75.6972,
    clock_in_accuracy_m: 12.6,
    clock_in_site_name: "Depot",
    clock_out_latitude: 43.6532,
    clock_out_longitude: -79.3832,
    clock_out_accuracy_m: null,
    clock_out_site_name: null,
  });

  it("shows both punches, their accuracy and the matched site to admins", () => {
    renderItem({ entry: located });
    expect(screen.getByText("In")).toBeInTheDocument();
    expect(screen.getByText("45.42150, -75.69720")).toBeInTheDocument();
    expect(screen.getByText("±13m")).toBeInTheDocument();
    expect(screen.getByText("· Depot")).toBeInTheDocument();
    expect(screen.getByText("Out")).toBeInTheDocument();
    expect(screen.getByText("43.65320, -79.38320")).toBeInTheDocument();
    expect(screen.getByText("· No site")).toBeInTheDocument();
  });

  it("hides the location from members", () => {
    renderItem({ entry: located, isAdmin: false });
    expect(screen.queryByText("In")).not.toBeInTheDocument();
    expect(screen.queryByText("45.42150, -75.69720")).not.toBeInTheDocument();
  });

  it("shows nothing extra when no location was captured", () => {
    renderItem({ entry });
    expect(screen.queryByText("In")).not.toBeInTheDocument();
  });

  it("shows only the clock-in punch when the clock-out has no location", () => {
    renderItem({
      entry: makeEntry({
        id: 7,
        clock_in_latitude: 45.4215,
        clock_in_longitude: -75.6972,
        clock_in_site_name: "Depot",
      }),
    });
    expect(screen.getByText("In")).toBeInTheDocument();
    expect(screen.queryByText("Out")).not.toBeInTheDocument();
  });

  it("shows the human-readable address when available with coordinates tooltip", () => {
    renderItem({
      entry: makeEntry({
        id: 8,
        clock_in_latitude: 45.4215,
        clock_in_longitude: -75.6972,
        clock_in_accuracy_m: 8.2,
        clock_in_site_name: "Depot",
        clock_in_address: "111 Albert St, Ottawa, ON",
      }),
    });
    expect(screen.getByText("In")).toBeInTheDocument();
    const addressSpan = screen.getByText("111 Albert St, Ottawa, ON");
    expect(addressSpan).toBeInTheDocument();
    expect(addressSpan).toHaveAttribute("title", "45.42150, -75.69720 ±8m");
    expect(screen.getByText("· Depot")).toBeInTheDocument();
  });
});
