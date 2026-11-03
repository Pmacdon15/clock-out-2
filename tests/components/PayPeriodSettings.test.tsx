import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PayPeriodSettingsData } from "@/lib/types";
import { renderWithClient } from "../utils";

const mocks = vi.hoisted(() => ({
  updatePayPeriodSettingsAction: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/actions", () => ({
  updatePayPeriodSettingsAction: mocks.updatePayPeriodSettingsAction,
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import PayPeriodSettings from "@/components/PayPeriodSettings";

const saved: PayPeriodSettingsData = {
  org_id: "org_1",
  enabled: true,
  frequency: "weekly",
  anchor_payday: "2026-11-13",
  holdback_days: 7,
};

function renderPayPeriodSettings(
  initialData: PayPeriodSettingsData | null = null,
) {
  const onUpdateOptimistic = vi.fn();
  renderWithClient(
    <PayPeriodSettings
      initialData={initialData}
      onUpdateOptimistic={onUpdateOptimistic}
    />,
  );
  return onUpdateOptimistic;
}

const save = () =>
  screen.getByRole("button", { name: "Save Pay Period Settings" });
const toggle = () => screen.getByLabelText(/Track pay periods/);
const rows = () =>
  within(screen.getByRole("list"))
    .getAllByRole("listitem")
    .map((li) => li.textContent);

beforeEach(() => {
  // A Tuesday; only the clock is faked so React Query still settles.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-03T12:00:00"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("PayPeriodSettings", () => {
  it("starts off with nothing to save", () => {
    renderPayPeriodSettings();
    expect(toggle()).not.toBeChecked();
    expect(
      screen.queryByLabelText("How often you pay"),
    ).not.toBeInTheDocument();
    expect(save()).toBeDisabled();
  });

  it("defaults to every 2 weeks from the next Friday with no hold-back", () => {
    renderPayPeriodSettings();
    fireEvent.click(toggle());
    expect(screen.getByLabelText("How often you pay")).toHaveValue("bi-weekly");
    expect(screen.getByLabelText("A payday")).toHaveValue("2026-11-06");
    expect(screen.getByLabelText("Hold-back")).toHaveValue("0");
    expect(rows()).toEqual([
      "Oct 24 – Nov 6Paid Fri, Nov 6",
      "Nov 7 – Nov 20Paid Fri, Nov 20",
      "Nov 21 – Dec 4Paid Fri, Dec 4",
    ]);
    expect(save()).toBeEnabled();
  });

  it("describes each hold-back choice", () => {
    renderPayPeriodSettings();
    fireEvent.click(toggle());
    const options = within(screen.getByLabelText("Hold-back"))
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(options).toEqual([
      "None — the period ends on payday",
      "1 week — paid 1 week after the period ends",
      "2 weeks — paid 2 weeks after the period ends",
    ]);
  });

  it("saves a weekly payday held back a week, without an optimistic update", async () => {
    mocks.updatePayPeriodSettingsAction.mockResolvedValue({ success: true });
    const onUpdateOptimistic = renderPayPeriodSettings();
    fireEvent.click(toggle());
    fireEvent.change(screen.getByLabelText("How often you pay"), {
      target: { value: "weekly" },
    });
    fireEvent.change(screen.getByLabelText("A payday"), {
      target: { value: "2026-11-13" },
    });
    fireEvent.change(screen.getByLabelText("Hold-back"), {
      target: { value: "7" },
    });
    expect(rows()).toEqual([
      "Oct 31 – Nov 6Paid Fri, Nov 13",
      "Nov 7 – Nov 13Paid Fri, Nov 20",
      "Nov 14 – Nov 20Paid Fri, Nov 27",
    ]);
    fireEvent.click(save());
    await waitFor(() =>
      expect(mocks.updatePayPeriodSettingsAction).toHaveBeenCalledWith(
        true,
        "weekly",
        "2026-11-13",
        7,
      ),
    );
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith(
        "Pay period settings updated",
      ),
    );
    expect(onUpdateOptimistic).not.toHaveBeenCalled();
  });

  it("shows the stored settings and updates optimistically after a change", async () => {
    mocks.updatePayPeriodSettingsAction.mockResolvedValue({ success: true });
    const onUpdateOptimistic = renderPayPeriodSettings(saved);
    expect(toggle()).toBeChecked();
    expect(screen.getByLabelText("How often you pay")).toHaveValue("weekly");
    expect(screen.getByLabelText("Hold-back")).toHaveValue("7");
    expect(save()).toBeDisabled();

    fireEvent.click(toggle());
    expect(save()).toBeEnabled();
    fireEvent.click(save());
    await waitFor(() =>
      expect(mocks.updatePayPeriodSettingsAction).toHaveBeenCalledWith(
        false,
        "weekly",
        "2026-11-13",
        7,
      ),
    );
    expect(onUpdateOptimistic).toHaveBeenCalledWith({
      enabled: false,
      frequency: "weekly",
      anchor_payday: "2026-11-13",
      holdback_days: 7,
    });
  });

  it("asks for a payday before it can preview or save", () => {
    renderPayPeriodSettings(saved);
    fireEvent.change(screen.getByLabelText("A payday"), {
      target: { value: "" },
    });
    expect(
      screen.getByText("Pick a payday to see your pay periods."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(save()).toBeDisabled();
  });

  it.each([
    [
      "the server's reason",
      { success: false, error: "Unauthorized" },
      "Unauthorized",
    ],
    ["a fallback without one", { success: false }, "Update failed"],
  ])("shows %s when saving fails", async (_label, response, message) => {
    mocks.updatePayPeriodSettingsAction.mockResolvedValue(response);
    renderPayPeriodSettings(saved);
    fireEvent.change(screen.getByLabelText("Hold-back"), {
      target: { value: "14" },
    });
    fireEvent.click(save());
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(message),
    );
  });

  it("saves changes to the frequency and payday of stored settings", async () => {
    mocks.updatePayPeriodSettingsAction.mockResolvedValue({ success: true });
    renderPayPeriodSettings(saved);
    fireEvent.change(screen.getByLabelText("How often you pay"), {
      target: { value: "bi-weekly" },
    });
    expect(save()).toBeEnabled();
    fireEvent.change(screen.getByLabelText("How often you pay"), {
      target: { value: "weekly" },
    });
    fireEvent.change(screen.getByLabelText("A payday"), {
      target: { value: "2026-11-20" },
    });
    expect(save()).toBeEnabled();
  });

  it("disables saving while the save is in flight", async () => {
    mocks.updatePayPeriodSettingsAction.mockReturnValue(new Promise(() => {}));
    renderPayPeriodSettings(saved);
    fireEvent.click(toggle());
    fireEvent.click(save());
    await waitFor(() => expect(save()).toBeDisabled());
    expect(save().querySelector(".animate-spin")).not.toBeNull();
  });
});
