import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ShiftRequestsView } from "@/lib/shift-requests-dal";
import type { ShiftRequestDetail } from "@/lib/types";
import { renderWithClient, resolved } from "../utils";

const mocks = vi.hoisted(() => ({
  claimShiftRequestAction: vi.fn(),
  cancelShiftRequestAction: vi.fn(),
  approveShiftRequestAction: vi.fn(),
  denyShiftRequestAction: vi.fn(),
  createShiftRequestAction: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/shift-request-actions", () => ({
  claimShiftRequestAction: mocks.claimShiftRequestAction,
  cancelShiftRequestAction: mocks.cancelShiftRequestAction,
  approveShiftRequestAction: mocks.approveShiftRequestAction,
  denyShiftRequestAction: mocks.denyShiftRequestAction,
  createShiftRequestAction: mocks.createShiftRequestAction,
}));
vi.mock("@/lib/db", () => ({}));
vi.mock("@/lib/shift-requests-db", () => ({}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import ShiftRequests from "@/components/ShiftRequests";

let nextId = 1;
function request(over: Partial<ShiftRequestDetail> = {}): ShiftRequestDetail {
  return {
    id: nextId++,
    org_id: "o1",
    request_type: "offer",
    shift_id: 1,
    swap_shift_id: null,
    requested_by: "amy",
    target_user_id: null,
    claimed_by: null,
    note: null,
    status: "open",
    claimed_at: null,
    reviewed_by: null,
    reviewed_at: null,
    review_note: null,
    cancelled_by: null,
    shift_start: "2030-01-05T09:00:00Z",
    shift_end: "2030-01-05T17:00:00Z",
    shift_owner: "amy",
    shift_note: null,
    swap_shift_start: null,
    swap_shift_end: null,
    swap_shift_owner: null,
    ...over,
  };
}

const names = { amy: "Amy", ben: "Ben", mgr: "Morgan" };

function show(view: Partial<ShiftRequestsView>) {
  renderWithClient(
    <ShiftRequests
      viewPromise={resolved({
        ok: true as const,
        value: {
          requests: [],
          shifts: [],
          names,
          userId: "ben",
          isAdmin: false,
          ...view,
        },
      })}
    />,
  );
}

describe("ShiftRequests", () => {
  it("shows an error", () => {
    renderWithClient(
      <ShiftRequests
        viewPromise={resolved({
          ok: false as const,
          error: { reason: "Error fetching shift requests" },
        })}
      />,
    );
    expect(screen.getByText("Error fetching shift requests")).toBeVisible();
  });

  it("explains how to make a request when there are none", () => {
    show({});
    expect(screen.getByText(/No open swaps or pickups/)).toBeVisible();
    expect(screen.getByText(/here or through your AI assistant/)).toBeVisible();
  });

  it("opens and closes the new-request form", () => {
    show({
      shifts: [
        {
          id: 3,
          user_id: "ben",
          shift_start: new Date("2030-01-06T09:00:00Z"),
          shift_end: new Date("2030-01-06T17:00:00Z"),
        },
      ],
    });
    expect(
      screen.queryByRole("form", { name: "New shift request" }),
    ).toBeNull();
    const toggle = screen.getByRole("button", { name: /New request/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(
      screen.getByRole("form", { name: "New shift request" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Your shift")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(
      screen.queryByRole("form", { name: "New shift request" }),
    ).toBeNull();
  });

  it("lets a member claim an offered shift", async () => {
    mocks.claimShiftRequestAction.mockResolvedValueOnce({ success: true });
    const offer = request({ note: "Family thing" });
    show({ requests: [offer] });
    expect(screen.getByText("Up for grabs")).toBeVisible();
    expect(screen.getByText("Family thing")).toBeVisible();
    expect(screen.queryByText("Cancel request")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Claim/ }));
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith("Shift claimed"),
    );
    expect(mocks.claimShiftRequestAction).toHaveBeenCalledWith(
      offer.id,
      expect.any(String),
    );
  });

  it("lets the coworker accept or decline a swap", async () => {
    mocks.cancelShiftRequestAction.mockResolvedValueOnce({
      success: false,
      error: "Already closed",
    });
    mocks.claimShiftRequestAction.mockResolvedValueOnce({ success: true });
    show({
      requests: [
        request({
          request_type: "swap",
          target_user_id: "ben",
          claimed_by: "ben",
          swap_shift_id: 2,
          swap_shift_start: "2030-01-06T09:00:00Z",
          swap_shift_end: "2030-01-06T17:00:00Z",
          swap_shift_owner: "ben",
        }),
      ],
    });
    expect(screen.getByText("Waiting for your answer")).toBeVisible();
    expect(screen.getByText(/In return, Ben/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("Already closed"),
    );
    fireEvent.click(screen.getByRole("button", { name: /Accept/ }));
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith("Request accepted"),
    );
  });

  it("lists your own requests with a cancel button", () => {
    show({
      requests: [
        request({
          requested_by: "ben",
          shift_owner: "ben",
          status: "pending_approval",
          claimed_by: "zoe",
        }),
      ],
    });
    expect(screen.getByText("Your requests")).toBeVisible();
    // Names that aren't known fall back to a generic label.
    expect(screen.getByText(/→ A team member/)).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Cancel request" }),
    ).toBeVisible();
  });

  it("shows a shift you claimed without buttons while it waits", () => {
    show({
      requests: [request({ status: "pending_approval", claimed_by: "ben" })],
    });
    expect(screen.getByText("Waiting for approval")).toBeVisible();
    // Only the card's "New request" button; the row itself has none.
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "New request",
    ]);
  });

  it("lets an admin approve or deny", async () => {
    mocks.approveShiftRequestAction.mockResolvedValueOnce({ success: true });
    mocks.denyShiftRequestAction.mockResolvedValueOnce({ success: true });
    show({
      userId: "mgr",
      isAdmin: true,
      requests: [request({ status: "pending_approval", claimed_by: "ben" })],
    });
    expect(screen.getByText("Waiting for your approval")).toBeVisible();
    expect(screen.queryByText("Your requests")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Approve/ }));
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith(
        "Approved: the schedule is updated",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: /Deny/ }));
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith("Request denied"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel request" }));
    await waitFor(() =>
      expect(mocks.cancelShiftRequestAction).toHaveBeenCalled(),
    );
  });
});
