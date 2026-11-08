import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TradeableShift } from "@/lib/shift-requests-dal";
import { renderWithClient } from "../utils";

const mocks = vi.hoisted(() => ({
  createShiftRequestAction: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/shift-request-actions", () => ({
  createShiftRequestAction: mocks.createShiftRequestAction,
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import NewShiftRequestForm from "@/components/NewShiftRequestForm";

const shift = (id: number, user_id: string, day: number): TradeableShift => ({
  id,
  user_id,
  shift_start: new Date(2030, 0, day, 9, 0),
  shift_end: new Date(2030, 0, day, 17, 0),
});

const names = { amy: "Amy", ben: "Ben", cat: "Cat" };
const shifts = [shift(1, "amy", 5), shift(2, "ben", 6), shift(3, "cat", 7)];

function show(props: Partial<{ shifts: TradeableShift[]; userId: string }>) {
  renderWithClient(
    <NewShiftRequestForm
      names={names}
      shifts={props.shifts ?? shifts}
      userId={props.userId ?? "amy"}
    />,
  );
}

const choose = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

const submit = (name: RegExp) =>
  fireEvent.click(screen.getByRole("button", { name }));

const optionTexts = (label: string | RegExp) =>
  Array.from(
    (screen.getByLabelText(label) as HTMLSelectElement).options,
    (o) => o.textContent,
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe("NewShiftRequestForm", () => {
  it("offers your own shift to anyone, with a note", async () => {
    mocks.createShiftRequestAction.mockResolvedValueOnce({ success: true });
    show({});
    expect(optionTexts("Your shift")).toEqual([
      "Choose a shift…",
      "Sat, Jan 5, 9:00 AM – 5:00 PM",
    ]);
    // Coworkers only, sorted, after "Anyone".
    expect(optionTexts("Offer to")).toEqual(["Anyone", "Ben", "Cat"]);
    const post = screen.getByRole("button", { name: /Post shift/ });
    expect(post).toBeDisabled();
    choose("Your shift", "1");
    choose(/Note/, "Family event");
    expect(post).toBeEnabled();
    submit(/Post shift/);
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith("Shift posted"),
    );
    expect(mocks.createShiftRequestAction).toHaveBeenCalledWith(
      {
        type: "offer",
        shiftId: 1,
        swapShiftId: null,
        targetUserId: null,
        note: "Family event",
      },
      expect.any(String),
    );
    // The form clears for the next request.
    expect(screen.getByLabelText("Your shift")).toHaveValue("");
    expect(screen.getByLabelText(/Note/)).toHaveValue("");
  });

  it("offers a shift to one coworker", async () => {
    mocks.createShiftRequestAction.mockResolvedValueOnce({ success: true });
    show({});
    choose("Your shift", "1");
    choose("Offer to", "cat");
    submit(/Post shift/);
    await waitFor(() =>
      expect(mocks.createShiftRequestAction).toHaveBeenCalledWith(
        expect.objectContaining({ targetUserId: "cat", note: null }),
        expect.any(String),
      ),
    );
  });

  it("swaps your shift for a coworker's", async () => {
    mocks.createShiftRequestAction.mockResolvedValueOnce({ success: true });
    show({});
    choose(/What do you want to do/, "swap");
    expect(screen.queryByLabelText("Offer to")).toBeNull();
    expect(optionTexts(/in return/)).toEqual([
      "Choose a shift…",
      "Ben: Sun, Jan 6, 9:00 AM – 5:00 PM",
      "Cat: Mon, Jan 7, 9:00 AM – 5:00 PM",
    ]);
    choose("Your shift", "1");
    const send = screen.getByRole("button", { name: /Send request/ });
    expect(send).toBeDisabled(); // still needs the shift to take in return
    choose(/in return/, "3");
    submit(/Send request/);
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith(
        "Request sent: your coworker needs to accept",
      ),
    );
    expect(mocks.createShiftRequestAction).toHaveBeenCalledWith(
      {
        type: "swap",
        shiftId: 1,
        swapShiftId: 3,
        targetUserId: null,
        note: null,
      },
      expect.any(String),
    );
  });

  it("asks to take a coworker's shift", async () => {
    mocks.createShiftRequestAction.mockResolvedValueOnce({ success: true });
    show({});
    choose("Your shift", "1");
    choose(/What do you want to do/, "pickup");
    // Switching type clears the pick, and lists coworkers' shifts instead.
    expect(screen.getByLabelText("Coworker's shift")).toHaveValue("");
    expect(optionTexts("Coworker's shift")).toEqual([
      "Choose a shift…",
      "Ben: Sun, Jan 6, 9:00 AM – 5:00 PM",
      "Cat: Mon, Jan 7, 9:00 AM – 5:00 PM",
    ]);
    choose("Coworker's shift", "2");
    submit(/Send request/);
    await waitFor(() =>
      expect(mocks.createShiftRequestAction).toHaveBeenCalledWith(
        {
          type: "pickup",
          shiftId: 2,
          swapShiftId: null,
          targetUserId: null,
          note: null,
        },
        expect.any(String),
      ),
    );
  });

  it("shows the server's refusal and keeps the form filled", async () => {
    mocks.createShiftRequestAction.mockResolvedValueOnce({
      success: false,
      error: "Ben is already scheduled then.",
    });
    show({});
    choose("Your shift", "1");
    submit(/Post shift/);
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(
        "Ben is already scheduled then.",
      ),
    );
    expect(screen.getByLabelText("Your shift")).toHaveValue("1");
  });

  it("disables the button while the request is sending", async () => {
    mocks.createShiftRequestAction.mockReturnValueOnce(new Promise(() => {}));
    show({});
    choose("Your shift", "1");
    submit(/Post shift/);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Post shift/ })).toBeDisabled(),
    );
    expect(mocks.createShiftRequestAction).toHaveBeenCalledTimes(1);
  });

  it("says when you have no shifts to give up", () => {
    show({ shifts: [shift(2, "ben", 6)] });
    expect(screen.getByLabelText("Your shift")).toBeDisabled();
    expect(optionTexts("Your shift")).toEqual([
      "You have no upcoming shifts to trade",
    ]);
  });

  it("says when coworkers have no shifts to take", () => {
    show({ shifts: [shift(1, "amy", 5)] });
    choose(/What do you want to do/, "swap");
    expect(screen.getByLabelText(/in return/)).toBeDisabled();
    expect(optionTexts(/in return/)).toEqual(["No coworker shifts available"]);
    choose(/What do you want to do/, "pickup");
    expect(screen.getByLabelText("Coworker's shift")).toBeDisabled();
    expect(optionTexts("Coworker's shift")).toEqual([
      "No coworker shifts available",
    ]);
  });

  it("names an unknown coworker generically", () => {
    show({ shifts: [shift(9, "zed", 6)] });
    choose(/What do you want to do/, "pickup");
    expect(optionTexts("Coworker's shift")).toContain(
      "A team member: Sun, Jan 6, 9:00 AM – 5:00 PM",
    );
  });
});
