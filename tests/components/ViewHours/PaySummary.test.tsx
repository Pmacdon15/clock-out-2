import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateMemberTaxClaimsAction: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/payroll-actions", () => ({
  updateMemberTaxClaimsAction: mocks.updateMemberTaxClaimsAction,
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import {
  PaySummary,
  SHOW_DEDUCTIONS_KEY,
} from "@/components/ViewHours/PaySummary";
import { computeEntryOvertime } from "@/lib/overtime";
import type { PayRate } from "@/lib/pay";
import { type PayrollView, SEED_PAYROLL_RATES } from "@/lib/payroll";
import type { TimeEntry } from "@/lib/types";
import { makeEntry } from "../../utils";

const settings = {
  org_id: "org_1",
  daily_threshold_hours: 8,
  weekly_threshold_hours: null,
};

// makeEntry shifts run 9:00-17:00 UTC (8h) on Mon Jan 5, 2026.
const ada = makeEntry({
  user_id: "u1",
  clock_out: new Date("2026-01-05T19:00:00Z"),
});
const adaNextWeek = makeEntry({
  user_id: "u1",
  clock_in: new Date("2026-01-13T09:00:00Z"),
  clock_out: new Date("2026-01-13T17:00:00Z"),
});
const grace = makeEntry({ user_id: "u2" });
const linus = makeEntry({ user_id: "u3" });
const stranger = makeEntry({ user_id: "u9" });
const members = [
  { id: "u1", name: "Ada" },
  { id: "u2", name: "Grace" },
  { id: "u3", name: "Linus" },
];
const rates = new Map<string, PayRate>([
  ["u1", { hourlyRate: 20, overtimeMultiplier: 1.5 }],
  ["u2", { hourlyRate: 30, overtimeMultiplier: 2 }],
  ["u9", { hourlyRate: 10, overtimeMultiplier: 1.5 }],
]);

beforeEach(() => {
  window.localStorage.clear();
});

function renderSummary(
  entries: TimeEntry[],
  isViewingAll = true,
  payroll: PayrollView | null = null,
  currentUserId?: string,
) {
  render(
    <PaySummary
      currentUserId={currentUserId}
      entries={entries}
      isViewingAll={isViewingAll}
      members={members}
      payroll={payroll}
      payRates={rates}
      splitsByEntry={computeEntryOvertime(entries, settings)}
    />,
  );
}

describe("PaySummary", () => {
  it("estimates gross pay with overtime at each member's multiplier", () => {
    // Ada: 8h × $20 + 2h OT × $30 = $220. Grace: 8h × $30 = $240.
    renderSummary([ada, grace]);
    expect(screen.getByTestId("gross-pay")).toHaveTextContent("$460.00");
    expect(screen.getByTestId("regular-pay")).toHaveTextContent("$400.00");
    expect(screen.getByTestId("overtime-pay")).toHaveTextContent("$60.00");
  });

  it("lists members by gross pay and notes who has no rate", () => {
    renderSummary([ada, grace, linus, stranger]);
    const items = within(screen.getByTestId("pay-by-member")).getAllByRole(
      "listitem",
    );
    expect(items.map((item) => item.textContent)).toEqual([
      "Grace$240.00",
      "Ada$220.00",
      "Unknown member$80.00",
    ]);
    expect(screen.getByTestId("pay-unrated")).toHaveTextContent(
      "1 member has no pay rate and isn't included.",
    );
  });

  it("words the unrated note for several members", () => {
    renderSummary([
      linus,
      makeEntry({ user_id: "u4" }),
      makeEntry({ user_id: "u1" }),
    ]);
    expect(screen.getByTestId("pay-unrated")).toHaveTextContent(
      "2 members have no pay rate and aren't included.",
    );
  });

  it("breaks pay down by week when the range spans several", () => {
    renderSummary([ada, adaNextWeek], false);
    const items = within(screen.getByTestId("pay-by-week")).getAllByRole(
      "listitem",
    );
    expect(items.map((item) => item.textContent)).toEqual([
      "Jan 5 – Jan 11$220.00",
      "Jan 12 – Jan 18$160.00",
    ]);
  });

  it("shows a member their own rate, without the org breakdowns", () => {
    renderSummary([ada], false);
    expect(
      screen.getByText(/\$20\.00\/hr · overtime at 1\.5x\./),
    ).toBeVisible();
    expect(screen.queryByTestId("pay-by-week")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pay-by-member")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pay-unrated")).not.toBeInTheDocument();
  });

  it("shows zero for a member with no rate", () => {
    renderSummary([linus], false);
    expect(screen.getByTestId("gross-pay")).toHaveTextContent("$0.00");
    expect(screen.queryByText(/\/hr/)).not.toBeInTheDocument();
  });

  describe("payroll deductions", () => {
    const payroll = (overrides: Partial<PayrollView> = {}): PayrollView => ({
      enabled: true,
      province: "SK",
      rates: [...SEED_PAYROLL_RATES],
      claims: [],
      customDeductions: [],
      ...overrides,
    });
    const zeroClaims = (userId: string) => ({
      userId,
      federalClaim: 0,
      provincialClaim: 0,
      additionalTax: 0,
    });

    it("are hidden unless the org turned them on", () => {
      renderSummary([ada], true, payroll({ enabled: false }));
      expect(screen.queryByTestId("pay-deductions")).not.toBeInTheDocument();
    });

    it("estimate CPP, EI and net pay per member per week", () => {
      // Ada $220 + $160 in two weeks, Grace $240: weekly CPP is 5.95% of pay
      // less 3,500/52, EI is 1.63%.
      renderSummary([ada, adaNextWeek, grace], true, payroll());
      const block = screen.getByTestId("pay-deductions");
      expect(block).toHaveTextContent("Estimated deductions · Saskatchewan");
      expect(screen.getByTestId("deduction-pension")).toHaveTextContent(
        "$24.89",
      );
      expect(screen.getByTestId("deduction-pension2")).toHaveTextContent(
        "$0.00",
      );
      expect(screen.getByTestId("deduction-ei")).toHaveTextContent("$10.11");
      expect(screen.getByTestId("net-pay")).toHaveTextContent("$585.00");
      expect(within(block).getByText("CPP")).toBeVisible();
      // Weekly pay this low is under the basic personal amounts.
      expect(screen.getByTestId("deduction-federal-tax")).toHaveTextContent(
        "$0.00",
      );
      expect(screen.getByTestId("deduction-provincial-tax")).toHaveTextContent(
        "$0.00",
      );
      expect(screen.getByTestId("tax-basis")).toHaveTextContent(
        "Income tax assumes the basic personal amounts",
      );
    });

    it("estimate income tax from TD1 amounts", () => {
      renderSummary(
        [ada, adaNextWeek],
        false,
        payroll({ claims: [zeroClaims("u1")] }),
      );
      expect(screen.getByTestId("deduction-federal-tax")).toHaveTextContent(
        "$42.20",
      );
      expect(screen.getByTestId("deduction-provincial-tax")).toHaveTextContent(
        "$37.72",
      );
      expect(screen.getByTestId("net-pay")).toHaveTextContent("$279.27");
      expect(screen.getByTestId("tax-basis")).toHaveTextContent(
        "Income tax uses the TD1 amounts entered in Settings.",
      );
    });

    it("say when only some members have TD1 amounts", () => {
      renderSummary(
        [ada, grace],
        true,
        payroll({ claims: [zeroClaims("u2")] }),
      );
      expect(screen.getByTestId("tax-basis")).toHaveTextContent(
        "Income tax uses TD1 amounts for 1 of 2 members and the basic personal amounts for the rest.",
      );
    });

    it("note weeks with no income tax tables", () => {
      const old = makeEntry({
        user_id: "u1",
        clock_in: new Date("2025-12-29T09:00:00Z"),
        clock_out: new Date("2025-12-29T17:00:00Z"),
      });
      renderSummary(
        [old],
        false,
        payroll({
          rates: [{ ...SEED_PAYROLL_RATES[0], effectiveFrom: "2025-01-01" }],
        }),
      );
      expect(screen.getByTestId("tax-basis")).toHaveTextContent(
        "Weeks before 2026 have no income tax estimate.",
      );
    });

    it("say no TD1 amounts apply when nobody on screen has a rate", () => {
      renderSummary([linus], false, payroll());
      expect(screen.getByTestId("tax-basis")).toHaveTextContent(
        "Income tax assumes the basic personal amounts",
      );
    });

    it("can be hidden and shown again, remembered in this browser", () => {
      renderSummary([ada], true, payroll());
      const toggle = screen.getByTestId("toggle-deductions");
      expect(toggle).toHaveTextContent("Hide deductions");
      fireEvent.click(toggle);
      expect(screen.queryByTestId("pay-deductions")).not.toBeInTheDocument();
      expect(screen.getByTestId("gross-pay")).toBeInTheDocument();
      expect(toggle).toHaveTextContent("Show deductions");
      expect(window.localStorage.getItem(SHOW_DEDUCTIONS_KEY)).toBe("0");
      fireEvent.click(toggle);
      expect(screen.getByTestId("pay-deductions")).toBeInTheDocument();
    });

    it("start hidden when this browser hid them before", () => {
      window.localStorage.setItem(SHOW_DEDUCTIONS_KEY, "0");
      renderSummary([ada], true, payroll());
      expect(screen.queryByTestId("pay-deductions")).not.toBeInTheDocument();
    });

    it("offer no toggle when the org has them off", () => {
      renderSummary([ada], true, payroll({ enabled: false }));
      expect(screen.queryByTestId("toggle-deductions")).not.toBeInTheDocument();
    });

    it("take custom deductions off net pay, by name", () => {
      // Grace $240: CPP 5.95% × (240 − 3500/52) = $10.27, EI $3.91.
      renderSummary(
        [grace, ada],
        true,
        payroll({
          customDeductions: [
            {
              id: "1",
              userId: null,
              name: "Union dues",
              kind: "fixed",
              amount: 10,
              preTax: true,
            },
            {
              id: "2",
              userId: "u2",
              name: "RRSP",
              kind: "percent",
              amount: 5,
              preTax: true,
            },
          ],
        }),
      );
      const lines = screen.getAllByTestId("deduction-custom");
      expect(lines).toHaveLength(2);
      // Both members pay $10 dues; only Grace pays 5% of $240.
      expect(lines[0]).toHaveTextContent("Union dues");
      expect(lines[0]).toHaveTextContent("$20.00");
      expect(lines[0]).toHaveTextContent("$10.00 per week, before tax");
      expect(lines[1]).toHaveTextContent("RRSP");
      expect(lines[1]).toHaveTextContent("$12.00");
    });

    it("say a same-named deduction varies between members", () => {
      renderSummary(
        [grace, ada],
        true,
        payroll({
          customDeductions: [
            {
              id: "1",
              userId: "u1",
              name: "RRSP",
              kind: "fixed",
              amount: 10,
              preTax: false,
            },
            {
              id: "2",
              userId: "u2",
              name: "RRSP",
              kind: "percent",
              amount: 5,
              preTax: false,
            },
          ],
        }),
      );
      const [line] = screen.getAllByTestId("deduction-custom");
      // $10 for Ada plus 5% of Grace's $240.
      expect(line).toHaveTextContent("RRSP (varies)$22.00");
    });

    it("let a member enter their own TD1 amounts", async () => {
      mocks.updateMemberTaxClaimsAction.mockResolvedValue({
        success: true,
        data: null,
      });
      renderSummary(
        [ada, adaNextWeek],
        false,
        payroll({ claims: [zeroClaims("u2")] }),
        "u1",
      );
      const before = screen.getByTestId("deduction-federal-tax").textContent;
      fireEvent.click(screen.getByTestId("edit-own-td1"));
      expect(screen.getByText("Your TD1 amounts")).toBeInTheDocument();
      fireEvent.change(document.getElementById("td1-federal-u1") as Element, {
        target: { value: "0" },
      });
      fireEvent.change(
        document.getElementById("td1-provincial-u1") as Element,
        { target: { value: "0" } },
      );
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() =>
        expect(mocks.updateMemberTaxClaimsAction).toHaveBeenCalledWith(
          "u1",
          0,
          0,
          0,
        ),
      );
      // The estimate follows the saved amounts at once.
      await waitFor(() =>
        expect(screen.getByTestId("deduction-federal-tax")).toHaveTextContent(
          "$42.20",
        ),
      );
      expect(before).toBe("$0.00");
    });

    it("don't offer TD1 entry on someone else's hours", () => {
      renderSummary([ada], false, payroll(), "u2");
      expect(screen.queryByTestId("edit-own-td1")).not.toBeInTheDocument();
    });

    it("use QPP labels and Quebec rates in Quebec", () => {
      renderSummary([grace], true, payroll({ province: "QC" }));
      const block = screen.getByTestId("pay-deductions");
      expect(block).toHaveTextContent("Quebec");
      expect(within(block).getByText("QPP")).toBeVisible();
      expect(within(block).getByText("QPP2")).toBeVisible();
      // EI 1.30% of $240
      expect(screen.getByTestId("deduction-ei")).toHaveTextContent("$3.12");
      expect(
        screen.queryByTestId("deduction-provincial-tax"),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("tax-basis")).toHaveTextContent(
        "Quebec provincial income tax isn't included.",
      );
    });
  });
});
