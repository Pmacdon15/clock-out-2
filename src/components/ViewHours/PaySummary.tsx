"use client";

import { DollarSign, Eye, EyeOff } from "lucide-react";
import { useMemo, useState } from "react";
import { useStoredToggle } from "@/hooks/useStoredToggle";
import { hasEnteredClaims, type TaxClaims } from "@/lib/income-tax";
import { type OvertimeSplit, weekStartOf } from "@/lib/overtime";
import {
  computePay,
  formatMoney,
  formatMultiplier,
  type PayBreakdown,
  type PayRate,
  sumPay,
} from "@/lib/pay";
import {
  computeDeductionsForPeriods,
  customDeductionsFor,
  describeCustomDeduction,
  jurisdictionFor,
  type PayrollDeductions,
  type PayrollView,
  type ProvinceCode,
  provinceName,
  sumDeductions,
} from "@/lib/payroll";
import type { TimeEntry } from "@/lib/types";
import { MemberTaxClaimRow } from "../TaxClaimSettings";
import { Card } from "../ui";

/** This browser's choice to show or hide deductions on the Hours page. */
export const SHOW_DEDUCTIONS_KEY = "clock-out:show-deductions";

interface PaySummaryProps {
  entries: TimeEntry[];
  /** Every entry's regular/overtime split (all regular when OT is off). */
  splitsByEntry: Map<TimeEntry, OvertimeSplit>;
  payRates: Map<string, PayRate>;
  isViewingAll?: boolean;
  members?: { id: string; name: string }[];
  /**
   * When deductions are on, CPP/QPP, EI, income tax and net pay are
   * estimated too.
   */
  payroll?: PayrollView | null;
  /** The signed-in member, who may enter their own TD1 amounts. */
  currentUserId?: string;
}

/** yyyy-MM-dd in the browser's zone, as the overtime split counts days. */
const dayOf = (date: Date | string) =>
  new Date(date).toLocaleDateString("en-CA");

const weekLabel = (monday: string) => {
  const [y, m, d] = monday.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, d, 12));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const fmt = (date: Date) =>
    date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  return `${fmt(start)} – ${fmt(end)}`;
};

/** Which TD1 amounts the income tax figures were worked out from. */
function taxBasis({
  withClaims,
  members,
}: {
  withClaims: number;
  members: number;
}): string {
  if (members > 0 && withClaims === members) {
    return "Income tax uses the TD1 amounts entered in Settings.";
  }
  if (withClaims === 0) {
    return "Income tax assumes the basic personal amounts (no TD1 amounts entered).";
  }
  return `Income tax uses TD1 amounts for ${withClaims} of ${members} members and the basic personal amounts for the rest.`;
}

/**
 * Estimated gross pay for the entries on screen: regular hours at each
 * member's rate plus overtime at rate × multiplier. Members without a rate
 * are left out (and counted, so the total isn't mistaken for everyone's).
 */
export function PaySummary({
  entries,
  splitsByEntry,
  payRates,
  isViewingAll = false,
  members = [],
  payroll = null,
  currentUserId,
}: PaySummaryProps) {
  const [showDeductions, setShowDeductions] = useStoredToggle(
    SHOW_DEDUCTIONS_KEY,
    true,
  );
  const [editingTd1, setEditingTd1] = useState(false);
  // TD1 amounts the member saved here, until the page's data refreshes.
  const [savedClaims, setSavedClaims] = useState<TaxClaims | null>(null);
  const claimsList = useMemo(() => {
    const list = payroll?.claims ?? [];
    if (!savedClaims) return list;
    return [
      ...list.filter((row) => row.userId !== savedClaims.userId),
      savedClaims,
    ];
  }, [payroll, savedClaims]);

  const summary = useMemo(() => {
    const byMember = new Map<string, PayBreakdown[]>();
    const byWeek = new Map<string, PayBreakdown[]>();
    const unrated = new Set<string>();
    const byMemberWeek = new Map<string, Map<string, number>>();
    for (const entry of entries) {
      const rate = payRates.get(entry.user_id);
      if (!rate) {
        unrated.add(entry.user_id);
        continue;
      }
      const pay = computePay(splitsByEntry.get(entry) as OvertimeSplit, rate);
      byMember.set(entry.user_id, [
        ...(byMember.get(entry.user_id) ?? []),
        pay,
      ]);
      const week = weekStartOf(dayOf(entry.clock_in));
      byWeek.set(week, [...(byWeek.get(week) ?? []), pay]);
      const weeks = byMemberWeek.get(entry.user_id) ?? new Map();
      weeks.set(week, (weeks.get(week) ?? 0) + pay.grossPay);
      byMemberWeek.set(entry.user_id, weeks);
    }
    // Deductions are worked out per member per Monday–Sunday week (52 pay
    // periods a year), so annual maximums and the prorated basic exemption
    // apply the way they would on weekly pay.
    // Income tax uses each member's TD1 claim amounts when entered, else
    // the basic personal amounts.
    let deductions:
      | (PayrollDeductions & {
          province: ProvinceCode;
          /** Members on screen with TD1 amounts entered, out of `members`. */
          withClaims: number;
          members: number;
          untaxedPeriods: number;
          /** Custom deductions by name, largest first. */
          customLines: { name: string; amount: number; detail: string }[];
        })
      | null = null;
    if (payroll?.enabled) {
      const jurisdiction = jurisdictionFor(payroll.province);
      const custom = payroll.customDeductions ?? [];
      let withClaims = 0;
      let untaxedPeriods = 0;
      const customByName = new Map<
        string,
        { amount: number; details: Set<string> }
      >();
      const totals = sumDeductions(
        Array.from(byMemberWeek.entries(), ([userId, weeks]) => {
          const claims = claimsList.find((row) => row.userId === userId);
          if (hasEnteredClaims(claims)) withClaims += 1;
          const own = customDeductionsFor(custom, userId);
          const result = computeDeductionsForPeriods(
            Array.from(weeks, ([date, gross]) => ({ date, gross })),
            payroll.rates,
            jurisdiction,
            52,
            { province: payroll.province, claims },
            undefined,
            own,
          );
          untaxedPeriods += result.untaxedPeriods;
          for (const deduction of own) {
            const line = customByName.get(deduction.name) ?? {
              amount: 0,
              details: new Set<string>(),
            };
            line.amount += result.customById[deduction.id] ?? 0;
            line.details.add(describeCustomDeduction(deduction));
            customByName.set(deduction.name, line);
          }
          return result.total;
        }),
      );
      deductions = {
        ...totals,
        province: payroll.province,
        withClaims,
        members: byMemberWeek.size,
        untaxedPeriods,
        customLines: Array.from(customByName, ([name, line]) => ({
          name,
          amount: Math.round(line.amount * 100) / 100,
          detail: line.details.size === 1 ? [...line.details][0] : "varies",
        })).sort((a, b) => b.amount - a.amount),
      };
    }
    const memberRows = Array.from(byMember.entries())
      .map(([id, pays]) => ({
        id,
        name: members.find((m) => m.id === id)?.name ?? "Unknown member",
        rate: payRates.get(id) as PayRate,
        ...sumPay(pays),
      }))
      .sort((a, b) => b.grossPay - a.grossPay);
    const weekRows = Array.from(byWeek.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, pays]) => ({ week, ...sumPay(pays) }));
    return {
      total: sumPay(memberRows),
      memberRows,
      weekRows,
      unratedCount: unrated.size,
      deductions,
    };
  }, [entries, splitsByEntry, payRates, members, payroll, claimsList]);

  const ownRate = !isViewingAll ? summary.memberRows[0]?.rate : undefined;
  // A member looking at their own hours can enter their own TD1 amounts.
  const canEditOwnTd1 =
    !isViewingAll &&
    Boolean(currentUserId) &&
    summary.memberRows.length === 1 &&
    summary.memberRows[0].id === currentUserId;
  const deductionsShown = summary.deductions && showDeductions;

  return (
    <Card className="p-6" data-testid="pay-summary">
      <div className="mb-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="flex items-center gap-2 font-bold text-lg">
            <DollarSign className="h-4 w-4" />
            Estimated Gross Pay
          </h3>
          {summary.deductions && (
            <button
              aria-pressed={showDeductions}
              className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 font-bold text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
              data-testid="toggle-deductions"
              onClick={() => setShowDeductions(!showDeductions)}
              type="button"
            >
              {showDeductions ? (
                <EyeOff className="h-3.5 w-3.5" />
              ) : (
                <Eye className="h-3.5 w-3.5" />
              )}
              {showDeductions ? "Hide deductions" : "Show deductions"}
            </button>
          )}
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {ownRate
            ? `${formatMoney(ownRate.hourlyRate)}/hr · overtime at ${formatMultiplier(ownRate.overtimeMultiplier)}. `
            : ""}
          Before taxes and deductions.
        </p>
      </div>
      <div className="font-black text-3xl tabular-nums" data-testid="gross-pay">
        {formatMoney(summary.total.grossPay)}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-zinc-50 p-3 dark:bg-zinc-900">
          <div className="font-bold text-[10px] text-zinc-500 uppercase tracking-wider dark:text-zinc-400">
            Regular pay
          </div>
          <div className="font-bold tabular-nums" data-testid="regular-pay">
            {formatMoney(summary.total.regularPay)}
          </div>
        </div>
        <div className="rounded-xl bg-zinc-50 p-3 dark:bg-zinc-900">
          <div className="font-bold text-[10px] text-zinc-500 uppercase tracking-wider dark:text-zinc-400">
            Overtime pay
          </div>
          <div className="font-bold tabular-nums" data-testid="overtime-pay">
            {formatMoney(summary.total.overtimePay)}
          </div>
        </div>
      </div>

      {deductionsShown && summary.deductions && (
        <div className="mt-4" data-testid="pay-deductions">
          <div className="mb-2 font-bold text-[10px] text-zinc-500 uppercase tracking-wider dark:text-zinc-400">
            Estimated deductions · {provinceName(summary.deductions.province)}
          </div>
          <ul className="space-y-1 text-sm">
            <li className="flex items-center justify-between">
              <span>
                {summary.deductions.province === "QC" ? "QPP" : "CPP"}
              </span>
              <span className="tabular-nums" data-testid="deduction-pension">
                {formatMoney(summary.deductions.pension)}
              </span>
            </li>
            <li className="flex items-center justify-between">
              <span>
                {summary.deductions.province === "QC" ? "QPP2" : "CPP2"}
              </span>
              <span className="tabular-nums" data-testid="deduction-pension2">
                {formatMoney(summary.deductions.pension2)}
              </span>
            </li>
            <li className="flex items-center justify-between">
              <span>EI</span>
              <span className="tabular-nums" data-testid="deduction-ei">
                {formatMoney(summary.deductions.ei)}
              </span>
            </li>
            <li className="flex items-center justify-between">
              <span>Federal income tax</span>
              <span
                className="tabular-nums"
                data-testid="deduction-federal-tax"
              >
                {formatMoney(summary.deductions.federalTax)}
              </span>
            </li>
            {summary.deductions.province !== "QC" && (
              <li className="flex items-center justify-between">
                <span>Provincial income tax</span>
                <span
                  className="tabular-nums"
                  data-testid="deduction-provincial-tax"
                >
                  {formatMoney(summary.deductions.provincialTax)}
                </span>
              </li>
            )}
            {summary.deductions.customLines.map((line) => (
              <li
                className="flex items-center justify-between gap-2"
                data-testid="deduction-custom"
                key={line.name}
              >
                <span className="min-w-0">
                  {line.name}{" "}
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    ({line.detail})
                  </span>
                </span>
                <span className="tabular-nums">{formatMoney(line.amount)}</span>
              </li>
            ))}
            <li className="flex items-center justify-between border-t pt-1 font-bold">
              <span>Estimated net pay</span>
              <span className="tabular-nums" data-testid="net-pay">
                {formatMoney(summary.deductions.net)}
              </span>
            </li>
          </ul>
          <p
            className="mt-1 text-xs text-zinc-500 dark:text-zinc-400"
            data-testid="tax-basis"
          >
            {taxBasis(summary.deductions)} Annual maximums count only the hours
            shown here.
            {summary.deductions.province === "QC" &&
              " Quebec provincial income tax isn't included."}
            {summary.deductions.untaxedPeriods > 0 &&
              " Weeks before 2026 have no income tax estimate."}
          </p>
          {canEditOwnTd1 && currentUserId && (
            <div className="mt-2">
              <button
                className="font-bold text-xs text-zinc-500 underline-offset-2 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
                data-testid="edit-own-td1"
                onClick={() => setEditingTd1(!editingTd1)}
                type="button"
              >
                {editingTd1 ? "Close TD1 amounts" : "Enter my TD1 amounts"}
              </button>
              {editingTd1 && (
                <div className="mt-2">
                  <MemberTaxClaimRow
                    compact
                    heading="Your TD1 amounts"
                    member={{ id: currentUserId, name: "you" }}
                    onSaved={setSavedClaims}
                    saved={claimsList.find(
                      (row) => row.userId === currentUserId,
                    )}
                    showProvincial={summary.deductions.province !== "QC"}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {summary.weekRows.length > 1 && (
        <div className="mt-4">
          <div className="mb-2 font-bold text-[10px] text-zinc-500 uppercase tracking-wider dark:text-zinc-400">
            By pay week
          </div>
          <ul className="space-y-1" data-testid="pay-by-week">
            {summary.weekRows.map((row) => (
              <li
                className="flex items-center justify-between text-sm"
                key={row.week}
              >
                <span>{weekLabel(row.week)}</span>
                <span className="font-bold tabular-nums">
                  {formatMoney(row.grossPay)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {isViewingAll && summary.memberRows.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 font-bold text-[10px] text-zinc-500 uppercase tracking-wider dark:text-zinc-400">
            By member
          </div>
          <ul className="space-y-1" data-testid="pay-by-member">
            {summary.memberRows.map((row) => (
              <li
                className="flex items-center justify-between gap-2 text-sm"
                key={row.id}
              >
                <span className="min-w-0 truncate font-medium">{row.name}</span>
                <span className="font-bold tabular-nums">
                  {formatMoney(row.grossPay)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {isViewingAll && summary.unratedCount > 0 && (
        <p
          className="mt-3 text-xs text-zinc-500 dark:text-zinc-400"
          data-testid="pay-unrated"
        >
          {summary.unratedCount}{" "}
          {summary.unratedCount === 1 ? "member has" : "members have"} no pay
          rate and {summary.unratedCount === 1 ? "isn't" : "aren't"} included.
          Set rates in Settings.
        </p>
      )}
    </Card>
  );
}
