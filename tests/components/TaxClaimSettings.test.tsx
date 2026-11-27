import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TaxClaims } from "@/lib/income-tax";

const mocks = vi.hoisted(() => ({
  updateMemberTaxClaimsAction: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/payroll-actions", () => ({
  updateMemberTaxClaimsAction: mocks.updateMemberTaxClaimsAction,
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import TaxClaimSettings from "@/components/TaxClaimSettings";

const members = [
  { id: "u1", name: "Ada" },
  { id: "u2", name: "Bo" },
];
const claims: TaxClaims[] = [
  { userId: "u1", federalClaim: 16452, provincialClaim: 0, additionalTax: 25 },
];

const field = (kind: string, id: string) =>
  document.getElementById(`td1-${kind}-${id}`) as HTMLInputElement | null;
const pick = (id: string) =>
  fireEvent.change(screen.getByTestId("tax-claim-member"), {
    target: { value: id },
  });
const saveButton = (id: string) =>
  screen
    .getByTestId(`tax-claim-row-${id}`)
    .querySelector("button") as HTMLButtonElement;

function renderSettings(
  props: Partial<Parameters<typeof TaxClaimSettings>[0]> = {},
) {
  render(
    <TaxClaimSettings
      enabled
      initialClaims={claims}
      members={members}
      province="SK"
      {...props}
    />,
  );
}

describe("TaxClaimSettings", () => {
  it("says so when there are no members", () => {
    renderSettings({ members: [] });
    expect(screen.getByText("No members to show yet.")).toBeInTheDocument();
  });

  it("fills in saved amounts and leaves the rest blank", () => {
    renderSettings();
    expect(field("federal", "u1")?.value).toBe("16452");
    expect(field("provincial", "u1")?.value).toBe("0");
    expect(field("additional", "u1")?.value).toBe("25");
    expect(saveButton("u1")).toBeDisabled();
    expect(field("federal", "u2")).toBeNull();
    pick("u2");
    expect(field("federal", "u1")).toBeNull();
    expect(field("federal", "u2")?.value).toBe("");
    expect(field("provincial", "u2")?.value).toBe("");
    expect(field("additional", "u2")?.value).toBe("");
    expect(screen.queryByTestId("tax-claims-disabled")).not.toBeInTheDocument();
  });

  it("points to the deductions toggle while it's off", () => {
    renderSettings({ enabled: false });
    expect(screen.getByTestId("tax-claims-disabled")).toBeVisible();
  });

  it("hides the provincial amount in Quebec", () => {
    renderSettings({ province: "QC" });
    expect(field("provincial", "u1")).toBeNull();
    expect(screen.getByText(/Quebec provincial tax/)).toBeVisible();
  });

  it("lists every member, marking those on the basic amount", () => {
    renderSettings();
    const options = Array.from(
      (screen.getByTestId("tax-claim-member") as HTMLSelectElement).options,
    ).map((o) => o.text);
    expect(options).toEqual(["Ada", "Bo (basic amount)"]);
  });

  it("saves entered amounts", async () => {
    mocks.updateMemberTaxClaimsAction.mockResolvedValue({ success: true });
    renderSettings();
    pick("u2");
    fireEvent.change(field("federal", "u2") as HTMLInputElement, {
      target: { value: "20000" },
    });
    fireEvent.change(field("provincial", "u2") as HTMLInputElement, {
      target: { value: "21000" },
    });
    fireEvent.change(field("additional", "u2") as HTMLInputElement, {
      target: { value: "10.5" },
    });
    fireEvent.click(saveButton("u2"));
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith(
        "TD1 amounts saved for Bo",
      ),
    );
    expect(mocks.updateMemberTaxClaimsAction).toHaveBeenCalledWith(
      "u2",
      20000,
      21000,
      10.5,
    );
    expect(saveButton("u2")).toBeDisabled();
    // Switching away and back keeps what was saved.
    pick("u1");
    pick("u2");
    expect(field("federal", "u2")?.value).toBe("20000");
    expect(screen.getByRole("option", { name: "Bo" })).toBeInTheDocument();
  });

  it("clears amounts back to the defaults", async () => {
    mocks.updateMemberTaxClaimsAction.mockResolvedValue({ success: true });
    renderSettings();
    for (const kind of ["federal", "provincial", "additional"]) {
      fireEvent.change(field(kind, "u1") as HTMLInputElement, {
        target: { value: "" },
      });
    }
    fireEvent.click(saveButton("u1"));
    await waitFor(() =>
      expect(mocks.updateMemberTaxClaimsAction).toHaveBeenCalledWith(
        "u1",
        null,
        null,
        0,
      ),
    );
  });

  it("explains and blocks invalid amounts", () => {
    renderSettings();
    pick("u2");
    fireEvent.change(field("federal", "u2") as HTMLInputElement, {
      target: { value: "-1" },
    });
    expect(screen.getByText(/Enter claim amounts from 0/)).toBeVisible();
    expect(saveButton("u2")).toBeDisabled();
    fireEvent.change(field("federal", "u2") as HTMLInputElement, {
      target: { value: "" },
    });
    fireEvent.change(field("provincial", "u2") as HTMLInputElement, {
      target: { value: "5000000" },
    });
    expect(saveButton("u2")).toBeDisabled();
    fireEvent.change(field("provincial", "u2") as HTMLInputElement, {
      target: { value: "" },
    });
    fireEvent.change(field("additional", "u2") as HTMLInputElement, {
      target: { value: "-2" },
    });
    expect(saveButton("u2")).toBeDisabled();
  });

  it("shows the failure reason", async () => {
    mocks.updateMemberTaxClaimsAction.mockResolvedValue({
      success: false,
      error: "Member not found",
    });
    renderSettings();
    pick("u2");
    fireEvent.change(field("federal", "u2") as HTMLInputElement, {
      target: { value: "1" },
    });
    fireEvent.click(saveButton("u2"));
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("Member not found"),
    );
    expect(saveButton("u2")).toBeEnabled();
  });
});
