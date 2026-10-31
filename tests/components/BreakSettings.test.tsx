import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BreakSettingsData } from "@/lib/types";
import { renderWithClient } from "../utils";

const mocks = vi.hoisted(() => ({
  updateBreakSettingAction: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/actions", () => ({
  updateBreakSettingAction: mocks.updateBreakSettingAction,
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import BreakSettings from "@/components/BreakSettings";

const saved: BreakSettingsData = {
  org_id: "org_1",
  dock_lunch: true,
  lunch_duration_minutes: 30,
  lunch_min_shift_hours: 5,
};

function renderBreakSettings(initialData: BreakSettingsData | null = null) {
  const onUpdateOptimistic = vi.fn();
  renderWithClient(
    <BreakSettings
      initialData={initialData}
      onUpdateOptimistic={onUpdateOptimistic}
    />,
  );
  return onUpdateOptimistic;
}

const noLimits = { unpaid_meal: null, unpaid_rest: null, paid_rest: null };

const option = (label: RegExp) => screen.getByRole("button", { name: label });
const save = () => screen.getByRole("button", { name: "Save Break Settings" });

describe("BreakSettings", () => {
  it("defaults to not docking breaks and allows saving when nothing is stored", () => {
    renderBreakSettings();
    expect(option(/Do Not Dock Breaks/).className).toContain("border-zinc-900");
    expect(screen.queryByText("Current")).not.toBeInTheDocument();
    expect(save()).toBeEnabled();
  });

  it("marks the stored option and disables saving until something changes", () => {
    renderBreakSettings(saved);
    expect(option(/Automatically Dock Lunch/)).toHaveTextContent("Current");
    expect(screen.getByLabelText("Break Duration (minutes)")).toHaveValue(30);
    expect(screen.getByLabelText("Minimum Shift Length (hours)")).toHaveValue(
      5,
    );
    expect(save()).toBeDisabled();
  });

  it.each([
    ["duration", "Break Duration (minutes)", "45"],
    ["minimum shift length", "Minimum Shift Length (hours)", "6"],
  ])("enables saving when the %s changes", (_l, label, value) => {
    renderBreakSettings(saved);
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    expect(save()).toBeEnabled();
  });

  it("falls back to 30 minutes when lunch_duration_minutes is 0", () => {
    renderBreakSettings({
      org_id: "org_1",
      dock_lunch: true,
      lunch_duration_minutes: 0,
      lunch_min_shift_hours: 5,
    });
    expect(screen.getByLabelText("Break Duration (minutes)")).toHaveValue(30);
  });

  it("hides duration and threshold inputs when docking is disabled", () => {
    renderBreakSettings(saved);
    fireEvent.click(option(/Do Not Dock Breaks/));
    expect(
      screen.queryByLabelText("Break Duration (minutes)"),
    ).not.toBeInTheDocument();
    expect(save()).toBeEnabled();
  });

  it("saves updated break settings and triggers optimistic update", async () => {
    mocks.updateBreakSettingAction.mockResolvedValue({ success: true });
    const onUpdateOptimistic = renderBreakSettings(saved);
    fireEvent.change(screen.getByLabelText("Break Duration (minutes)"), {
      target: { value: "45" },
    });
    fireEvent.change(screen.getByLabelText("Minimum Shift Length (hours)"), {
      target: { value: "6" },
    });
    fireEvent.click(save());

    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith(
        "Break settings updated",
      ),
    );
    expect(mocks.updateBreakSettingAction).toHaveBeenCalledWith(
      true,
      45,
      6,
      noLimits,
    );
    expect(onUpdateOptimistic).toHaveBeenCalledWith({
      ...saved,
      dock_lunch: true,
      lunch_duration_minutes: 45,
      lunch_min_shift_hours: 6,
      max_meal_break_minutes: null,
      max_unpaid_rest_break_minutes: null,
      max_paid_break_minutes: null,
    });
  });

  it("skips the optimistic update when nothing was stored", async () => {
    mocks.updateBreakSettingAction.mockResolvedValue({ success: true });
    const onUpdateOptimistic = renderBreakSettings(null);
    fireEvent.click(save());
    await waitFor(() =>
      expect(mocks.updateBreakSettingAction).toHaveBeenCalledWith(
        false,
        30,
        5,
        noLimits,
      ),
    );
    expect(onUpdateOptimistic).not.toHaveBeenCalled();
  });

  it.each([
    ["the server error", "Unauthorized", "Unauthorized"],
    ["a fallback message", "", "Update failed"],
  ])("shows %s when saving fails", async (_l, error, shown) => {
    mocks.updateBreakSettingAction.mockResolvedValue({
      success: false,
      error,
    });
    renderBreakSettings();
    fireEvent.click(save());
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(shown));
  });

  it("stays quiet for a failed result without an error field", async () => {
    mocks.updateBreakSettingAction.mockResolvedValue({ success: false });
    renderBreakSettings();
    fireEvent.click(save());
    await waitFor(() =>
      expect(mocks.updateBreakSettingAction).toHaveBeenCalled(),
    );
    expect(mocks.toast.error).not.toHaveBeenCalled();
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });

  it("disables saving while the update is in flight", async () => {
    mocks.updateBreakSettingAction.mockReturnValue(new Promise(() => {}));
    renderBreakSettings();
    fireEvent.click(save());
    await waitFor(() => expect(save()).toBeDisabled());
  });
});

describe("BreakSettings break limits", () => {
  const notDocked: BreakSettingsData = { ...saved, dock_lunch: false };

  it("starts with every limit off when none are stored", () => {
    renderBreakSettings(notDocked);
    for (const label of [
      /Limit meal periods/,
      /Limit unpaid rest breaks/,
      /Limit paid rest breaks/,
    ]) {
      expect(screen.getByLabelText(label)).not.toBeChecked();
    }
    expect(
      screen.queryByLabelText("Max Paid rest break (minutes)"),
    ).not.toBeInTheDocument();
  });

  it("pre-fills the stored limits", () => {
    renderBreakSettings({
      ...notDocked,
      max_meal_break_minutes: 45,
      max_unpaid_rest_break_minutes: 10,
      max_paid_break_minutes: 20,
    });
    expect(screen.getByLabelText("Max Meal period (minutes)")).toHaveValue(45);
    expect(
      screen.getByLabelText("Max Unpaid rest break (minutes)"),
    ).toHaveValue(10);
    expect(screen.getByLabelText("Max Paid rest break (minutes)")).toHaveValue(
      20,
    );
    expect(save()).toBeDisabled();
  });

  it("saves the limits that were switched on", async () => {
    mocks.updateBreakSettingAction.mockResolvedValue({ success: true });
    const onUpdateOptimistic = renderBreakSettings(notDocked);
    fireEvent.click(screen.getByLabelText(/Limit paid rest breaks/));
    expect(save()).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Max Paid rest break (minutes)"), {
      target: { value: "20" },
    });
    fireEvent.click(screen.getByLabelText(/Limit meal periods/));
    fireEvent.click(screen.getByLabelText(/Limit unpaid rest breaks/));
    fireEvent.change(screen.getByLabelText("Max Unpaid rest break (minutes)"), {
      target: { value: "5" },
    });
    fireEvent.click(save());

    await waitFor(() =>
      expect(mocks.updateBreakSettingAction).toHaveBeenCalledWith(
        false,
        30,
        5,
        { unpaid_meal: 30, unpaid_rest: 5, paid_rest: 20 },
      ),
    );
    expect(onUpdateOptimistic).toHaveBeenCalledWith(
      expect.objectContaining({
        max_meal_break_minutes: 30,
        max_unpaid_rest_break_minutes: 5,
        max_paid_break_minutes: 20,
      }),
    );
  });

  it("clears a limit that was switched off", async () => {
    mocks.updateBreakSettingAction.mockResolvedValue({ success: true });
    renderBreakSettings({ ...notDocked, max_paid_break_minutes: 15 });
    fireEvent.click(screen.getByLabelText(/Limit paid rest breaks/));
    fireEvent.click(save());
    await waitFor(() =>
      expect(mocks.updateBreakSettingAction).toHaveBeenCalledWith(
        false,
        30,
        5,
        noLimits,
      ),
    );
  });

  it.each([
    ["zero", "0"],
    ["too long", "481"],
    ["fractional", "7.5"],
  ])("blocks saving a %s limit", (_l, value) => {
    renderBreakSettings(notDocked);
    fireEvent.click(screen.getByLabelText(/Limit paid rest breaks/));
    fireEvent.change(screen.getByLabelText("Max Paid rest break (minutes)"), {
      target: { value },
    });
    expect(
      screen.getByText(/Enter a whole number of minutes between 1 and 480/),
    ).toBeInTheDocument();
    expect(save()).toBeDisabled();
  });

  it("limits meal periods to the lunch deduction while docking", async () => {
    mocks.updateBreakSettingAction.mockResolvedValue({ success: true });
    renderBreakSettings({ ...saved, max_meal_break_minutes: 60 });
    expect(screen.getByTestId("meal-limit-from-deduction")).toHaveTextContent(
      "Meal periods are limited to the 30-minute lunch deduction above.",
    );
    expect(
      screen.queryByLabelText(/Limit meal periods/),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Break Duration (minutes)"), {
      target: { value: "45" },
    });
    expect(screen.getByTestId("meal-limit-from-deduction")).toHaveTextContent(
      "45-minute",
    );
    fireEvent.click(save());
    // The hidden manual meal limit is kept as stored.
    await waitFor(() =>
      expect(mocks.updateBreakSettingAction).toHaveBeenCalledWith(true, 45, 5, {
        unpaid_meal: 60,
        unpaid_rest: null,
        paid_rest: null,
      }),
    );
  });
});
