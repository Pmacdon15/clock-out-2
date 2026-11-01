"use client";

import { Hourglass } from "lucide-react";
import { useMemo } from "react";
import {
  describeOvertime,
  type OvertimeSplit,
  sumOvertime,
} from "@/lib/overtime";
import type { OvertimeSettingsData, TimeEntry } from "@/lib/types";
import { Card } from "../ui";

interface OvertimeSummaryProps {
  entries: TimeEntry[];
  overtimeByEntry: Map<TimeEntry, OvertimeSplit>;
  overtimeSettings: OvertimeSettingsData | null | undefined;
  isViewingAll?: boolean;
  members?: { id: string; name: string }[];
}

export function OvertimeSummary({
  entries,
  overtimeByEntry,
  overtimeSettings,
  isViewingAll = false,
  members = [],
}: OvertimeSummaryProps) {
  const total = useMemo(
    () => sumOvertime(overtimeByEntry.values()),
    [overtimeByEntry],
  );

  // Who worked overtime, most first — only meaningful for the org view.
  const byMember = useMemo(() => {
    if (!isViewingAll) return [];
    const map = new Map<string, OvertimeSplit[]>();
    for (const entry of entries) {
      const split = overtimeByEntry.get(entry) as OvertimeSplit;
      map.set(entry.user_id, [...(map.get(entry.user_id) ?? []), split]);
    }
    return Array.from(map.entries())
      .map(([id, splits]) => ({
        id,
        name: members.find((m) => m.id === id)?.name ?? "Unknown member",
        ...sumOvertime(splits),
      }))
      .filter((m) => m.overtimeHours > 0)
      .sort((a, b) => b.overtimeHours - a.overtimeHours);
  }, [entries, overtimeByEntry, isViewingAll, members]);

  const hasOvertime = total.overtimeHours > 0;

  return (
    <Card className="p-6" data-testid="overtime-summary">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="flex items-center gap-2 font-bold text-lg">
            <Hourglass className="h-4 w-4" />
            Overtime
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Hours {describeOvertime(overtimeSettings)} count as overtime.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-zinc-50 p-3 dark:bg-zinc-900">
          <div className="font-bold text-[10px] text-zinc-500 uppercase tracking-wider dark:text-zinc-400">
            Regular
          </div>
          <div
            className="font-black text-xl tabular-nums"
            data-testid="regular-hours"
          >
            {total.regularHours.toFixed(2)}h
          </div>
        </div>
        <div
          className={`rounded-xl p-3 ${
            hasOvertime
              ? "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300"
              : "bg-zinc-50 dark:bg-zinc-900"
          }`}
        >
          <div className="font-bold text-[10px] uppercase tracking-wider opacity-80">
            Overtime
          </div>
          <div
            className="font-black text-xl tabular-nums"
            data-testid="overtime-hours"
          >
            {total.overtimeHours.toFixed(2)}h
          </div>
        </div>
      </div>
      {hasOvertime && (
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          {total.dailyOvertimeHours.toFixed(2)}h daily ·{" "}
          {total.weeklyOvertimeHours.toFixed(2)}h weekly
        </p>
      )}
      {byMember.length > 0 && (
        <ul className="mt-4 space-y-2" data-testid="overtime-by-member">
          {byMember.map((member) => (
            <li
              className="flex items-center justify-between text-sm"
              key={member.id}
            >
              <span className="font-medium">{member.name}</span>
              <span className="font-bold text-orange-700 tabular-nums dark:text-orange-400">
                {member.overtimeHours.toFixed(2)}h OT
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
