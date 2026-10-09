import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReportingSettingsData } from "@/lib/types";
import { renderWithClient } from "../utils";

const mocks = vi.hoisted(() => ({
  updateOrgSettingAction: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/actions", () => ({
  updateOrgSettingAction: mocks.updateOrgSettingAction,
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import ReportingSettings from "@/components/ReportingSettings";

const saved: ReportingSettingsData = {
  org_id: "org_1",
  report_frequency: "custom",
  report_day: "Wednesday",
  report_interval: 2,
};

function renderSettings(initialData: ReportingSettingsData | null = null) {
  const onUpdateOptimistic = vi.fn();
  renderWithClient(
    <ReportingSettings
      hasReporting
      initialData={initialData}
      onUpdateOptimistic={onUpdateOptimistic}
    />,
  );
  return onUpdateOptimistic;
}

const option = (label: RegExp) => screen.getByRole("button", { name: label });
const save = () => screen.getByRole("button", { name: "Save Changes" });

describe("ReportingSettings", () => {
  it("shows an upgrade prompt without the reporting feature", () => {
    renderWithClient(
      <ReportingSettings
        hasReporting={false}
        initialData={null}
        onUpdateOptimistic={vi.fn()}
      />,
    );
    expect(screen.getByText("Premium Feature")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/plans");
  });

  it("defaults to weekly and allows saving when nothing is stored", () => {
    renderSettings();
    expect(option(/Weekly \(Fixed Dates\)/).className).toContain(
      "border-zinc-900",
    );
    expect(screen.queryByText("Current")).not.toBeInTheDocument();
    expect(save()).toBeEnabled();
  });

  it("marks the stored option and disables saving until something changes", () => {
    renderSettings(saved);
    expect(option(/Custom Weekday/)).toHaveTextContent("Current");
    expect(screen.getByLabelText("Reporting Day")).toHaveValue("Wednesday");
    expect(screen.getByLabelText("Interval")).toHaveValue("2");
    expect(save()).toBeDisabled();
  });

  it.each([
    ["day", "Reporting Day", "Friday"],
    ["interval", "Interval", "1"],
  ])("enables saving when the custom %s changes", (_l, label, value) => {
    renderSettings(saved);
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    expect(save()).toBeEnabled();
  });

  it("falls back to Monday and weekly for incomplete stored settings", () => {
    renderSettings({
      org_id: "org_1",
      report_frequency: "custom",
      report_day: null,
      report_interval: 0,
    });
    expect(screen.getByLabelText("Reporting Day")).toHaveValue("Monday");
    expect(screen.getByLabelText("Interval")).toHaveValue("1");
  });

  it("hides custom fields for other frequencies", () => {
    renderSettings({ ...saved, report_frequency: "weekly" });
    fireEvent.click(option(/Off/));
    expect(screen.queryByLabelText("Reporting Day")).not.toBeInTheDocument();
    expect(save()).toBeEnabled();
  });

  it("saves a non-custom frequency with no day and a weekly interval", async () => {
    mocks.updateOrgSettingAction.mockResolvedValue({ success: true });
    const onUpdateOptimistic = renderSettings(saved);
    fireEvent.click(option(/Twice Monthly/));
    fireEvent.click(save());

    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith("Settings updated"),
    );
    expect(mocks.updateOrgSettingAction).toHaveBeenCalledWith(
      "twice-monthly",
      null,
      1,
    );
    expect(onUpdateOptimistic).toHaveBeenCalledWith({
      ...saved,
      report_frequency: "twice-monthly",
      report_day: null,
      report_interval: 1,
    });
  });

  it("saves the custom day and interval", async () => {
    mocks.updateOrgSettingAction.mockResolvedValue({ success: true });
    renderSettings(saved);
    fireEvent.change(screen.getByLabelText("Reporting Day"), {
      target: { value: "Friday" },
    });
    fireEvent.click(save());
    await waitFor(() =>
      expect(mocks.updateOrgSettingAction).toHaveBeenCalledWith(
        "custom",
        "Friday",
        2,
      ),
    );
  });

  it("skips the optimistic update when nothing was stored", async () => {
    mocks.updateOrgSettingAction.mockResolvedValue({ success: true });
    const onUpdateOptimistic = renderSettings(null);
    fireEvent.click(save());
    await waitFor(() =>
      expect(mocks.updateOrgSettingAction).toHaveBeenCalledWith(
        "weekly",
        null,
        1,
      ),
    );
    expect(onUpdateOptimistic).not.toHaveBeenCalled();
  });

  it.each([
    ["the server error", "Unauthorized", "Unauthorized"],
    ["a fallback message", "", "Update failed"],
  ])("shows %s when saving fails", async (_l, error, shown) => {
    mocks.updateOrgSettingAction.mockResolvedValue({ success: false, error });
    renderSettings();
    fireEvent.click(save());
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(shown));
  });

  it("stays quiet for a failed result without an error field", async () => {
    mocks.updateOrgSettingAction.mockResolvedValue({ success: false });
    renderSettings();
    fireEvent.click(save());
    await waitFor(() =>
      expect(mocks.updateOrgSettingAction).toHaveBeenCalled(),
    );
    expect(mocks.toast.error).not.toHaveBeenCalled();
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });

  it("disables saving while the update is in flight", async () => {
    mocks.updateOrgSettingAction.mockReturnValue(new Promise(() => {}));
    renderSettings();
    fireEvent.click(save());
    await waitFor(() => expect(save()).toBeDisabled());
  });
});
