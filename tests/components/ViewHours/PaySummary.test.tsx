import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PaySummary } from "@/components/ViewHours/PaySummary";
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

function renderSummary(
  entries: TimeEntry[],
  isViewingAll = true,
  payroll: PayrollView | null = null,
) {
  render(
    <PaySummary
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
      ...overrides,
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
    });

    it("use QPP labels and Quebec rates in Quebec", () => {
      renderSummary([grace], true, payroll({ province: "QC" }));
      const block = screen.getByTestId("pay-deductions");
      expect(block).toHaveTextContent("Quebec");
      expect(within(block).getByText("QPP")).toBeVisible();
      expect(within(block).getByText("QPP2")).toBeVisible();
      // EI 1.30% of $240
      expect(screen.getByTestId("deduction-ei")).toHaveTextContent("$3.12");
    });
  });
});
