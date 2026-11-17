import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithClient, resolved } from "../utils";

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  disconnect: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/google-calendar-actions", () => ({
  addShiftsToGoogleCalendarAction: mocks.add,
  disconnectGoogleCalendarAction: mocks.disconnect,
}));
vi.mock("@/lib/calendar-feed-actions", () => ({
  resetCalendarFeedAction: vi.fn(),
}));
vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({ user: { id: "me", externalAccounts: [] } }),
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import ScheduleCalendar from "@/components/ScheduleCalendar";

const upcoming = [
  { id: 1, user_id: "me" },
  { id: 2, user_id: "someone_else" },
  { id: 3, user_id: "me" },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ScheduleCalendar", () => {
  it("adds only the viewer's own upcoming shifts", async () => {
    mocks.add.mockResolvedValue({ status: "ok", added: 2, updated: 0 });
    renderWithClient(<ScheduleCalendar upcoming={upcoming} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Add 2 shifts to Google Calendar" }),
    );
    await waitFor(() => expect(mocks.add).toHaveBeenCalledWith([1, 3]));
  });

  it("says when there is nothing to add", () => {
    renderWithClient(<ScheduleCalendar upcoming={[]} />);
    expect(
      screen.getByRole("button", { name: "No upcoming shifts to add" }),
    ).toBeDisabled();
  });

  it("hides disconnect until Google Calendar is connected", async () => {
    renderWithClient(
      <ScheduleCalendar
        googleConnectedPromise={resolved(false)}
        upcoming={upcoming}
      />,
    );
    await screen.findByRole("button", { name: /Google Calendar/ });
    expect(
      screen.queryByRole("button", { name: "Disconnect Google Calendar" }),
    ).toBeNull();
  });

  it("disconnects after confirming", async () => {
    mocks.disconnect.mockResolvedValue({ status: "ok", removed: 2 });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithClient(
      <ScheduleCalendar
        googleConnectedPromise={resolved(true)}
        upcoming={upcoming}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Disconnect Google Calendar" }),
    );
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith(
        "Google Calendar disconnected, 2 shifts removed",
      ),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Disconnect Google Calendar" }),
      ).toBeNull(),
    );
    confirm.mockRestore();
  });

  it("does nothing when the confirm is cancelled", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderWithClient(
      <ScheduleCalendar
        googleConnectedPromise={resolved(true)}
        upcoming={upcoming}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Disconnect Google Calendar" }),
    );
    expect(mocks.disconnect).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("shows an error from the disconnect", async () => {
    mocks.disconnect.mockResolvedValue({ status: "error", error: "Nope" });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithClient(
      <ScheduleCalendar
        googleConnectedPromise={resolved(true)}
        upcoming={upcoming}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Disconnect Google Calendar" }),
    );
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith("Nope"));
    confirm.mockRestore();
  });
});
