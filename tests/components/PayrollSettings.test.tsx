import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { type PayrollView, SEED_PAYROLL_RATES } from "@/lib/payroll";
import { renderWithClient } from "../utils";

const mocks = vi.hoisted(() => ({
  updatePayrollSettingsAction: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/payroll-actions", () => ({
  updatePayrollSettingsAction: mocks.updatePayrollSettingsAction,
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import PayrollSettings from "@/components/PayrollSettings";

const view: PayrollView = {
  enabled: false,
  province: "SK",
  rates: [...SEED_PAYROLL_RATES],
};

const save = () =>
  screen.getByRole("button", { name: "Save Payroll Settings" });
const toggle = () => screen.getByLabelText(/Estimate deductions/);
const province = () =>
  screen.getByLabelText("Province or territory of employment");

describe("PayrollSettings", () => {
  it("defaults to off in Saskatchewan with nothing to save", () => {
    renderWithClient(<PayrollSettings initialData={null} today="2026-11-02" />);
    expect(toggle()).not.toBeChecked();
    expect(province()).toHaveValue("SK");
    expect(save()).toBeDisabled();
    // No rates loaded at all.
    expect(screen.getByTestId("payroll-no-rates")).toBeInTheDocument();
  });

  it("shows the federal CPP and EI rates in effect", () => {
    renderWithClient(<PayrollSettings initialData={view} today="2026-11-02" />);
    const rates = screen.getByTestId("payroll-rates");
    expect(rates).toHaveTextContent("CPP5.95% up to $74,600.00");
    expect(rates).toHaveTextContent("CPP24% up to $85,000.00");
    expect(rates).toHaveTextContent("EI1.63% up to $68,900.00");
    expect(rates).toHaveTextContent("In effect since 2026-01-01.");
  });

  it("switches to QPP and Quebec EI rates for Quebec", () => {
    renderWithClient(<PayrollSettings initialData={view} today="2026-11-02" />);
    fireEvent.change(province(), { target: { value: "QC" } });
    const rates = screen.getByTestId("payroll-rates");
    expect(rates).toHaveTextContent("QPP6.3%");
    expect(rates).toHaveTextContent("QPP2");
    expect(rates).toHaveTextContent("EI1.3%");
    // Unknown values from the select are ignored.
    fireEvent.change(province(), { target: { value: "XX" } });
    expect(province()).toHaveValue("QC");
  });

  it("says when no rates cover the date", () => {
    renderWithClient(<PayrollSettings initialData={view} today="2020-01-01" />);
    expect(screen.getByTestId("payroll-no-rates")).toBeInTheDocument();
  });

  it("saves the toggle and province, then treats them as saved", async () => {
    mocks.updatePayrollSettingsAction.mockResolvedValue({
      success: true,
      data: {},
    });
    renderWithClient(<PayrollSettings initialData={view} />);
    fireEvent.click(toggle());
    fireEvent.change(province(), { target: { value: "ON" } });
    expect(save()).toBeEnabled();
    fireEvent.click(save());
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith(
        "Payroll settings updated",
      ),
    );
    expect(mocks.updatePayrollSettingsAction).toHaveBeenCalledWith(true, "ON");
    await waitFor(() => expect(save()).toBeDisabled());
  });

  it("shows a spinner while saving", async () => {
    mocks.updatePayrollSettingsAction.mockReturnValue(new Promise(() => {}));
    renderWithClient(<PayrollSettings initialData={view} />);
    fireEvent.click(toggle());
    fireEvent.click(save());
    await waitFor(() => expect(save()).toBeDisabled());
    expect(save().querySelector(".animate-spin")).not.toBeNull();
  });

  it("shows the error when saving fails", async () => {
    mocks.updatePayrollSettingsAction.mockResolvedValue({
      success: false,
      error: "Unauthorized",
    });
    renderWithClient(<PayrollSettings initialData={view} />);
    fireEvent.click(toggle());
    fireEvent.click(save());
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("Unauthorized"),
    );
    expect(save()).toBeEnabled();
  });
});
