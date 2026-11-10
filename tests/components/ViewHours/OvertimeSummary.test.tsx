import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OvertimeSummary } from "@/components/ViewHours/OvertimeSummary";
import { computeEntryOvertime } from "@/lib/overtime";
import { makeEntry } from "../../utils";

const settings = {
  org_id: "org_1",
  daily_threshold_hours: 7,
  weekly_threshold_hours: 40,
};

// makeEntry shifts run 9:00-17:00 UTC (8h) on Jan 5.
const ada = makeEntry({ user_id: "u1" });
const grace = makeEntry({
  user_id: "u2",
  clock_out: new Date("2026-01-05T20:00:00Z"),
});
const linus = makeEntry({
  user_id: "u3",
  clock_out: new Date("2026-01-05T12:00:00Z"),
});
const stranger = makeEntry({ user_id: "u9" });
const members = [
  { id: "u1", name: "Ada" },
  { id: "u2", name: "Grace" },
  { id: "u3", name: "Linus" },
];

function renderSummary(
  entries = [ada, grace, linus, stranger],
  isViewingAll = true,
) {
  render(
    <OvertimeSummary
      entries={entries}
      isViewingAll={isViewingAll}
      members={members}
      overtimeByEntry={computeEntryOvertime(entries, settings)}
      overtimeSettings={settings}
    />,
  );
}

describe("OvertimeSummary", () => {
  it("totals regular and overtime hours and names the policy", () => {
    renderSummary();
    expect(
      screen.getByText("Hours over 7h/day or 40h/week count as overtime."),
    ).toBeInTheDocument();
    // 8 + 11 + 3 + 8 = 30h; overtime 1 + 4 + 0 + 1 = 6h.
    expect(screen.getByTestId("regular-hours")).toHaveTextContent("24.00h");
    expect(screen.getByTestId("overtime-hours")).toHaveTextContent("6.00h");
    expect(screen.getByText("6.00h daily · 0.00h weekly")).toBeInTheDocument();
  });

  it("lists members with overtime, most first, in the org view", () => {
    renderSummary();
    const items = within(screen.getByTestId("overtime-by-member")).getAllByRole(
      "listitem",
    );
    expect(items.map((li) => li.textContent)).toEqual([
      "Grace4.00h OT",
      "Ada1.00h OT",
      "Unknown member1.00h OT",
    ]);
  });

  it("leaves out the member list for a single person", () => {
    renderSummary([grace], false);
    expect(screen.queryByTestId("overtime-by-member")).not.toBeInTheDocument();
    expect(screen.getByTestId("overtime-hours")).toHaveTextContent("4.00h");
  });

  it("shows zero overtime without the daily/weekly split", () => {
    renderSummary([linus], true);
    expect(screen.getByTestId("overtime-hours")).toHaveTextContent("0.00h");
    expect(screen.queryByText(/daily ·/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("overtime-by-member")).not.toBeInTheDocument();
  });

  it("defaults to the single-person view with no members", () => {
    render(
      <OvertimeSummary
        entries={[ada]}
        overtimeByEntry={computeEntryOvertime([ada], settings)}
        overtimeSettings={settings}
      />,
    );
    expect(screen.queryByTestId("overtime-by-member")).not.toBeInTheDocument();
  });

  it("shows banked and paid overtime when the org banks overtime", () => {
    // Ada 1h OT, Grace 4h OT; each gets 2h paid, the rest is banked.
    const banking = {
      ...settings,
      bank_overtime: true,
      bank_after_overtime_hours: 2,
    };
    const entries = [ada, grace];
    render(
      <OvertimeSummary
        entries={entries}
        isViewingAll
        members={members}
        overtimeByEntry={computeEntryOvertime(entries, banking)}
        overtimeSettings={banking}
      />,
    );
    expect(screen.getByTestId("banked-hours")).toHaveTextContent("2.00h");
    expect(screen.getByTestId("paid-overtime")).toHaveTextContent(
      "3.00h overtime paid",
    );
    expect(
      screen.getByText(/overtime past 2h\/week is banked/),
    ).toBeInTheDocument();
    expect(screen.getByText(/4.00h OT · 2.00h banked/)).toBeInTheDocument();
  });

  it("hides the banked card when banking is off", () => {
    renderSummary();
    expect(screen.queryByTestId("banked-hours")).not.toBeInTheDocument();
  });
});
