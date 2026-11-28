import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomDeduction } from "@/lib/payroll";

const mocks = vi.hoisted(() => ({
  addCustomDeductionAction: vi.fn(),
  deleteCustomDeductionAction: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/payroll-actions", () => ({
  addCustomDeductionAction: mocks.addCustomDeductionAction,
  deleteCustomDeductionAction: mocks.deleteCustomDeductionAction,
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import CustomDeductionSettings from "@/components/CustomDeductionSettings";

const members = [
  { id: "u1", name: "Ada" },
  { id: "u2", name: "Bo" },
];
const dues: CustomDeduction = {
  id: "1",
  userId: null,
  name: "Union dues",
  kind: "fixed",
  amount: 12.5,
  preTax: true,
};

const renderSettings = (
  props: Partial<Parameters<typeof CustomDeductionSettings>[0]> = {},
) =>
  render(
    <CustomDeductionSettings
      enabled
      initialDeductions={[dues]}
      members={members}
      {...props}
    />,
  );

const addButton = () => screen.getByRole("button", { name: /Add Deduction/ });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CustomDeductionSettings", () => {
  it("lists saved deductions with who they're for", () => {
    renderSettings({
      initialDeductions: [
        dues,
        {
          ...dues,
          id: "2",
          userId: "u2",
          name: "RRSP",
          kind: "percent",
          amount: 5,
        },
        { ...dues, id: "3", userId: "gone", name: "Parking", preTax: false },
      ],
    });
    expect(screen.getByTestId("custom-deduction-1")).toHaveTextContent(
      "$12.50 per week, before tax · Everyone",
    );
    expect(screen.getByTestId("custom-deduction-2")).toHaveTextContent(
      "5% of gross, before tax · Bo",
    );
    expect(screen.getByTestId("custom-deduction-3")).toHaveTextContent(
      "$12.50 per week · Former member",
    );
  });

  it("says when there are none, and when payroll is off", () => {
    renderSettings({ initialDeductions: [], enabled: false });
    expect(screen.getByText("No other deductions yet.")).toBeInTheDocument();
    expect(
      screen.getByTestId("custom-deductions-disabled"),
    ).toBeInTheDocument();
  });

  it("only adds a valid deduction", () => {
    renderSettings();
    expect(addButton()).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "RRSP" },
    });
    fireEvent.change(screen.getByLabelText("Type"), {
      target: { value: "percent" },
    });
    fireEvent.change(screen.getByLabelText("Percent (%)"), {
      target: { value: "150" },
    });
    expect(addButton()).toBeDisabled();
    expect(
      screen.getByText("Enter a percentage above 0 and up to 100"),
    ).toBeInTheDocument();
  });

  it("switches the amount field between % and $", () => {
    renderSettings();
    fireEvent.change(screen.getByLabelText("Type"), {
      target: { value: "percent" },
    });
    expect(screen.getByLabelText("Percent (%)")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Type"), {
      target: { value: "fixed" },
    });
    expect(screen.getByLabelText("Amount ($)")).toBeInTheDocument();
  });

  it("adds a deduction for one member", async () => {
    const saved = {
      id: "9",
      userId: "u1",
      name: "RRSP",
      kind: "percent",
      amount: 5,
      preTax: true,
    };
    mocks.addCustomDeductionAction.mockResolvedValue({
      success: true,
      data: saved,
    });
    renderSettings();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "RRSP" },
    });
    fireEvent.change(screen.getByLabelText("Applies to"), {
      target: { value: "u1" },
    });
    fireEvent.change(screen.getByLabelText("Type"), {
      target: { value: "percent" },
    });
    fireEvent.change(screen.getByLabelText("Percent (%)"), {
      target: { value: "5" },
    });
    fireEvent.click(screen.getByLabelText(/Before tax/));
    fireEvent.click(addButton());
    await waitFor(() =>
      expect(screen.getByTestId("custom-deduction-9")).toHaveTextContent(
        "5% of gross, before tax · Ada",
      ),
    );
    expect(mocks.addCustomDeductionAction).toHaveBeenCalledWith({
      memberId: "u1",
      name: "RRSP",
      kind: "percent",
      amount: 5,
      preTax: true,
    });
    expect(screen.getByLabelText("Name")).toHaveValue("");
  });

  it("shows why a save failed", async () => {
    mocks.addCustomDeductionAction.mockResolvedValue({
      success: false,
      error: "Unauthorized",
    });
    renderSettings();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Parking" },
    });
    fireEvent.change(screen.getByLabelText("Amount ($)"), {
      target: { value: "20" },
    });
    fireEvent.click(addButton());
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("Unauthorized"),
    );
    expect(mocks.addCustomDeductionAction).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: null, kind: "fixed", amount: 20 }),
    );
  });

  it("removes a deduction", async () => {
    mocks.deleteCustomDeductionAction.mockResolvedValue({ success: true });
    renderSettings();
    fireEvent.click(screen.getByLabelText("Remove Union dues"));
    await waitFor(() =>
      expect(
        screen.queryByTestId("custom-deduction-1"),
      ).not.toBeInTheDocument(),
    );
    expect(mocks.deleteCustomDeductionAction).toHaveBeenCalledWith("1");
  });

  it("keeps a deduction it couldn't remove", async () => {
    mocks.deleteCustomDeductionAction.mockResolvedValue({
      success: false,
      error: "Deduction not found",
    });
    renderSettings();
    fireEvent.click(screen.getByLabelText("Remove Union dues"));
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("Deduction not found"),
    );
    expect(screen.getByTestId("custom-deduction-1")).toBeInTheDocument();
  });
});
