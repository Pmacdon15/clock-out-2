import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PayRateData } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  updateMemberPayRateAction: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/actions", () => ({
  updateMemberPayRateAction: mocks.updateMemberPayRateAction,
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import PayRateSettings from "@/components/PayRateSettings";

const members = [
  { id: "u1", name: "Ada" },
  { id: "u2", name: "Bo" },
];
const rates: PayRateData[] = [
  { org_id: "org_1", user_id: "u1", hourly_rate: 20, overtime_multiplier: 2 },
];

const rateInput = (id: string) =>
  document.getElementById(`pay-rate-${id}`) as HTMLInputElement;
const multiplierInput = (id: string) =>
  document.getElementById(`pay-multiplier-${id}`) as HTMLInputElement;
const saveButton = (id: string) =>
  screen
    .getByTestId(`pay-rate-row-${id}`)
    .querySelector("button") as HTMLButtonElement;

describe("PayRateSettings", () => {
  it("says so when there are no members", () => {
    render(<PayRateSettings initialRates={[]} members={[]} />);
    expect(screen.getByText("No members to show yet.")).toBeInTheDocument();
  });

  it("fills in saved rates and defaults the rest", () => {
    render(<PayRateSettings initialRates={rates} members={members} />);
    expect(rateInput("u1").value).toBe("20");
    expect(multiplierInput("u1").value).toBe("2");
    expect(rateInput("u2").value).toBe("");
    expect(multiplierInput("u2").value).toBe("1.5");
    expect(saveButton("u1")).toBeDisabled();
    expect(saveButton("u2")).toBeDisabled();
  });

  it("saves a new rate", async () => {
    mocks.updateMemberPayRateAction.mockResolvedValue({ success: true });
    render(<PayRateSettings initialRates={rates} members={members} />);
    fireEvent.change(rateInput("u2"), { target: { value: "25.5" } });
    expect(saveButton("u2")).toBeEnabled();
    fireEvent.click(saveButton("u2"));
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith("Pay rate saved for Bo"),
    );
    expect(mocks.updateMemberPayRateAction).toHaveBeenCalledWith(
      "u2",
      25.5,
      1.5,
    );
    expect(saveButton("u2")).toBeDisabled();
  });

  it("saves a changed multiplier alone", async () => {
    mocks.updateMemberPayRateAction.mockResolvedValue({ success: true });
    render(<PayRateSettings initialRates={rates} members={members} />);
    fireEvent.change(multiplierInput("u1"), { target: { value: "1.5" } });
    fireEvent.click(saveButton("u1"));
    await waitFor(() =>
      expect(mocks.updateMemberPayRateAction).toHaveBeenCalledWith(
        "u1",
        20,
        1.5,
      ),
    );
  });

  it("ignores a multiplier change while there's no rate", () => {
    render(<PayRateSettings initialRates={[]} members={members} />);
    fireEvent.change(multiplierInput("u2"), { target: { value: "2" } });
    expect(saveButton("u2")).toBeDisabled();
  });

  it("clears a rate when the field is emptied", async () => {
    mocks.updateMemberPayRateAction.mockResolvedValue({ success: true });
    render(<PayRateSettings initialRates={rates} members={members} />);
    fireEvent.change(rateInput("u1"), { target: { value: " " } });
    fireEvent.click(saveButton("u1"));
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith(
        "Pay rate cleared for Ada",
      ),
    );
    expect(mocks.updateMemberPayRateAction).toHaveBeenCalledWith("u1", null, 2);
    expect(saveButton("u1")).toBeDisabled();
  });

  it("explains and blocks invalid values", () => {
    render(<PayRateSettings initialRates={rates} members={members} />);
    fireEvent.change(rateInput("u1"), { target: { value: "-3" } });
    expect(screen.getByText(/Enter an hourly rate from 0/)).toBeVisible();
    expect(saveButton("u1")).toBeDisabled();
    fireEvent.change(rateInput("u1"), { target: { value: "30" } });
    fireEvent.change(multiplierInput("u1"), { target: { value: "9" } });
    expect(screen.getByText(/Enter a multiplier from 1 to 5/)).toBeVisible();
    expect(saveButton("u1")).toBeDisabled();
  });

  it("shows the failure reason, or a fallback", async () => {
    mocks.updateMemberPayRateAction.mockResolvedValueOnce({
      success: false,
      error: "Member not found",
    });
    render(<PayRateSettings initialRates={[]} members={members} />);
    fireEvent.change(rateInput("u1"), { target: { value: "20" } });
    fireEvent.click(saveButton("u1"));
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("Member not found"),
    );
    expect(saveButton("u1")).toBeEnabled();

    mocks.updateMemberPayRateAction.mockResolvedValueOnce({ success: false });
    fireEvent.click(saveButton("u1"));
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("Update failed"),
    );
  });
});
