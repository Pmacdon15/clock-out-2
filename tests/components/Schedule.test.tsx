import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  AvailabilityWindow,
  ScheduledShiftWithStatus,
  ShiftStatus,
  SiteData,
  TimeOffRequest,
} from "@/lib/types";
import { renderWithClient, resolved } from "../utils";

const mocks = vi.hoisted(() => ({
  createScheduledShiftAction: vi.fn(),
  createWeeklyScheduledShiftsAction: vi.fn(),
  createRepeatingShiftAction: vi.fn(),
  repeatShiftWeeklyAction: vi.fn(),
  stopRepeatingShiftAction: vi.fn(),
  deleteScheduledShiftAction: vi.fn(),
  updateScheduledShiftAction: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  addShiftsToGoogleCalendarAction: vi.fn(),
}));

vi.mock("@/lib/actions", () => ({
  createScheduledShiftAction: mocks.createScheduledShiftAction,
  createWeeklyScheduledShiftsAction: mocks.createWeeklyScheduledShiftsAction,
  createRepeatingShiftAction: mocks.createRepeatingShiftAction,
  repeatShiftWeeklyAction: mocks.repeatShiftWeeklyAction,
  stopRepeatingShiftAction: mocks.stopRepeatingShiftAction,
  deleteScheduledShiftAction: mocks.deleteScheduledShiftAction,
  updateScheduledShiftAction: mocks.updateScheduledShiftAction,
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/lib/calendar-feed-actions", () => ({
  resetCalendarFeedAction: vi.fn(),
}));
vi.mock("@/lib/google-calendar-actions", () => ({
  addShiftsToGoogleCalendarAction: mocks.addShiftsToGoogleCalendarAction,
}));
vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({ user: { externalAccounts: [] } }),
  useOrganization: () => ({ organization: { name: "Acme" } }),
}));

import Schedule, {
  buildShiftTimes,
  findTimeOffConflict,
  locationChoiceFor,
  locationInputFor,
  weeklyShiftOccurrences,
} from "@/components/Schedule";

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
  timeOff: TimeOffRequest[] = [],
  sites?: SiteData[] | "error",
) {
  renderWithClient(
    <Schedule
      isAdmin={isAdmin}
      membersPromise={withMembers ? resolved(members) : undefined}
      schedulePromise={resolved({ ok: true as const, value: shifts })}
      sitesPromise={
        sites === undefined
          ? undefined
          : resolved(
              sites === "error"
                ? { ok: false as const, error: { reason: "nope" } }
                : { ok: true as const, value: sites },
            )
      }
      timeOffPromise={resolved({ ok: true as const, value: timeOff })}
    />,
  );
}

const sites: SiteData[] = [
  {
    id: 7,
    org_id: "org_1",
    name: "Warehouse",
    latitude: 1,
    longitude: 2,
    radius_meters: 150,
    address: "1 King St",
  },
  {
    id: 8,
    org_id: "org_1",
    name: "Shop",
    latitude: 3,
    longitude: 4,
    radius_meters: 150,
    address: null,
  },
];

function timeOff(overrides: Partial<TimeOffRequest> = {}): TimeOffRequest {
  return {
    id: 1,
    org_id: "org_1",
    user_id: "user_1",
    request_type: "vacation",
    start_date: "2026-01-07",
    end_date: "2026-01-08",
    hours_per_day: 8,
    note: null,
    status: "approved",
    reviewed_by: "admin_1",
    reviewed_at: null,
    created_at: null,
    updated_at: null,
    ...overrides,
  } as TimeOffRequest;
}

const section = (heading: string) =>
  screen
    .getByRole("heading", { name: heading })
    .closest("[class*='rounded-xl border']") as HTMLElement;

describe("locationChoiceFor / locationInputFor", () => {
  it("starts from the shift's saved site, its typed location, or nothing", () => {
    expect(
      locationChoiceFor({ site_id: 7, location: "Warehouse" }, sites),
    ).toEqual({ choice: "7", typed: "" });
    // A site removed since falls back to its name, as a typed location.
    expect(
      locationChoiceFor({ site_id: 99, location: "Old yard" }, sites),
    ).toEqual({ choice: "other", typed: "Old yard" });
    expect(locationChoiceFor({ location: "Client" }, sites)).toEqual({
      choice: "other",
      typed: "Client",
    });
    expect(locationChoiceFor({}, sites)).toEqual({ choice: "", typed: "" });
  });

  it("sends a site id, the typed text, or nothing", () => {
    expect(locationInputFor({ choice: "7", typed: "" })).toEqual({ siteId: 7 });
    expect(locationInputFor({ choice: "other", typed: "Client" })).toEqual({
      location: "Client",
    });
    expect(locationInputFor({ choice: "", typed: "x" })).toEqual({});
  });
});

describe("findTimeOffConflict", () => {
  it("finds the member's approved time off the shift lands on", () => {
    const request = timeOff();
    expect(
      findTimeOffConflict([request], "user_1", "2026-01-08", "09:00", "17:00"),
    ).toBe(request);
    expect(
      findTimeOffConflict([request], "user_2", "2026-01-08", "09:00", "17:00"),
    ).toBeUndefined();
  });

  it("ignores a date it can't read", () => {
    expect(
      findTimeOffConflict(
        [timeOff()],
        "user_1",
        "not-a-date",
        "09:00",
        "17:00",
      ),
    ).toBeUndefined();
  });
});

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

  it("shows empty states with no shifts", () => {
    renderSchedule([]);
    expect(screen.getByText("No upcoming shifts.")).toBeVisible();
    expect(screen.getByText("No shifts in the past two weeks.")).toBeVisible();
    expect(screen.getByText("0 shifts")).toBeVisible();
  });

  it("filters to flagged shifts and says when nothing matches", () => {
    renderSchedule([shift("scheduled"), shift("on_time")]);
    fireEvent.change(screen.getByLabelText("Filter by status"), {
      target: { value: "flagged" },
    });
    expect(
      screen.getByText("No upcoming shifts match these filters."),
    ).toBeVisible();
    expect(
      screen.getByText("No past shifts match these filters."),
    ).toBeVisible();
    expect(screen.getByText("Showing 0 of 2 shifts")).toBeVisible();
  });

  it("filters by member, search, day, weekday and time, then clears", () => {
    renderSchedule([
      shift("scheduled", { note: "Front desk" }),
      shift("scheduled", {
        user_id: "user_2",
        shift_start: new Date("2026-01-06T22:00:00Z"),
        shift_end: new Date("2026-01-07T06:00:00Z"),
      }),
    ]);
    const upcoming = () => section("Upcoming & in progress");
    expect(screen.getByText("2 shifts")).toBeVisible();

    fireEvent.change(screen.getByLabelText("Filter by member"), {
      target: { value: "user_2" },
    });
    expect(within(upcoming()).getByText("Alex")).toBeVisible();
    expect(within(upcoming()).queryByText("Sam")).toBeNull();
    expect(within(upcoming()).getByText("1 matching")).toBeVisible();

    fireEvent.change(screen.getByLabelText("Filter by time of day"), {
      target: { value: "overnight" },
    });
    fireEvent.change(screen.getByLabelText("Filter by weekday"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText("Filter by day"), {
      target: { value: "2026-01-07" },
    });
    expect(screen.getByText("Showing 1 of 2 shifts")).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", { name: /Clear filters \(4\)/ }),
    );
    expect(screen.getByText("2 shifts")).toBeVisible();
    expect(screen.getByLabelText("Filter by member")).toHaveValue("");

    fireEvent.change(screen.getByLabelText("Search shifts"), {
      target: { value: "front" },
    });
    expect(within(upcoming()).getByText("Sam")).toBeVisible();
    expect(within(upcoming()).queryByText("Alex")).toBeNull();
    expect(screen.getByText("Showing 1 of 2 shifts")).toBeVisible();
  });

  it("toggles a status filter from the summary cards", () => {
    renderSchedule([shift("late", { minutes_late: 10 }), shift("scheduled")]);
    const late = screen.getByRole("button", { name: /Late/ });
    fireEvent.click(late);
    expect(late).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Filter by status")).toHaveValue("late");
    expect(screen.getByText("Showing 1 of 2 shifts")).toBeVisible();
    fireEvent.click(late);
    expect(late).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("2 shifts")).toBeVisible();
  });

  it("words the count for a single shift", () => {
    renderSchedule([shift("scheduled")]);
    expect(screen.getByText("1 shift")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Filter by status"), {
      target: { value: "scheduled" },
    });
    expect(screen.getByText("Showing 1 of 1 shift")).toBeVisible();
  });

  it("hides the filters from members", () => {
    renderSchedule([shift("scheduled")], false);
    expect(screen.queryByLabelText("Search shifts")).toBeNull();
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
      // The admin's zone, so the member's notice words the times locally.
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      { start: "2026-01-07", end: "2026-01-08" },
      {},
    );
    expect(screen.getByLabelText("Note (optional)")).toHaveValue("");
  });

  it("blocks a shift that overlaps one the member already has", () => {
    renderSchedule([shift("scheduled")]);
    fireEvent.change(screen.getByLabelText("Member"), {
      target: { value: "user_1" },
    });
    fireEvent.change(screen.getByLabelText("Date"), {
      target: { value: "2026-01-05" },
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Sam is already scheduled Mon, Jan 5, 9:00 AM – 5:00 PM",
    );
    expect(
      screen.getByRole("button", { name: "Publish shift" }),
    ).toBeDisabled();

    // Someone else can still take that slot.
    fireEvent.change(screen.getByLabelText("Member"), {
      target: { value: "user_2" },
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("blocks a shift on the member's approved time off", () => {
    renderSchedule([], true, true, [
      timeOff(),
      timeOff({
        id: 2,
        user_id: "user_2",
        start_date: "2026-01-09",
        end_date: "2026-01-09",
      }),
      timeOff({
        id: 3,
        user_id: "user_1",
        status: "pending",
        start_date: "2026-01-12",
        end_date: "2026-01-12",
      }),
    ]);
    fireEvent.change(screen.getByLabelText("Member"), {
      target: { value: "user_1" },
    });
    fireEvent.change(screen.getByLabelText("Date"), {
      target: { value: "2026-01-08" },
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Sam has approved vacation (PTO) on Jan 7 – Jan 8, 2026",
    );
    expect(
      screen.getByRole("button", { name: "Publish shift" }),
    ).toBeDisabled();

    // An overnight shift running into the time off is blocked too.
    fireEvent.change(screen.getByLabelText("Date"), {
      target: { value: "2026-01-06" },
    });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.change(screen.getByLabelText("Start"), {
      target: { value: "22:00" },
    });
    fireEvent.change(screen.getByLabelText("End"), {
      target: { value: "06:00" },
    });
    expect(screen.getByRole("alert")).toBeVisible();

    // Other members' time off and pending requests don't block.
    fireEvent.change(screen.getByLabelText("Member"), {
      target: { value: "user_2" },
    });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.change(screen.getByLabelText("Member"), {
      target: { value: "user_1" },
    });
    fireEvent.change(screen.getByLabelText("Date"), {
      target: { value: "2026-01-12" },
    });
    fireEvent.change(screen.getByLabelText("End"), {
      target: { value: "23:00" },
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Publish shift" })).toBeEnabled();
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
    expect(mocks.deleteScheduledShiftAction.mock.calls[0]).toEqual([
      s.id,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    ]);
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

  it("edits a shift's times and note, then closes the form", async () => {
    mocks.updateScheduledShiftAction.mockResolvedValue({
      success: true,
      data: {},
    });
    const s = shift("scheduled", { note: "Desk" });
    renderSchedule([s]);
    fireEvent.click(screen.getByLabelText("Edit shift"));
    const row = screen
      .getByRole("button", { name: "Save shift" })
      .closest("li") as HTMLElement;
    const scoped = within(row);
    expect(scoped.getByLabelText("Date")).toHaveValue("2026-01-05");
    expect(scoped.getByLabelText("Start")).toHaveValue("09:00");
    expect(scoped.getByLabelText("End")).toHaveValue("17:00");
    expect(scoped.getByLabelText("Note")).toHaveValue("Desk");

    fireEvent.change(scoped.getByLabelText("Date"), {
      target: { value: "2026-01-06" },
    });
    fireEvent.change(scoped.getByLabelText("Start"), {
      target: { value: "10:00" },
    });
    fireEvent.change(scoped.getByLabelText("End"), {
      target: { value: "18:00" },
    });
    fireEvent.change(scoped.getByLabelText("Note"), {
      target: { value: "Till" },
    });
    fireEvent.click(scoped.getByRole("button", { name: "Save shift" }));

    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith("Shift updated"),
    );
    expect(mocks.updateScheduledShiftAction).toHaveBeenCalledWith(
      s.id,
      "2026-01-06T10:00:00.000Z",
      "2026-01-06T18:00:00.000Z",
      "Till",
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      { start: "2026-01-06", end: "2026-01-06" },
      {},
    );
    expect(screen.queryByRole("button", { name: "Save shift" })).toBeNull();
  });

  it("keeps the edit form open and shows the error when saving fails", async () => {
    mocks.updateScheduledShiftAction.mockResolvedValue({
      success: false,
      error: "This member has approved time off on Jan 6",
    });
    renderSchedule([shift("scheduled")]);
    fireEvent.click(screen.getByLabelText("Edit shift"));
    fireEvent.submit(screen.getByRole("button", { name: "Save shift" }));
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(
        "This member has approved time off on Jan 6",
      ),
    );
    expect(screen.getByRole("button", { name: "Save shift" })).toBeVisible();
  });

  it("starts the edit form with a blank note and can cancel or toggle it", () => {
    renderSchedule([shift("scheduled")]);
    fireEvent.click(screen.getByLabelText("Edit shift"));
    const row = screen
      .getByRole("button", { name: "Save shift" })
      .closest("li") as HTMLElement;
    expect(within(row).getByLabelText("Note")).toHaveValue("");
    fireEvent.change(within(row).getByLabelText("Date"), {
      target: { value: "" },
    });
    expect(screen.getByRole("button", { name: "Save shift" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: "Save shift" })).toBeNull();
    fireEvent.click(screen.getByLabelText("Edit shift"));
    fireEvent.click(screen.getByLabelText("Edit shift"));
    expect(screen.queryByRole("button", { name: "Save shift" })).toBeNull();
    expect(mocks.updateScheduledShiftAction).not.toHaveBeenCalled();
  });

  it("disables the edit form while saving", async () => {
    mocks.updateScheduledShiftAction.mockReturnValue(new Promise(() => {}));
    renderSchedule([shift("scheduled")]);
    fireEvent.click(screen.getByLabelText("Edit shift"));
    const save = screen.getByRole("button", { name: "Save shift" });
    fireEvent.click(save);
    await waitFor(() => expect(save).toBeDisabled());
    expect(save.querySelector(".animate-spin")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("hides the edit button from members", () => {
    renderSchedule([shift("scheduled")], false);
    expect(screen.queryByLabelText("Edit shift")).toBeNull();
  });

  it("keeps calendar options out of the shift rows", () => {
    renderSchedule([shift("scheduled")], false, false);
    expect(screen.queryByLabelText("Add shift to calendar")).toBeNull();
    expect(screen.getByRole("heading", { name: "Your calendar" })).toBeTruthy();
  });

  it("offers Apple and Outlook subscriptions when there is a feed", async () => {
    renderWithClient(
      <Schedule
        calendarFeedPromise={resolved("/api/calendar/tok.ics")}
        isAdmin={false}
        schedulePromise={resolved({ ok: true as const, value: [] })}
      />,
    );
    expect(
      await screen.findByText("Use Apple Calendar or Outlook instead?"),
    ).toBeVisible();
  });
});

describe("Schedule locations", () => {
  it("publishes a shift at a saved site", async () => {
    mocks.createScheduledShiftAction.mockResolvedValue({
      success: true,
      data: {},
    });
    renderSchedule([], true, true, [], sites);
    fireEvent.change(screen.getByLabelText("Member"), {
      target: { value: "user_2" },
    });
    fireEvent.change(screen.getByLabelText("Date"), {
      target: { value: "2026-01-07" },
    });
    const picker = screen.getByLabelText("Location (optional)");
    expect(
      within(picker)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["No location", "Warehouse", "Shop", "Other location…"]);
    // No free-text box until "Other location…" is picked.
    expect(screen.queryByLabelText("Other location")).toBeNull();
    fireEvent.change(picker, { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Publish shift" }));
    await waitFor(() =>
      expect(mocks.createScheduledShiftAction).toHaveBeenCalled(),
    );
    expect(mocks.createScheduledShiftAction.mock.calls[0][6]).toEqual({
      siteId: 7,
    });
  });

  it("publishes a shift at a location typed in", async () => {
    mocks.createScheduledShiftAction.mockResolvedValue({
      success: true,
      data: {},
    });
    renderSchedule([], true, true, [], sites);
    fireEvent.change(screen.getByLabelText("Member"), {
      target: { value: "user_2" },
    });
    fireEvent.change(screen.getByLabelText("Date"), {
      target: { value: "2026-01-07" },
    });
    fireEvent.change(screen.getByLabelText("Location (optional)"), {
      target: { value: "other" },
    });
    fireEvent.change(screen.getByLabelText("Other location"), {
      target: { value: "Client site" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Publish shift" }));
    await waitFor(() =>
      expect(mocks.createScheduledShiftAction).toHaveBeenCalled(),
    );
    expect(mocks.createScheduledShiftAction.mock.calls[0][6]).toEqual({
      location: "Client site",
    });
  });

  it("offers just a text box when there are no saved sites (or they fail to load)", () => {
    renderSchedule([], true, true, [], "error");
    const input = screen.getByLabelText("Location (optional)");
    expect(input.tagName).toBe("INPUT");
    fireEvent.change(input, { target: { value: "Depot" } });
    expect(input).toHaveValue("Depot");
  });

  it("shows the shift's location with a map link and its address", () => {
    renderSchedule(
      [
        shift("scheduled", {
          site_id: 7,
          location: "Warehouse",
          location_address: "1 King St",
        }),
        shift("scheduled", { location: "Client site" }),
      ],
      false,
    );
    const warehouse = screen.getByRole("link", { name: "Warehouse" });
    expect(warehouse).toHaveAttribute(
      "href",
      "https://www.google.com/maps/search/?api=1&query=1%20King%20St",
    );
    expect(screen.getByText("· 1 King St", { exact: false })).toBeVisible();
    expect(screen.getByRole("link", { name: "Client site" })).toHaveAttribute(
      "href",
      "https://www.google.com/maps/search/?api=1&query=Client%20site",
    );
  });

  it("edits a shift's location, starting from its saved site", async () => {
    mocks.updateScheduledShiftAction.mockResolvedValue({
      success: true,
      data: {},
    });
    renderSchedule(
      [shift("scheduled", { site_id: 7, location: "Warehouse" })],
      true,
      true,
      [],
      sites,
    );
    fireEvent.click(screen.getByLabelText("Edit shift"));
    const row = screen
      .getByRole("button", { name: "Save shift" })
      .closest("li") as HTMLElement;
    const scoped = within(row);
    const picker = scoped.getByLabelText("Location (optional)");
    expect(picker).toHaveValue("7");
    fireEvent.change(picker, { target: { value: "8" } });
    fireEvent.click(scoped.getByRole("button", { name: "Save shift" }));
    await waitFor(() =>
      expect(mocks.updateScheduledShiftAction).toHaveBeenCalled(),
    );
    expect(mocks.updateScheduledShiftAction.mock.calls[0][6]).toEqual({
      siteId: 8,
    });
  });
});

describe("weeklyShiftOccurrences", () => {
  it("sends each week's times and local days", () => {
    expect(
      weeklyShiftOccurrences(
        new Date("2026-01-05T22:00:00Z"),
        new Date("2026-01-06T06:00:00Z"),
        2,
        1,
      ),
    ).toEqual([
      {
        shiftStart: "2026-01-12T22:00:00.000Z",
        shiftEnd: "2026-01-13T06:00:00.000Z",
        localDays: { start: "2026-01-12", end: "2026-01-13" },
      },
      {
        shiftStart: "2026-01-19T22:00:00.000Z",
        shiftEnd: "2026-01-20T06:00:00.000Z",
        localDays: { start: "2026-01-19", end: "2026-01-20" },
      },
    ]);
  });
});

describe("Schedule weekly shifts", () => {
  function fillForm() {
    fireEvent.change(screen.getByLabelText("Member"), {
      target: { value: "user_2" },
    });
    fireEvent.change(screen.getByLabelText("Date"), {
      target: { value: "2026-01-07" },
    });
  }

  const repeatButton = () => screen.getByRole("button", { name: "Repeat…" });

  it("publishes a shift that repeats until stopped by default", async () => {
    mocks.createRepeatingShiftAction.mockResolvedValue({
      success: true,
      data: [
        { shift_start: "2026-01-07T09:00:00.000Z" },
        { shift_start: "2026-02-04T09:00:00.000Z" },
      ],
      skipped: [],
    });
    renderSchedule([]);
    fillForm();
    fireEvent.change(screen.getByLabelText("Note (optional)"), {
      target: { value: "Desk" },
    });
    const weekly = screen.getByRole("button", { name: "Weekly" });
    expect(weekly).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(weekly);
    expect(weekly).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByLabelText("Every Wednesday, until I stop it"),
    ).toBeChecked();
    expect(screen.getByLabelText("Number of weeks")).toBeDisabled();
    expect(screen.getByText(/added automatically/)).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", { name: "Publish repeating shift" }),
    );
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith(
        "Repeats every Wednesday. Scheduled through Feb 4; new weeks are added automatically.",
      ),
    );
    const [memberId, start, , note, timezone, localDays, location] =
      mocks.createRepeatingShiftAction.mock.calls[0];
    expect(memberId).toBe("user_2");
    expect(start).toBe("2026-01-07T09:00:00.000Z");
    expect(note).toBe("Desk");
    expect(timezone).toEqual(expect.any(String));
    expect(localDays).toEqual({ start: "2026-01-07", end: "2026-01-07" });
    expect(location).toEqual({});
    expect(mocks.createWeeklyScheduledShiftsAction).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Note (optional)")).toHaveValue("");
  });

  it("publishes a set number of weeks from the form", async () => {
    mocks.createWeeklyScheduledShiftsAction.mockResolvedValue({
      success: true,
      data: [{}, {}, {}],
      skipped: [],
    });
    renderSchedule([]);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Weekly" }));
    fireEvent.click(screen.getByLabelText("For the next"));
    const weeks = screen.getByLabelText("Number of weeks");
    expect(weeks).toHaveValue(4);
    expect(screen.getByText("weeks (4 shifts in total)")).toBeVisible();
    expect(screen.getByText(/Through Wed, Jan 28/)).toBeVisible();
    fireEvent.change(weeks, { target: { value: "3" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Publish 3 weekly shifts" }),
    );

    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith(
        "3 weekly shifts published",
      ),
    );
    const [memberId, occurrences] =
      mocks.createWeeklyScheduledShiftsAction.mock.calls[0];
    expect(memberId).toBe("user_2");
    expect(
      occurrences.map((w: { shiftStart: string }) => w.shiftStart),
    ).toEqual([
      "2026-01-07T09:00:00.000Z",
      "2026-01-14T09:00:00.000Z",
      "2026-01-21T09:00:00.000Z",
    ]);
    expect(mocks.createRepeatingShiftAction).not.toHaveBeenCalled();
  });

  it("keeps the week count in range and words a single week", () => {
    renderSchedule([]);
    fireEvent.click(screen.getByRole("button", { name: "Weekly" }));
    // No date yet: no weekday to name.
    expect(screen.getByLabelText("Every week, until I stop it")).toBeChecked();
    fireEvent.click(screen.getByLabelText("For the next"));
    const weeks = screen.getByLabelText("Number of weeks");
    fireEvent.change(weeks, { target: { value: "99" } });
    expect(weeks).toHaveValue(26);
    fireEvent.change(weeks, { target: { value: "" } });
    expect(weeks).toHaveValue(1);
    expect(screen.getByText("weeks (1 shift in total)")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Publish 1 weekly shift" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Weekly" }));
    expect(screen.getByRole("button", { name: "Publish shift" })).toBeVisible();
  });

  it("warns about skipped weeks and shows errors", async () => {
    mocks.createRepeatingShiftAction
      .mockResolvedValueOnce({
        success: true,
        data: [{ shift_start: "2026-01-07T09:00:00.000Z" }],
        skipped: [
          { shiftStart: "2026-01-14T09:00:00.000Z", reason: "Time off" },
        ],
      })
      .mockResolvedValueOnce({ success: false, error: "Nope" });
    renderSchedule([]);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Weekly" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Publish repeating shift" }),
    );
    await waitFor(() =>
      expect(mocks.toast.warning).toHaveBeenCalledWith(
        "Repeats every Wednesday. Scheduled through Jan 7; new weeks are added automatically. Skipped Jan 14: Time off.",
      ),
    );

    fillForm();
    fireEvent.click(
      screen.getByRole("button", { name: "Publish repeating shift" }),
    );
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith("Nope"));
  });

  it("warns about skipped weeks and errors for a set number of weeks", async () => {
    mocks.createWeeklyScheduledShiftsAction
      .mockResolvedValueOnce({
        success: true,
        data: [{}],
        skipped: [
          { shiftStart: "2026-01-14T09:00:00.000Z", reason: "Time off" },
        ],
      })
      .mockResolvedValueOnce({ success: false, error: "Nope" });
    renderSchedule([]);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Weekly" }));
    fireEvent.click(screen.getByLabelText("For the next"));
    fireEvent.click(
      screen.getByRole("button", { name: "Publish 4 weekly shifts" }),
    );
    await waitFor(() =>
      expect(mocks.toast.warning).toHaveBeenCalledWith(
        "1 weekly shift published. Skipped Jan 14: Time off.",
      ),
    );

    fillForm();
    fireEvent.click(
      screen.getByRole("button", { name: "Publish 4 weekly shifts" }),
    );
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith("Nope"));

    // Back to repeating until stopped.
    fireEvent.click(screen.getByLabelText("Every Wednesday, until I stop it"));
    expect(screen.getByLabelText("Number of weeks")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Publish repeating shift" }),
    ).toBeVisible();
  });

  it("makes a published shift repeat until stopped", async () => {
    mocks.repeatShiftWeeklyAction.mockResolvedValue({
      success: true,
      data: [{ shift_start: "2026-02-09T09:00:00.000Z" }],
      skipped: [],
    });
    const s = shift("scheduled", { user_id: "user_2" });
    renderSchedule([s]);
    fireEvent.click(repeatButton());
    expect(repeatButton()).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByLabelText("Every Monday, until I stop it"),
    ).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Repeat weekly" }));

    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith(
        "Repeats every Monday. Scheduled through Feb 9; new weeks are added automatically.",
      ),
    );
    expect(mocks.repeatShiftWeeklyAction).toHaveBeenCalledWith(
      s.id,
      expect.any(String),
    );
    expect(mocks.createWeeklyScheduledShiftsAction).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Repeat weekly" })).toBeNull();
  });

  it("repeats a published shift for a set number of weeks", async () => {
    mocks.createWeeklyScheduledShiftsAction.mockResolvedValue({
      success: true,
      data: [{}, {}],
      skipped: [],
    });
    const s = shift("scheduled", {
      user_id: "user_2",
      note: "Desk",
      site_id: 7,
      location: "Warehouse",
    });
    renderSchedule([s], true, true, [], sites);
    fireEvent.click(repeatButton());
    fireEvent.click(screen.getByLabelText("For the next"));
    const weeks = screen.getByLabelText("Number of weeks");
    expect(weeks).toHaveValue(4);
    expect(screen.getByText(/through Mon, Feb 2/)).toBeVisible();
    fireEvent.change(weeks, { target: { value: "2" } });
    expect(screen.getByText("weeks (2 more shifts)")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Repeat weekly" }));

    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith(
        "2 weekly shifts published",
      ),
    );
    const [memberId, occurrences, note, , location] =
      mocks.createWeeklyScheduledShiftsAction.mock.calls[0];
    expect(memberId).toBe("user_2");
    expect(
      occurrences.map((w: { shiftStart: string }) => w.shiftStart),
    ).toEqual(["2026-01-12T09:00:00.000Z", "2026-01-19T09:00:00.000Z"]);
    expect(note).toBe("Desk");
    expect(location).toEqual({ siteId: 7 });
    expect(mocks.repeatShiftWeeklyAction).not.toHaveBeenCalled();
  });

  it("marks repeating shifts and stops them after a chosen week", async () => {
    mocks.stopRepeatingShiftAction
      .mockResolvedValueOnce({ success: false, error: "Nope" })
      .mockResolvedValueOnce({ success: true, removed: 3 });
    const s = shift("scheduled", { series_id: 4 });
    renderSchedule([s]);
    expect(screen.getByText("Repeats weekly")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Repeating…" }));
    expect(screen.getByText(/This shift repeats every Monday/)).toBeVisible();
    expect(screen.queryByLabelText("For the next")).toBeNull();

    const stop = screen.getByRole("button", {
      name: "Stop repeating after this shift",
    });
    fireEvent.click(stop);
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith("Nope"));
    fireEvent.click(stop);
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith(
        "Stopped repeating. Removed 3 later shifts.",
      ),
    );
    expect(mocks.stopRepeatingShiftAction).toHaveBeenCalledWith(s.id);
    expect(
      screen.queryByRole("button", { name: "Stop repeating after this shift" }),
    ).toBeNull();
  });

  it("words a repeat that made no new weeks yet, and a single extra week", async () => {
    mocks.repeatShiftWeeklyAction.mockResolvedValue({
      success: true,
      data: [],
      skipped: [],
    });
    renderSchedule([shift("scheduled")]);
    fireEvent.click(repeatButton());
    fireEvent.click(screen.getByLabelText("For the next"));
    fireEvent.change(screen.getByLabelText("Number of weeks"), {
      target: { value: "1" },
    });
    expect(screen.getByText("weeks (1 more shift)")).toBeVisible();
    fireEvent.click(screen.getByLabelText("Every Monday, until I stop it"));
    fireEvent.click(screen.getByRole("button", { name: "Repeat weekly" }));
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith(
        "Repeats every Monday. New weeks are added automatically.",
      ),
    );
  });

  it("keeps the repeat form open when a set number of weeks fails", async () => {
    mocks.createWeeklyScheduledShiftsAction.mockResolvedValue({
      success: false,
      error: "Nope",
    });
    renderSchedule([shift("scheduled")]);
    fireEvent.click(repeatButton());
    fireEvent.click(screen.getByLabelText("For the next"));
    fireEvent.click(screen.getByRole("button", { name: "Repeat weekly" }));
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith("Nope"));
    expect(mocks.toast.success).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Repeat weekly" })).toBeVisible();
  });

  it("words stopping with one or no later weeks, and shows progress", async () => {
    mocks.stopRepeatingShiftAction
      .mockResolvedValueOnce({ success: true, removed: 1 })
      .mockResolvedValueOnce({ success: true, removed: 0 })
      .mockReturnValueOnce(new Promise(() => {}));
    renderSchedule([shift("scheduled", { series_id: 4 })]);
    const open = () =>
      fireEvent.click(screen.getByRole("button", { name: "Repeating…" }));
    const stop = () =>
      fireEvent.click(
        screen.getByRole("button", { name: "Stop repeating after this shift" }),
      );
    open();
    stop();
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith(
        "Stopped repeating. Removed 1 later shift.",
      ),
    );
    open();
    stop();
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith("Stopped repeating"),
    );
    open();
    stop();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Stop repeating after this shift" }),
      ).toBeDisabled(),
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("keeps the repeat form open on errors, and swaps with the edit form", async () => {
    mocks.repeatShiftWeeklyAction.mockResolvedValue({
      success: false,
      error: "Nope",
    });
    renderSchedule([shift("scheduled")]);
    fireEvent.click(repeatButton());
    fireEvent.click(screen.getByRole("button", { name: "Repeat weekly" }));
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith("Nope"));
    expect(screen.getByRole("button", { name: "Repeat weekly" })).toBeVisible();

    // Editing closes the repeat form, and repeating closes the edit form.
    fireEvent.click(screen.getByLabelText("Edit shift"));
    expect(screen.queryByRole("button", { name: "Repeat weekly" })).toBeNull();
    fireEvent.click(repeatButton());
    expect(screen.queryByRole("button", { name: "Save shift" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: "Repeat weekly" })).toBeNull();
  });

  it("disables the repeat form while it publishes", async () => {
    mocks.repeatShiftWeeklyAction.mockReturnValue(new Promise(() => {}));
    renderSchedule([shift("scheduled")]);
    fireEvent.click(repeatButton());
    fireEvent.click(screen.getByRole("button", { name: "Repeat weekly" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Repeat weekly" }),
      ).toBeDisabled(),
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("only offers to repeat shifts still to come", () => {
    renderSchedule([shift("no_show")]);
    expect(screen.queryByRole("button", { name: "Repeat…" })).toBeNull();
  });
});

describe("availability warnings", () => {
  // 2026-01-05 is a Monday; tests run in UTC.
  const window = (
    over: Partial<AvailabilityWindow> = {},
  ): AvailabilityWindow => ({
    id: 1,
    org_id: "org_1",
    user_id: "user_1",
    kind: "unavailable",
    weekday: 1,
    start_minute: 8 * 60,
    end_minute: 12 * 60,
    timezone: "UTC",
    note: "Class",
    created_at: "2026-01-01T00:00:00Z",
    ...over,
  });

  function renderWith(
    shifts: ScheduledShiftWithStatus[],
    availability: AvailabilityWindow[],
    isAdmin = true,
  ) {
    renderWithClient(
      <Schedule
        availabilityPromise={resolved(availability)}
        isAdmin={isAdmin}
        membersPromise={resolved(members)}
        schedulePromise={resolved({ ok: true as const, value: shifts })}
        timeOffPromise={resolved({ ok: true as const, value: [] })}
      />,
    );
  }

  it("warns, without blocking, when a new shift clashes", async () => {
    renderWith(
      [],
      [window(), window({ id: 2, user_id: "user_2", kind: "available" })],
    );
    fireEvent.change(await screen.findByLabelText("Member"), {
      target: { value: "user_1" },
    });
    fireEvent.change(screen.getByLabelText("Date"), {
      target: { value: "2026-01-05" },
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Sam is unavailable Mondays, 8:00 AM – 12:00 PM (Class). You can still publish it.",
    );
    expect(screen.getByRole("button", { name: "Publish shift" })).toBeEnabled();

    // Alex has only said they're free on Mondays 8–12, so 9–5 is outside it.
    fireEvent.change(screen.getByLabelText("Member"), {
      target: { value: "user_2" },
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "This shift is outside the times Alex said they're available.",
    );

    // A day with nothing set for Sam is fine.
    fireEvent.change(screen.getByLabelText("Member"), {
      target: { value: "user_1" },
    });
    fireEvent.change(screen.getByLabelText("Date"), {
      target: { value: "2026-01-06" },
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("names an unknown member generically", async () => {
    renderWithClient(
      <Schedule
        availabilityPromise={resolved([window({ user_id: "ghost" })])}
        isAdmin
        membersPromise={resolved([{ id: "ghost", name: "" }])}
        schedulePromise={resolved({ ok: true as const, value: [] })}
      />,
    );
    fireEvent.change(await screen.findByLabelText("Member"), {
      target: { value: "ghost" },
    });
    fireEvent.change(screen.getByLabelText("Date"), {
      target: { value: "2026-01-05" },
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "This member is unavailable Mondays",
    );
  });

  it("flags upcoming shifts that clash and warns while editing", async () => {
    renderWith(
      [
        shift("scheduled"),
        shift("scheduled", {
          user_id: "user_2",
          shift_start: new Date("2026-01-05T13:00:00Z"),
          shift_end: new Date("2026-01-05T17:00:00Z"),
        }),
        shift("scheduled", {
          user_id: "user_2",
          shift_start: new Date("2026-01-06T13:00:00Z"),
          shift_end: new Date("2026-01-06T17:00:00Z"),
        }),
        shift("no_show"),
      ],
      [
        window(),
        window({
          id: 2,
          user_id: "user_2",
          kind: "available",
          start_minute: 0,
          end_minute: 1440,
        }),
      ],
    );
    const badge = await screen.findByText("Unavailable");
    expect(badge).toHaveAttribute(
      "title",
      "Sam is unavailable Mondays, 8:00 AM – 12:00 PM (Class).",
    );
    // The past no-show isn't flagged; Alex is free all Monday, not Tuesday.
    expect(screen.getAllByText("Unavailable")).toHaveLength(1);
    expect(screen.getAllByText("Outside availability")).toHaveLength(1);

    fireEvent.click(screen.getAllByLabelText("Edit shift")[0]);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Sam is unavailable Mondays",
    );
    const editStart = document.querySelector(
      '[id^="editShift"][id$="Start"]',
    ) as HTMLInputElement;
    fireEvent.change(editStart, { target: { value: "13:00" } });
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.change(editStart, { target: { value: "" } });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows members no availability badges", async () => {
    renderWith([shift("scheduled")], [window()], false);
    expect(await screen.findByText("My schedule")).toBeVisible();
    expect(screen.queryByText("Unavailable")).toBeNull();
  });
});
