import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { OvertimeSettingsData } from "@/lib/types";
import { renderWithClient } from "../utils";

const mocks = vi.hoisted(() => ({
  updateOvertimeSettingsAction: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/actions", () => ({
  updateOvertimeSettingsAction: mocks.updateOvertimeSettingsAction,
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import OvertimeSettings from "@/components/OvertimeSettings";

const saved: OvertimeSettingsData = {
  org_id: "org_1",
  daily_threshold_hours: 8,
  weekly_threshold_hours: null,
};

function renderOvertimeSettings(
  initialData: OvertimeSettingsData | null = null,
) {
  const onUpdateOptimistic = vi.fn();
  renderWithClient(
    <OvertimeSettings
      initialData={initialData}
      onUpdateOptimistic={onUpdateOptimistic}
    />,
  );
  return onUpdateOptimistic;
}

const save = () =>
  screen.getByRole("button", { name: "Save Overtime Settings" });
const dailyToggle = () => screen.getByLabelText(/Daily overtime/);
const weeklyToggle = () => screen.getByLabelText(/Weekly overtime/);

describe("OvertimeSettings", () => {
  it("starts with both thresholds off and nothing to save", () => {
    renderOvertimeSettings();
    expect(dailyToggle()).not.toBeChecked();
    expect(weeklyToggle()).not.toBeChecked();
    expect(screen.queryByLabelText("Hours per day")).not.toBeInTheDocument();
    expect(save()).toBeDisabled();
  });

  it("offers 8h/day and 40h/week as starting values", () => {
    renderOvertimeSettings();
    fireEvent.click(dailyToggle());
    fireEvent.click(weeklyToggle());
    expect(screen.getByLabelText("Hours per day")).toHaveValue(8);
    expect(screen.getByLabelText("Hours per week")).toHaveValue(40);
    expect(save()).toBeEnabled();
  });

  it("shows the stored thresholds and saves only after a change", async () => {
    mocks.updateOvertimeSettingsAction.mockResolvedValue({
      success: true,
      data: saved,
    });
    const onUpdateOptimistic = renderOvertimeSettings(saved);
    expect(dailyToggle()).toBeChecked();
    expect(screen.getByLabelText("Hours per day")).toHaveValue(8);
    expect(weeklyToggle()).not.toBeChecked();
    expect(save()).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Hours per day"), {
      target: { value: "7.5" },
    });
    fireEvent.click(weeklyToggle());
    fireEvent.change(screen.getByLabelText("Hours per week"), {
      target: { value: "44" },
    });
    fireEvent.click(save());

    await waitFor(() =>
      expect(mocks.updateOvertimeSettingsAction).toHaveBeenCalledWith(7.5, 44),
    );
    expect(onUpdateOptimistic).toHaveBeenCalledWith({
      daily_threshold_hours: 7.5,
      weekly_threshold_hours: 44,
    });
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith(
        "Overtime settings updated",
      ),
    );
  });

  it("turns a threshold off by unchecking it", async () => {
    mocks.updateOvertimeSettingsAction.mockResolvedValue({ success: true });
    renderOvertimeSettings(saved);
    fireEvent.click(dailyToggle());
    expect(screen.queryByLabelText("Hours per day")).not.toBeInTheDocument();
    fireEvent.click(save());
    await waitFor(() =>
      expect(mocks.updateOvertimeSettingsAction).toHaveBeenCalledWith(
        null,
        null,
      ),
    );
  });

  it("skips the optimistic update when nothing is stored yet", async () => {
    mocks.updateOvertimeSettingsAction.mockResolvedValue({ success: true });
    const onUpdateOptimistic = renderOvertimeSettings();
    fireEvent.click(weeklyToggle());
    fireEvent.click(save());
    await waitFor(() =>
      expect(mocks.updateOvertimeSettingsAction).toHaveBeenCalledWith(null, 40),
    );
    expect(onUpdateOptimistic).not.toHaveBeenCalled();
  });

  it.each([
    ["zero", "Hours per day", "0", "24"],
    ["over the max", "Hours per week", "200", "168"],
  ])("blocks saving a %s threshold", (_label, input, value, max) => {
    renderOvertimeSettings();
    fireEvent.click(dailyToggle());
    fireEvent.click(weeklyToggle());
    fireEvent.change(screen.getByLabelText(input), { target: { value } });
    expect(
      screen.getByText(
        `Enter a number of hours greater than 0 and at most ${max}.`,
      ),
    ).toBeInTheDocument();
    expect(save()).toBeDisabled();
  });

  it.each([
    [
      "the server's reason",
      { success: false, error: "Unauthorized" },
      "Unauthorized",
    ],
    ["a generic message", { success: false }, "Update failed"],
  ])("shows %s when saving fails", async (_label, response, message) => {
    mocks.updateOvertimeSettingsAction.mockResolvedValue(response);
    renderOvertimeSettings(saved);
    fireEvent.click(weeklyToggle());
    fireEvent.click(save());
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(message),
    );
  });

  it("disables saving while the save is in flight", async () => {
    mocks.updateOvertimeSettingsAction.mockReturnValue(new Promise(() => {}));
    renderOvertimeSettings(saved);
    fireEvent.click(weeklyToggle());
    fireEvent.click(save());
    await waitFor(() => expect(save()).toBeDisabled());
    expect(save().querySelector(".animate-spin")).not.toBeNull();
  });
});
