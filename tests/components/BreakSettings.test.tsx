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
    expect(screen.getByLabelText("Minimum Shift Length (hours)")).toHaveValue(5);
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
    expect(mocks.updateBreakSettingAction).toHaveBeenCalledWith(true, 45, 6);
    expect(onUpdateOptimistic).toHaveBeenCalledWith({
      ...saved,
      dock_lunch: true,
      lunch_duration_minutes: 45,
      lunch_min_shift_hours: 6,
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
