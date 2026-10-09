import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithClient } from "../utils";

const mocks = vi.hoisted(() => ({
  deleteTimeEntryAction: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/actions", () => ({
  deleteTimeEntryAction: mocks.deleteTimeEntryAction,
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";

function openDialog() {
  fireEvent.click(screen.getByRole("button"));
  return screen.getByRole("alertdialog");
}

describe("DeleteConfirmDialog", () => {
  it("opens a confirmation from the default trigger", () => {
    renderWithClient(<DeleteConfirmDialog entryId={1} />);
    const dialog = openDialog();
    expect(dialog).toHaveTextContent("Are you absolutely sure?");
    expect(dialog).toHaveTextContent("This action cannot be undone.");
  });

  it("uses a custom trigger when given", () => {
    renderWithClient(
      <DeleteConfirmDialog
        entryId={1}
        trigger={<button type="button">Remove shift</button>}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove shift" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("closes without deleting on cancel", () => {
    renderWithClient(<DeleteConfirmDialog entryId={1} />);
    openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(mocks.deleteTimeEntryAction).not.toHaveBeenCalled();
  });

  it("removes the entry optimistically, deletes it and closes", async () => {
    mocks.deleteTimeEntryAction.mockResolvedValue({ success: true });
    const setOptimisticEntries = vi.fn();
    renderWithClient(
      <DeleteConfirmDialog
        entryId={42}
        setOptimisticEntries={setOptimisticEntries}
      />,
    );
    openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(setOptimisticEntries).toHaveBeenCalledWith({
      type: "REMOVE",
      payload: 42,
    });
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith("Entry deleted"),
    );
    expect(mocks.deleteTimeEntryAction.mock.calls[0][0]).toBe(42);
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
  });

  it("deletes without an optimistic update when no setter is given", async () => {
    mocks.deleteTimeEntryAction.mockResolvedValue({ success: true });
    renderWithClient(<DeleteConfirmDialog entryId={7} />);
    openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalled());
    expect(mocks.deleteTimeEntryAction.mock.calls[0][0]).toBe(7);
  });

  it("shows the server error", async () => {
    mocks.deleteTimeEntryAction.mockResolvedValue({
      success: false,
      error: "Unauthorized",
    });
    renderWithClient(<DeleteConfirmDialog entryId={1} />);
    openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("Unauthorized"),
    );
  });

  it("falls back to a generic error message", async () => {
    mocks.deleteTimeEntryAction.mockResolvedValue({
      success: false,
      error: "",
    });
    renderWithClient(<DeleteConfirmDialog entryId={1} />);
    openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("Failed to delete"),
    );
  });

  it("does nothing more for a failed result without an error field", async () => {
    mocks.deleteTimeEntryAction.mockResolvedValue({ success: false });
    renderWithClient(<DeleteConfirmDialog entryId={1} />);
    openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(mocks.deleteTimeEntryAction).toHaveBeenCalled());
    expect(mocks.toast.success).not.toHaveBeenCalled();
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });

  it("disables the buttons while deleting", async () => {
    mocks.deleteTimeEntryAction.mockReturnValue(new Promise(() => {}));
    renderWithClient(<DeleteConfirmDialog entryId={1} />);
    openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    // Radix closes the dialog on confirm; reopen it while the delete is in flight.
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    openDialog();
    const deleting = await screen.findByRole("button", { name: "Deleting..." });
    expect(deleting).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });
});
