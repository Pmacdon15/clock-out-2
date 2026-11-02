"use client";

import { DollarSign } from "lucide-react";
import { useMemo } from "react";
import { type OvertimeSplit, weekStartOf } from "@/lib/overtime";
import {
  computePay,
  formatMoney,
  formatMultiplier,
  type PayBreakdown,
  type PayRate,
  sumPay,
} from "@/lib/pay";
import type { TimeEntry } from "@/lib/types";
import { Card } from "../ui";

interface PaySummaryProps {
  entries: TimeEntry[];
  /** Every entry's regular/overtime split (all regular when OT is off). */
  splitsByEntry: Map<TimeEntry, OvertimeSplit>;
  payRates: Map<string, PayRate>;
  isViewingAll?: boolean;
  members?: { id: string; name: string }[];
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
}: PaySummaryProps) {
  const summary = useMemo(() => {
    const byMember = new Map<string, PayBreakdown[]>();
    const byWeek = new Map<string, PayBreakdown[]>();
    const unrated = new Set<string>();
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
    };
  }, [entries, splitsByEntry, payRates, members]);

  const ownRate = !isViewingAll ? summary.memberRows[0]?.rate : undefined;

  return (
    <Card className="p-6" data-testid="pay-summary">
      <div className="mb-4">
        <h3 className="flex items-center gap-2 font-bold text-lg">
          <DollarSign className="h-4 w-4" />
          Estimated Gross Pay
        </h3>
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
