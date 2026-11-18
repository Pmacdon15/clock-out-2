import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_ALERT_SETTINGS } from "@/lib/alerts";
import type { AlertSettingsData } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  updateAlertSettingsAction: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/alert-actions", () => ({
  updateAlertSettingsAction: mocks.updateAlertSettingsAction,
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import AlertSettings from "@/components/AlertSettings";

const save = () => screen.getByRole("button", { name: "Save Alert Settings" });
const toggle = (name: RegExp) => fireEvent.click(screen.getByLabelText(name));
const setNumber = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("AlertSettings", () => {
  it("points orgs without the notifications feature to the plans page", () => {
    const { rerender } = render(
      <AlertSettings hasScheduling initialData={null} />,
    );
    expect(screen.getByTestId("notifications-upgrade")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/plans");
    rerender(
      <AlertSettings hasNotifications hasScheduling initialData={null} />,
    );
    expect(
      screen.queryByTestId("notifications-upgrade"),
    ).not.toBeInTheDocument();
  });

  it("starts with every rule off and nothing to save", () => {
    render(<AlertSettings initialData={null} />);
    expect(screen.getByText("Shift Alerts")).toBeInTheDocument();
    expect(screen.getByLabelText(/Forgot to clock out/)).not.toBeChecked();
    expect(screen.getByLabelText(/Notify admins too/)).toBeChecked();
    expect(screen.queryByLabelText(/Remind after \(hours\)/)).toBeNull();
    expect(save()).toBeDisabled();
  });

  it("locks the scheduled rules on plans without Scheduling", () => {
    render(<AlertSettings hasNotifications initialData={null} />);
    expect(screen.getByTestId("scheduling-upgrade")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/plans");
    expect(
      screen.getByLabelText(/Auto clock-in at scheduled start/),
    ).toBeDisabled();
    expect(
      screen.getByLabelText(/Auto clock-out at scheduled end/),
    ).toBeDisabled();
    expect(screen.getByLabelText(/Forgot to clock out/)).toBeEnabled();
  });

  it("shows saved-on scheduled rules as off without Scheduling", () => {
    render(
      <AlertSettings
        hasNotifications
        initialData={{
          org_id: "org_1",
          ...DEFAULT_ALERT_SETTINGS,
          auto_clock_in_scheduled: true,
          auto_clock_out_scheduled: true,
        }}
      />,
    );
    expect(
      screen.getByLabelText(/Auto clock-in at scheduled start/),
    ).not.toBeChecked();
    expect(
      screen.getByLabelText(/Auto clock-out at scheduled end/),
    ).not.toBeChecked();
  });

  it("saves every rule the admin turns on", async () => {
    mocks.updateAlertSettingsAction.mockResolvedValue({
      success: true,
      data: {},
    });
    render(<AlertSettings hasScheduling initialData={null} />);

    toggle(/Forgot to clock out/);
    setNumber(/Remind after \(hours\)/, "9");
    toggle(/Automatic clock-out/);
    setNumber(/Clock out after \(hours\)/, "14");
    toggle(/Forgot to end break/);
    setNumber(/Remind after \(minutes\)/, "40");
    toggle(/Notify admins too/);
    toggle(/Schedule notifications/);
    toggle(/Auto clock-in at scheduled start/);
    toggle(/Auto clock-out at scheduled end/);

    expect(save()).toBeEnabled();
    fireEvent.click(save());

    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith(
        "Alert settings updated",
      ),
    );
    expect(mocks.updateAlertSettingsAction).toHaveBeenCalledWith({
      forgot_clock_out_enabled: true,
      forgot_clock_out_hours: 9,
      auto_clock_out_enabled: true,
      auto_clock_out_hours: 14,
      auto_clock_in_scheduled: true,
      auto_clock_out_scheduled: true,
      break_reminder_enabled: true,
      break_reminder_minutes: 40,
      notify_admins: false,
      schedule_notifications: false,
    });
    // What was saved is now the baseline.
    await waitFor(() => expect(save()).toBeDisabled());
  });

  it("explains and blocks invalid combinations", () => {
    const initialData: AlertSettingsData = {
      org_id: "org_1",
      ...DEFAULT_ALERT_SETTINGS,
      forgot_clock_out_enabled: true,
      auto_clock_out_enabled: true,
    };
    render(<AlertSettings initialData={initialData} />);
    setNumber(/Clock out after \(hours\)/, "8");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Auto clock-out must come after",
    );
    expect(save()).toBeDisabled();
  });

  it("shows the server's error", async () => {
    mocks.updateAlertSettingsAction.mockResolvedValueOnce({
      success: false,
      error: "Unauthorized",
    });
    render(<AlertSettings initialData={null} />);
    toggle(/Forgot to clock out/);
    fireEvent.click(save());
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("Unauthorized"),
    );

    mocks.updateAlertSettingsAction.mockResolvedValueOnce({
      success: false,
      error: "",
    });
    fireEvent.click(save());
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("Update failed"),
    );
  });
});
