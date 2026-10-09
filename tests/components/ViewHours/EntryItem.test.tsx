import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeEntry, renderWithClient } from "../../utils";

const mocks = vi.hoisted(() => ({
  updateTimeEntryAction: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/actions", () => ({
  updateTimeEntryAction: mocks.updateTimeEntryAction,
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
    fireEvent.click(screen.getAllByRole("button")[1]);

    expect(setOptimisticEntries).toHaveBeenCalledWith({
      type: "UPDATE",
      payload: {
        id: 5,
        clock_in: new Date("2026-01-05T08:00"),
        clock_out: new Date("2026-01-05T16:00"),
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
