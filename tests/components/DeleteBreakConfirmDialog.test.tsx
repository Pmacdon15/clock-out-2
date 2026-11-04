import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeBreak, renderWithClient } from "../utils";

const mocks = vi.hoisted(() => ({
  deleteBreakAction: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/actions", () => ({
  deleteBreakAction: mocks.deleteBreakAction,
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import { DeleteBreakConfirmDialog } from "@/components/DeleteBreakConfirmDialog";

const meal = makeBreak({ id: 21, break_type: "unpaid_meal" });
const rest = makeBreak({ id: 22, break_type: "paid_rest" });
const breaks = [meal, rest];

function openDialog() {
  fireEvent.click(screen.getByRole("button", { name: "Remove break" }));
  return screen.getByRole("alertdialog");
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("DeleteBreakConfirmDialog", () => {
  it("opens a confirmation naming the break", () => {
    renderWithClient(
      <DeleteBreakConfirmDialog breakItem={meal} breaks={breaks} entryId={3} />,
    );
    const dialog = openDialog();
    expect(dialog).toHaveTextContent("Delete this break?");
    expect(dialog).toHaveTextContent("This action cannot be undone.");
    expect(mocks.deleteBreakAction).not.toHaveBeenCalled();
  });

  it("uses a custom trigger when given", () => {
    renderWithClient(
      <DeleteBreakConfirmDialog
        breakItem={meal}
        breaks={breaks}
        entryId={3}
        trigger={<button type="button">Drop it</button>}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Drop it" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("closes without deleting on cancel", () => {
    const setOptimisticEntries = vi.fn();
    renderWithClient(
      <DeleteBreakConfirmDialog
        breakItem={meal}
        breaks={breaks}
        entryId={3}
        setOptimisticEntries={setOptimisticEntries}
      />,
    );
    openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(setOptimisticEntries).not.toHaveBeenCalled();
    expect(mocks.deleteBreakAction).not.toHaveBeenCalled();
  });

  it("removes the break optimistically, deletes it and closes", async () => {
    mocks.deleteBreakAction.mockResolvedValue({ success: true });
    const setOptimisticEntries = vi.fn();
    renderWithClient(
      <DeleteBreakConfirmDialog
        breakItem={meal}
        breaks={breaks}
        entryId={3}
        setOptimisticEntries={setOptimisticEntries}
      />,
    );
    openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(setOptimisticEntries).toHaveBeenCalledWith({
      type: "UPDATE",
      payload: { id: 3, breaks: [rest], updated_at: expect.any(Date) },
    });
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith("Break removed"),
    );
    expect(mocks.deleteBreakAction).toHaveBeenCalledWith(21);
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
  });

  it("deletes without an optimistic update when no setter is given", async () => {
    mocks.deleteBreakAction.mockResolvedValue({ success: true });
    renderWithClient(
      <DeleteBreakConfirmDialog breakItem={rest} breaks={breaks} entryId={3} />,
    );
    openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalled());
    expect(mocks.deleteBreakAction).toHaveBeenCalledWith(22);
  });

  it.each([
    ["the server error", "Nope", "Nope"],
    ["a fallback message", "", "Failed to remove break"],
  ])("shows %s when deleting fails", async (_l, error, shown) => {
    mocks.deleteBreakAction.mockResolvedValue({ success: false, error });
    renderWithClient(
      <DeleteBreakConfirmDialog breakItem={meal} breaks={breaks} entryId={3} />,
    );
    openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(shown));
  });
});
