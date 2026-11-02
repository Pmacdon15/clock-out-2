import {
  cleanup as cleanupDom,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimeOffAllowance, TimeOffRequest } from "@/lib/types";
import { renderWithClient, resolved } from "../utils";

const mocks = vi.hoisted(() => ({
  createTimeOffRequestAction: vi.fn(),
  reviewTimeOffRequestAction: vi.fn(),
  cancelTimeOffRequestAction: vi.fn(),
  setTimeOffAllowanceAction: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/actions", () => ({
  createTimeOffRequestAction: mocks.createTimeOffRequestAction,
  reviewTimeOffRequestAction: mocks.reviewTimeOffRequestAction,
  cancelTimeOffRequestAction: mocks.cancelTimeOffRequestAction,
  setTimeOffAllowanceAction: mocks.setTimeOffAllowanceAction,
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

describe("TimeOff PTO allowances", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-01T12:00:00"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const allowance = (user_id: string, pto_days: number): TimeOffAllowance => ({
    org_id: "org_1",
    user_id,
    pto_days,
  });

  function renderWithAllowances(
    requests: TimeOffRequest[],
    allowances: TimeOffAllowance[] | null,
    {
      isAdmin = false,
      userId = "me" as string | null,
      withMembers = true,
    } = {},
  ) {
    renderWithClient(
      <TimeOff
        allowancesPromise={resolved(
          allowances
            ? { ok: true as const, value: allowances }
            : { ok: false as const, error: { reason: "boom" } },
        )}
        currentUserIdPromise={resolved(userId)}
        isAdmin={isAdmin}
        membersPromise={withMembers ? resolved(members) : resolved([])}
        timeOffPromise={resolved({ ok: true as const, value: requests })}
      />,
    );
  }

  it("shows a member their PTO balance for the year", () => {
    renderWithAllowances(
      [
        request({ status: "approved" }), // Mar 9–10: 2 days used
        request({ start_date: "2026-04-01", end_date: "2026-04-01" }), // pending
        request({ request_type: "sick", status: "approved" }),
        request({ request_type: "unpaid", status: "approved" }),
      ],
      [allowance("me", 10)],
    );
    const balance = card("My PTO for 2026");
    expect(within(balance).getByText("10 days")).toBeVisible();
    expect(within(balance).getByText("2 days")).toBeVisible();
    expect(within(balance).getByText("1 day")).toBeVisible();
    expect(within(balance).getByText("7 days")).toBeVisible();
    // The request form says how much is left while vacation is picked.
    expect(screen.getByText("7 days of PTO left for 2026")).toBeVisible();
    expect(screen.queryByText("PTO days per employee")).toBeNull();
  });

  it("never shows a negative balance", () => {
    renderWithAllowances(
      [request({ status: "approved" })],
      [allowance("me", 1)],
    );
    expect(screen.getByText("0 days of PTO left for 2026")).toBeVisible();
  });

  it("explains unpaid time off and hides the PTO hint for other types", () => {
    renderWithAllowances([], [allowance("me", 5)]);
    fireEvent.change(screen.getByLabelText("Type"), {
      target: { value: "unpaid" },
    });
    expect(
      screen.getByText("Unpaid time off doesn't use your PTO and isn't paid."),
    ).toBeVisible();
    expect(screen.queryByText(/of PTO left/)).toBeNull();
  });

  it("shows no balance without an allowance, a user, or allowances", () => {
    renderWithAllowances([], []);
    expect(screen.queryByText(/My PTO/)).toBeNull();
    expect(screen.queryByText(/of PTO left/)).toBeNull();
    cleanupDom();
    renderWithAllowances([], [allowance("me", 5)], { userId: null });
    expect(screen.queryByText(/My PTO/)).toBeNull();
    cleanupDom();
    renderWithAllowances([], null, { isAdmin: true });
    expect(screen.queryByText(/My PTO/)).toBeNull();
    expect(screen.queryByText("PTO days per employee")).toBeNull();
  });

  it("lets admins see and set each member's PTO days", async () => {
    mocks.setTimeOffAllowanceAction.mockResolvedValue({
      success: true,
      data: {},
    });
    renderWithAllowances(
      [request({ user_id: "u2", status: "approved" })],
      [allowance("u2", 15)],
      { isAdmin: true },
    );
    const settings = card("PTO days per employee");
    const rows = within(settings).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("No PTO limit");
    expect(rows[1]).toHaveTextContent(
      "2 days used · 0 days pending · 13 days left",
    );

    const graceInput = screen.getByLabelText("PTO days per year for Grace");
    expect(graceInput).toHaveValue(15);
    const graceSave = within(rows[1]).getByRole("button", { name: "Save" });
    expect(graceSave).toBeDisabled();

    // Clearing the field removes the limit.
    fireEvent.change(graceInput, { target: { value: "" } });
    fireEvent.click(graceSave);
    await waitFor(() =>
      expect(mocks.setTimeOffAllowanceAction).toHaveBeenCalledWith("u2", null),
    );
    expect(mocks.toast.success).toHaveBeenCalledWith("PTO allowance saved");

    const meInput = screen.getByLabelText("PTO days per year for Me");
    expect(meInput).toHaveValue(null);
    fireEvent.change(meInput, { target: { value: "12.5" } });
    fireEvent.click(within(rows[0]).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mocks.setTimeOffAllowanceAction).toHaveBeenCalledWith("me", 12.5),
    );
  });

  it("shows a spinner while an allowance saves", async () => {
    mocks.setTimeOffAllowanceAction.mockReturnValue(new Promise(() => {}));
    renderWithAllowances([], [], { isAdmin: true });
    fireEvent.change(screen.getByLabelText("PTO days per year for Me"), {
      target: { value: "3" },
    });
    const save = within(card("PTO days per employee")).getAllByRole("button", {
      name: "Save",
    })[0];
    fireEvent.click(save);
    await waitFor(() => expect(save).toBeDisabled());
    expect(save.querySelector(".animate-spin")).not.toBeNull();
  });

  it("shows admins an empty member list", () => {
    renderWithAllowances([], [], { isAdmin: true, withMembers: false });
    expect(screen.getByText("No members yet.")).toBeVisible();
  });
});
