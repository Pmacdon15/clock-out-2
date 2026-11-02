import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TimeOffRequest } from "@/lib/types";
import { renderWithClient, resolved } from "../utils";

const mocks = vi.hoisted(() => ({
  createTimeOffRequestAction: vi.fn(),
  reviewTimeOffRequestAction: vi.fn(),
  cancelTimeOffRequestAction: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/actions", () => ({
  createTimeOffRequestAction: mocks.createTimeOffRequestAction,
  reviewTimeOffRequestAction: mocks.reviewTimeOffRequestAction,
  cancelTimeOffRequestAction: mocks.cancelTimeOffRequestAction,
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import TimeOff from "@/components/TimeOff";

let nextId = 1;
function request(overrides: Partial<TimeOffRequest> = {}): TimeOffRequest {
  return {
    id: nextId++,
    org_id: "org_1",
    user_id: "me",
    request_type: "vacation",
    start_date: "2026-03-09",
    end_date: "2026-03-10",
    hours_per_day: 8,
    note: null,
    status: "pending",
    reviewed_by: null,
    reviewed_at: null,
    ...overrides,
  };
}

const members = [
  { id: "me", name: "Me" },
  { id: "u2", name: "Grace" },
];

function renderTimeOff(
  requests: TimeOffRequest[],
  isAdmin = false,
  withMembers = true,
) {
  renderWithClient(
    <TimeOff
      currentUserIdPromise={resolved("me")}
      isAdmin={isAdmin}
      membersPromise={withMembers ? resolved(members) : undefined}
      timeOffPromise={resolved({ ok: true as const, value: requests })}
    />,
  );
}

const card = (heading: string) =>
  screen
    .getByRole("heading", { name: heading })
    .closest("[class*='rounded-xl border']") as HTMLElement;

describe("TimeOff", () => {
  it("shows the error when time off fails to load", () => {
    renderWithClient(
      <TimeOff
        currentUserIdPromise={resolved("me")}
        isAdmin={false}
        timeOffPromise={resolved({
          ok: false as const,
          error: { reason: "boom" },
        })}
      />,
    );
    expect(screen.getByText("Error fetching time off: boom")).toBeVisible();
  });

  it("shows a member their requests with cancel on pending ones only", () => {
    renderTimeOff(
      [
        request({ note: "Trip" }),
        request({ status: "approved" }),
        request({
          status: "denied",
          request_type: "sick",
          start_date: "2026-03-02",
          end_date: "2026-03-02",
        }),
      ],
      false,
      false,
    );
    const mine = card("My requests");
    expect(within(mine).getAllByRole("listitem")).toHaveLength(3);
    expect(within(mine).getByText("Trip")).toBeVisible();
    expect(within(mine).getByText("Sick day · Mar 2, 2026 · 8h")).toBeVisible();
    expect(
      within(mine).getAllByRole("button", { name: "Cancel request" }),
    ).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByText("Waiting for approval")).toBeNull();
    expect(screen.queryByText("Me")).toBeNull();
  });

  it("shows an empty state", () => {
    renderTimeOff([]);
    expect(screen.getByText("No time off yet.")).toBeVisible();
  });

  it("gives admins a review queue and lets them revoke approved time off", () => {
    renderTimeOff(
      [
        request({ user_id: "u2" }),
        request({ status: "approved", user_id: "ghost" }),
        request({ status: "cancelled" }),
      ],
      true,
    );
    const queue = card("Waiting for approval");
    expect(within(queue).getByText("Grace")).toBeVisible();
    expect(
      within(queue).getByRole("button", { name: /Approve/ }),
    ).toBeVisible();
    const all = card("All requests");
    expect(within(all).getByText("Unknown member")).toBeVisible();
    expect(within(all).getAllByRole("listitem")).toHaveLength(2);
    expect(within(all).getAllByRole("button", { name: "Revoke" })).toHaveLength(
      1,
    );
  });

  it("shows admins an empty review queue", () => {
    renderTimeOff([], true);
    expect(screen.getByText("No requests waiting.")).toBeVisible();
  });

  it("approves and denies requests", async () => {
    mocks.reviewTimeOffRequestAction.mockResolvedValue({ success: true });
    const r = request({ user_id: "u2" });
    renderTimeOff([r], true);
    fireEvent.click(screen.getByRole("button", { name: /Approve/ }));
    await waitFor(() =>
      expect(mocks.reviewTimeOffRequestAction).toHaveBeenCalledWith(
        r.id,
        "approved",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: /Deny/ }));
    await waitFor(() =>
      expect(mocks.reviewTimeOffRequestAction).toHaveBeenCalledWith(
        r.id,
        "denied",
      ),
    );
    expect(mocks.toast.success).toHaveBeenCalledWith("Request updated");
  });

  it("cancels a request and shows errors", async () => {
    mocks.cancelTimeOffRequestAction.mockResolvedValue({
      success: false,
      error: "Request not found or can't be cancelled",
    });
    const r = request();
    renderTimeOff([r]);
    fireEvent.click(screen.getByRole("button", { name: "Cancel request" }));
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(
        "Request not found or can't be cancelled",
      ),
    );
    expect(mocks.cancelTimeOffRequestAction).toHaveBeenCalledWith(r.id);
  });

  it("disables the buttons while a change is in flight", async () => {
    mocks.reviewTimeOffRequestAction.mockReturnValue(new Promise(() => {}));
    renderTimeOff([request({ user_id: "u2" })], true);
    fireEvent.click(screen.getByRole("button", { name: /Approve/ }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Deny/ })).toBeDisabled(),
    );
    expect(
      screen.getByRole("button", { name: "Cancel request" }),
    ).toBeDisabled();
  });

  it("requests a single day when no end date is given, then clears the form", async () => {
    mocks.createTimeOffRequestAction.mockResolvedValue({
      success: true,
      data: {},
    });
    renderTimeOff([]);
    const submit = screen.getByRole("button", { name: "Request time off" });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Type"), {
      target: { value: "sick" },
    });
    fireEvent.change(screen.getByLabelText("Hours per day"), {
      target: { value: "7.5" },
    });
    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "2026-03-09" },
    });
    expect(screen.getByLabelText(/^To/)).toHaveAttribute("min", "2026-03-09");
    fireEvent.change(screen.getByLabelText("Note (optional)"), {
      target: { value: "Flu" },
    });
    fireEvent.click(submit);

    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith("Time off requested"),
    );
    expect(mocks.createTimeOffRequestAction).toHaveBeenCalledWith(
      "sick",
      "2026-03-09",
      "2026-03-09",
      7.5,
      "Flu",
    );
    expect(screen.getByLabelText("From")).toHaveValue("");
    expect(screen.getByLabelText("Note (optional)")).toHaveValue("");
  });

  it("sends the end date and keeps the form when the request fails", async () => {
    mocks.createTimeOffRequestAction.mockResolvedValue({
      success: false,
      error: "You already have time off on those dates",
    });
    renderTimeOff([]);
    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "2026-03-09" },
    });
    fireEvent.change(screen.getByLabelText(/^To/), {
      target: { value: "2026-03-11" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Request time off" }));
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(
        "You already have time off on those dates",
      ),
    );
    expect(mocks.createTimeOffRequestAction.mock.calls[0].slice(1, 3)).toEqual([
      "2026-03-09",
      "2026-03-11",
    ]);
    expect(screen.getByLabelText("From")).toHaveValue("2026-03-09");
  });

  it("shows a spinner while the request is sent", async () => {
    mocks.createTimeOffRequestAction.mockReturnValue(new Promise(() => {}));
    renderTimeOff([]);
    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "2026-03-09" },
    });
    const submit = screen.getByRole("button", { name: "Request time off" });
    fireEvent.click(submit);
    await waitFor(() => expect(submit).toBeDisabled());
    expect(submit.querySelector(".animate-spin")).not.toBeNull();
  });

  it("lets admins add approved time off for a member", async () => {
    mocks.createTimeOffRequestAction.mockResolvedValue({
      success: true,
      data: {},
    });
    renderTimeOff([], true);
    expect(screen.getByLabelText("Approve right away")).toBeChecked();
    fireEvent.change(screen.getByLabelText("For"), {
      target: { value: "u2" },
    });
    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "2026-03-09" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add time off" }));
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith("Time off added"),
    );
    expect(mocks.createTimeOffRequestAction).toHaveBeenCalledWith(
      "vacation",
      "2026-03-09",
      "2026-03-09",
      8,
      "",
      { memberId: "u2", approve: true },
    );
  });

  it("lets admins file a pending request for themselves", async () => {
    mocks.createTimeOffRequestAction.mockResolvedValue({
      success: true,
      data: {},
    });
    renderTimeOff([], true, false);
    expect(screen.getByLabelText("For")).toHaveValue("");
    fireEvent.click(screen.getByLabelText("Approve right away"));
    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "2026-03-09" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Request time off" }));
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith("Time off requested"),
    );
    expect(mocks.createTimeOffRequestAction.mock.calls[0][5]).toEqual({
      memberId: null,
      approve: false,
    });
  });

  it("hides the admin options from members", () => {
    renderTimeOff([]);
    expect(screen.queryByLabelText("For")).toBeNull();
    expect(screen.queryByLabelText("Approve right away")).toBeNull();
  });

  it("keeps the admin form when adding time off fails", async () => {
    mocks.createTimeOffRequestAction.mockResolvedValue({
      success: false,
      error: "This member already has time off on those dates",
    });
    renderTimeOff([], true);
    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "2026-03-09" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add time off" }));
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(
        "This member already has time off on those dates",
      ),
    );
    expect(screen.getByLabelText("From")).toHaveValue("2026-03-09");
  });
});
