import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AvailabilityWindow } from "@/lib/types";
import { renderWithClient, resolved } from "../utils";

const mocks = vi.hoisted(() => ({
  addAvailabilityAction: vi.fn(),
  deleteAvailabilityAction: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/availability-actions", () => ({
  addAvailabilityAction: mocks.addAvailabilityAction,
  deleteAvailabilityAction: mocks.deleteAvailabilityAction,
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import Availability from "@/components/Availability";

let nextId = 1;
const win = (over: Partial<AvailabilityWindow> = {}): AvailabilityWindow => ({
  id: nextId++,
  org_id: "o1",
  user_id: "amy",
  kind: "unavailable",
  weekday: 1,
  start_minute: 540,
  end_minute: 1020,
  timezone: "UTC",
  note: null,
  created_at: "2026-11-01T00:00:00Z",
  ...over,
});

function renderCard(
  windows: AvailabilityWindow[],
  isAdmin = false,
  members?: { id: string; name: string }[],
) {
  renderWithClient(
    <Availability
      membersPromise={members ? resolved(members) : undefined}
      viewPromise={resolved({
        ok: true as const,
        value: { windows, userId: "amy", isAdmin },
      })}
    />,
  );
}

beforeEach(() => {
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
    timeZone: "UTC",
  } as Intl.ResolvedDateTimeFormatOptions);
});

describe("Availability", () => {
  it("shows an error when it can't be read", () => {
    renderWithClient(
      <Availability
        viewPromise={resolved({
          ok: false as const,
          error: { reason: "down" },
        })}
      />,
    );
    expect(screen.getByText("Error fetching availability: down")).toBeVisible();
  });

  it("explains an empty list to a member", () => {
    renderCard([]);
    expect(
      screen.getByText("No availability set. You can be scheduled any time."),
    ).toBeVisible();
    expect(screen.queryByText("Team availability")).toBeNull();
  });

  it("lists the member's windows with zone and note", () => {
    renderCard([
      win({ weekday: 3, kind: "available", note: "Mornings" }),
      win({ weekday: 1, timezone: "America/Toronto" }),
    ]);
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent(
      "UnavailableMonday9:00 AM – 5:00 PM(America/Toronto)",
    );
    expect(items[1]).toHaveTextContent("AvailableWednesday");
    expect(items[1]).toHaveTextContent("Mornings");
  });

  it("saves new availability for the chosen days", async () => {
    mocks.addAvailabilityAction.mockResolvedValue({ success: true });
    renderCard([]);
    const save = screen.getByRole("button", { name: "Save availability" });
    expect(save).toBeDisabled();

    fireEvent.click(screen.getByLabelText("Available"));
    fireEvent.click(screen.getByRole("button", { name: "Monday" }));
    fireEvent.click(screen.getByRole("button", { name: "Friday" }));
    fireEvent.click(screen.getByRole("button", { name: "Sunday" }));
    fireEvent.click(screen.getByRole("button", { name: "Sunday" }));
    expect(screen.getByRole("button", { name: "Monday" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "18:00" },
    });
    fireEvent.change(screen.getByLabelText("Until"), {
      target: { value: "00:00" },
    });
    fireEvent.change(screen.getByLabelText("Note (optional)"), {
      target: { value: "Evenings" },
    });
    fireEvent.click(save);

    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith("Availability saved"),
    );
    expect(mocks.addAvailabilityAction).toHaveBeenCalledWith({
      kind: "available",
      weekdays: [1, 5],
      startMinute: 1080,
      endMinute: 1440,
      timezone: "UTC",
      note: "Evenings",
    });
    expect(screen.getByLabelText("Note (optional)")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Monday" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("saves an all-day window and reports a refusal", async () => {
    mocks.addAvailabilityAction.mockResolvedValue({
      success: false,
      error: "Too many",
    });
    renderCard([]);
    fireEvent.click(screen.getByRole("button", { name: "Saturday" }));
    fireEvent.click(screen.getByLabelText("All day"));
    expect(screen.queryByLabelText("From")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save availability" }));
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("Too many"),
    );
    expect(mocks.addAvailabilityAction).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "unavailable",
        weekdays: [6],
        startMinute: 0,
        endMinute: 1440,
      }),
    );
  });

  it("won't save matching or missing times", () => {
    renderCard([]);
    fireEvent.click(screen.getByRole("button", { name: "Monday" }));
    fireEvent.change(screen.getByLabelText("Until"), {
      target: { value: "09:00" },
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Start and end can't be the same time.",
    );
    const save = screen.getByRole("button", { name: "Save availability" });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Until"), {
      target: { value: "" },
    });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Until"), {
      target: { value: "10:00" },
    });
    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "" },
    });
    expect(save).toBeDisabled();
  });

  it("shows a spinner while saving", async () => {
    mocks.addAvailabilityAction.mockReturnValue(new Promise(() => {}));
    renderCard([]);
    fireEvent.click(screen.getByRole("button", { name: "Monday" }));
    const save = screen.getByRole("button", { name: "Save availability" });
    fireEvent.click(save);
    await waitFor(() => expect(save).toBeDisabled());
    expect(save.querySelector(".animate-spin")).not.toBeNull();
  });

  it("removes a window", async () => {
    mocks.deleteAvailabilityAction.mockResolvedValueOnce({ success: true });
    mocks.deleteAvailabilityAction.mockResolvedValueOnce({
      success: false,
      error: "Not found",
    });
    const mine = win();
    renderCard([mine]);
    const remove = screen.getByRole("button", {
      name: "Remove Monday 9:00 AM – 5:00 PM",
    });
    fireEvent.click(remove);
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith("Availability removed"),
    );
    expect(mocks.deleteAvailabilityAction).toHaveBeenCalledWith(mine.id);
    fireEvent.click(remove);
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("Not found"),
    );
  });

  it("shows a spinner while removing", async () => {
    mocks.deleteAvailabilityAction.mockReturnValue(new Promise(() => {}));
    renderCard([win()]);
    const remove = screen.getByRole("button", { name: /Remove Monday/ });
    fireEvent.click(remove);
    await waitFor(() => expect(remove).toBeDisabled());
  });

  it("shows admins the team's availability by member", () => {
    renderCard(
      [
        win({ user_id: "bo", weekday: 2 }),
        win({ user_id: "bo", weekday: 4 }),
        win({ user_id: "cy" }),
        win({ user_id: "amy" }),
      ],
      true,
      [{ id: "bo", name: "Bo" }],
    );
    expect(screen.getByText("Team availability")).toBeVisible();
    const bo = screen.getByRole("region", { name: "Bo" });
    expect(within(bo).getAllByRole("listitem")).toHaveLength(2);
    expect(
      screen.getByRole("region", { name: "Unknown member" }),
    ).toBeVisible();
  });

  it("tells admins when no one else has set any", () => {
    renderCard([], true);
    expect(
      screen.getByText("No one else has set their availability yet."),
    ).toBeVisible();
  });
});
