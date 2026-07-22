"use client";

import { Calendar } from "lucide-react";
import { useMemo } from "react";
import type { TimeEntry } from "@/lib/dal";
import { Card } from "../ui";

interface DaysWorkedBreakdownProps {
  entries: TimeEntry[];
  isViewingAll?: boolean;
}

export function DaysWorkedBreakdown({
  entries,
  isViewingAll = false,
}: DaysWorkedBreakdownProps) {
  const daysData = useMemo(() => {
    const uniqueMemberDays = new Set<string>();
    const counts: Record<number, number> = {
      0: 0,
      1: 0,
      2: 0,
      3: 0,
      4: 0,
      5: 0,
      6: 0,
    };

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const d = new Date(e.clock_in);
      const dateKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const uniqueKey = isViewingAll ? `${e.user_id}:${dateKey}` : dateKey;

      if (!uniqueMemberDays.has(uniqueKey)) {
        uniqueMemberDays.add(uniqueKey);
        counts[d.getDay()]++;
      }
    }

    return [
      { label: "Monday", shortLabel: "Mon", count: counts[1] },
      { label: "Tuesday", shortLabel: "Tue", count: counts[2] },
      { label: "Wednesday", shortLabel: "Wed", count: counts[3] },
      { label: "Thursday", shortLabel: "Thu", count: counts[4] },
      { label: "Friday", shortLabel: "Fri", count: counts[5] },
      { label: "Saturday", shortLabel: "Sat", count: counts[6] },
      { label: "Sunday", shortLabel: "Sun", count: counts[0] },
    ];
  }, [entries, isViewingAll]);

  const totalDaysWorked = useMemo(() => {
    return daysData.reduce((acc, curr) => acc + curr.count, 0);
  }, [daysData]);

  const maxCount = useMemo(() => {
    return Math.max(...daysData.map((d) => d.count), 1);
  }, [daysData]);

  return (
    <Card className="p-6">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h3 className="font-bold text-lg">Workday Distribution</h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {isViewingAll
              ? "Cumulative distribution of workdays completed by team members."
              : "How your working days are distributed across the week."}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2 rounded-lg bg-zinc-50 px-3 py-1.5 dark:bg-zinc-900">
            <Calendar className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
            <span className="font-black text-sm tabular-nums">
              {totalDaysWorked}
            </span>
          </div>
          <span className="font-bold text-[9px] text-zinc-500 uppercase tracking-wider dark:text-zinc-400">
            Total Active Days
          </span>
        </div>
      </div>

      <div className="space-y-4">
        {daysData.map((day) => {
          const pct = (day.count / maxCount) * 100;
          return (
            <div className="group flex items-center gap-3" key={day.label}>
              <span className="w-10 font-bold text-xs text-zinc-500 transition-colors group-hover:text-zinc-900 dark:text-zinc-400 dark:group-hover:text-zinc-50">
                {day.shortLabel}
              </span>
              <div className="relative h-4 flex-1 rounded-full bg-zinc-100 dark:bg-zinc-900">
                <div
                  className="h-full rounded-full bg-zinc-900 transition-all duration-500 ease-out dark:bg-zinc-50"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="w-14 text-right font-bold text-xs text-zinc-900 tabular-nums dark:text-zinc-100">
                {day.count} {day.count === 1 ? "shift" : "shifts"}
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
