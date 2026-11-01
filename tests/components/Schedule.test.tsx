import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ScheduledShiftWithStatus, ShiftStatus } from "@/lib/types";
import { renderWithClient, resolved } from "../utils";

const mocks = vi.hoisted(() => ({
  createScheduledShiftAction: vi.fn(),
  deleteScheduledShiftAction: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/actions", () => ({
  createScheduledShiftAction: mocks.createScheduledShiftAction,
  deleteScheduledShiftAction: mocks.deleteScheduledShiftAction,
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import Schedule, { buildShiftTimes } from "@/components/Schedule";

let nextId = 1;
function shift(
  status: ShiftStatus,
  overrides: Partial<ScheduledShiftWithStatus> = {},
): ScheduledShiftWithStatus {
  return {
    id: nextId++,
    org_id: "org_1",
    user_id: "user_1",
    shift_start: new Date("2026-01-05T09:00:00Z"),
    shift_end: new Date("2026-01-05T17:00:00Z"),
    note: null,
    created_by: "admin_1",
    status,
    actual_clock_in: null,
    actual_clock_out: null,
    minutes_late: null,
    ...overrides,
  };
}

const members = [
  { id: "user_1", name: "Sam" },
  { id: "user_2", name: "Alex" },
];

function renderSchedule(
  shifts: ScheduledShiftWithStatus[],
  isAdmin = true,
  withMembers = true,
) {
  renderWithClient(
    <Schedule
      isAdmin={isAdmin}
      membersPromise={withMembers ? resolved(members) : undefined}
      schedulePromise={resolved({ ok: true as const, value: shifts })}
    />,
  );
}

const section = (heading: string) =>
  screen
    .getByRole("heading", { name: heading })
    .closest("[class*='rounded-xl border']") as HTMLElement;

describe("buildShiftTimes", () => {
  it("builds a same-day shift from local times", () => {
    const { shiftStart, shiftEnd } = buildShiftTimes(
      "2026-01-05",
      "09:00",
      "17:00",
    );
    expect(shiftStart.toISOString()).toBe("2026-01-05T09:00:00.000Z");
    expect(shiftEnd.toISOString()).toBe("2026-01-05T17:00:00.000Z");
  });

  it("rolls an earlier end time into the next day", () => {
    const { shiftEnd } = buildShiftTimes("2026-01-05", "22:00", "06:00");
    expect(shiftEnd.toISOString()).toBe("2026-01-06T06:00:00.000Z");
  });
});

describe("Schedule", () => {
  it("shows the error when the schedule fails to load", () => {
    renderWithClient(
      <Schedule
        isAdmin={false}
        schedulePromise={resolved({
          ok: false as const,
          error: { reason: "boom" },
        })}
      />,
    );
    expect(screen.getByText("Error fetching schedule: boom")).toBeVisible();
  });

  it("shows members their own schedule without admin controls", () => {
    renderSchedule(
      [
        shift("scheduled", { note: "Front desk" }),
        shift("late", {
          actual_clock_in: new Date("2026-01-04T09:12:00Z"),
          actual_clock_out: new Date("2026-01-04T17:00:00Z"),
          minutes_late: 12,
        }),
      ],
      false,
      false,
    );
    expect(screen.getByText("My schedule")).toBeVisible();
    expect(screen.queryByText("Publish shift")).toBeNull();
    expect(screen.queryByLabelText("Remove shift")).toBeNull();
    expect(screen.queryByText("Sam")).toBeNull();
    expect(screen.getByText("Front desk")).toBeVisible();
    expect(
      within(section("Past two weeks")).getByText(
        "Clocked in 9:12 AM (12 min late) · out 5:00 PM",
      ),
    ).toBeVisible();
  });

  it("splits shifts into upcoming and past and summarises flags for admins", () => {
    renderSchedule([
      shift("scheduled"),
      shift("not_clocked_in", { user_id: "user_2" }),
      shift("on_time", {
        actual_clock_in: new Date("2026-01-05T09:00:00Z"),
        minutes_late: 0,
      }),
      shift("late", {
        actual_clock_in: new Date("2026-01-04T09:30:00Z"),
        actual_clock_out: new Date("2026-01-04T17:00:00Z"),
        minutes_late: 30,
      }),
      shift("no_show", { user_id: "ghost" }),
    ]);
    const upcoming = section("Upcoming & in progress");
    const past = section("Past two weeks");
    expect(within(upcoming).getAllByText("Scheduled")).toHaveLength(1);
    expect(within(upcoming).getByText("Not clocked in")).toBeVisible();
    expect(within(upcoming).getByText("On time")).toBeVisible();
    expect(within(upcoming).getByText(/still on the clock/)).toBeVisible();
    expect(within(past).getByText("Late")).toBeVisible();
    expect(within(past).getByText("No-show")).toBeVisible();
    expect(within(past).getByText("Unknown member")).toBeVisible();
    expect(within(upcoming).getByText("Alex")).toBeVisible();

    // Summary: one each of late, not clocked in, no-show.
    const summary = screen.getAllByText("1");
    expect(summary).toHaveLength(3);
  });

  it("filters to flagged shifts and shows empty states", () => {
    renderSchedule([shift("scheduled"), shift("on_time")]);
    fireEvent.click(screen.getByLabelText("Flagged only"));
    expect(screen.getByText("No upcoming shifts.")).toBeVisible();
    expect(screen.getByText("No shifts in the past two weeks.")).toBeVisible();
  });

  it("publishes a shift from the form", async () => {
    mocks.createScheduledShiftAction.mockResolvedValue({
      success: true,
      data: {},
    });
    renderSchedule([]);
    const publish = screen.getByRole("button", { name: "Publish shift" });
    expect(publish).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Member"), {
      target: { value: "user_2" },
    });
    fireEvent.change(screen.getByLabelText("Date"), {
      target: { value: "2026-01-07" },
    });
    fireEvent.change(screen.getByLabelText("Start"), {
      target: { value: "22:00" },
    });
    fireEvent.change(screen.getByLabelText("End"), {
      target: { value: "06:00" },
    });
    fireEvent.change(screen.getByLabelText("Note (optional)"), {
      target: { value: "Night" },
    });
    fireEvent.click(publish);

    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith("Shift published"),
    );
    expect(mocks.createScheduledShiftAction).toHaveBeenCalledWith(
      "user_2",
      "2026-01-07T22:00:00.000Z",
      "2026-01-08T06:00:00.000Z",
      "Night",
    );
    expect(screen.getByLabelText("Note (optional)")).toHaveValue("");
  });

  it("shows the error when publishing fails", async () => {
    mocks.createScheduledShiftAction.mockResolvedValue({
      success: false,
      error: "Member not found",
    });
    renderSchedule([]);
    fireEvent.change(screen.getByLabelText("Member"), {
      target: { value: "user_1" },
    });
    fireEvent.change(screen.getByLabelText("Date"), {
      target: { value: "2026-01-07" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Publish shift" }));
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("Member not found"),
    );
  });

  it("asks before removing a shift and can be cancelled", () => {
    renderSchedule([shift("scheduled")]);
    fireEvent.click(screen.getByLabelText("Remove shift"));
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(screen.getByLabelText("Remove shift")).toBeVisible();
    expect(mocks.deleteScheduledShiftAction).not.toHaveBeenCalled();
  });

  it("removes a shift", async () => {
    mocks.deleteScheduledShiftAction.mockResolvedValue({ success: true });
    const s = shift("scheduled");
    renderSchedule([s]);
    fireEvent.click(screen.getByLabelText("Remove shift"));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith("Shift removed"),
    );
    expect(mocks.deleteScheduledShiftAction.mock.calls[0][0]).toBe(s.id);
  });

  it("shows the error when removing fails", async () => {
    mocks.deleteScheduledShiftAction.mockResolvedValue({
      success: false,
      error: "Shift not found",
    });
    renderSchedule([shift("scheduled")]);
    fireEvent.click(screen.getByLabelText("Remove shift"));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("Shift not found"),
    );
    expect(screen.getByLabelText("Remove shift")).toBeVisible();
  });

  it("disables the controls while a removal or publish is in flight", async () => {
    mocks.deleteScheduledShiftAction.mockReturnValue(new Promise(() => {}));
    mocks.createScheduledShiftAction.mockReturnValue(new Promise(() => {}));
    renderSchedule([shift("scheduled")]);

    fireEvent.click(screen.getByLabelText("Remove shift"));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(
      await screen.findByRole("button", { name: "Removing…" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Keep" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Member"), {
      target: { value: "user_1" },
    });
    fireEvent.change(screen.getByLabelText("Date"), {
      target: { value: "2026-01-07" },
    });
    const publish = screen.getByRole("button", { name: "Publish shift" });
    fireEvent.click(publish);
    await waitFor(() => expect(publish).toBeDisabled());
    expect(publish.querySelector(".animate-spin")).not.toBeNull();
  });
});
