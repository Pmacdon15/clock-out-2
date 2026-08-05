"use client";

import { endOfMonth, format } from "date-fns";
import { Calendar, Users } from "lucide-react";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTimeframeDefaults } from "@/hooks/useTimeframeDefaults";
import { getMonthRange, getWeekRange, getYearRange } from "@/lib/date-utils";

export type TimeframeValue = "week" | "month" | "year" | "custom" | "all";

interface TimeframeSelectorProps {
  timeframe: TimeframeValue;
  startDate: string;
  endDate: string;
  availableYears: number[];
  isAdmin?: boolean;
  members?: { id: string; name: string }[];
  selectedUserId?: string;
  currentUserId?: string | null | undefined;
}

export function TimeframeSelector({
  timeframe,
  startDate,
  endDate,
  availableYears,
  isAdmin,
  members,
  selectedUserId,
  currentUserId,
}: TimeframeSelectorProps) {
  useTimeframeDefaults();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const updateParams = (updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }
    router.push(`${pathname}?${params.toString()}` as Route);
  };

  const handleMemberChange = (userId: string) => {
    updateParams({ userId: userId || null });
  };

  const currentStart = startDate ? new Date(startDate.includes('T') ? startDate : `${startDate}T00:00:00`) : new Date();
  const currentYear = currentStart.getFullYear();
  const currentMonth = currentStart.getMonth();
  const currentDate = currentStart.getDate();
  const currentWeek = Math.min(4, Math.ceil(currentDate / 7));

  const handleDropdownChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const [start, end] = e.target.value.split("|");
    updateParams({ start, end });
  };

  const handleTimeframeChange = (t: TimeframeValue) => {
    let start: string | undefined;
    let end: string | undefined;
    if (t === "week") {
      [start, end] = getWeekRange(currentYear, currentMonth, currentWeek).split(
        "|",
      );
    } else if (t === "month") {
      [start, end] = getMonthRange(currentYear, currentMonth).split("|");
    } else if (t === "year") {
      [start, end] = getYearRange(currentYear).split("|");
    }
    updateParams({ timeframe: t, ...(start && end ? { start, end } : {}) });
  };

  return (
    <div className="flex flex-col gap-6">
      {isAdmin && members && members.length > 0 && (
        <div className="relative mb-2 flex items-center gap-4 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 p-5 text-white shadow-xl">
          <div className="absolute top-0 right-0 p-3 opacity-10">
            <Users className="h-20 w-20 text-white" />
          </div>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-700 bg-zinc-800">
            <Users className="h-5 w-5 text-white" />
          </div>
          <div className="relative z-10 flex-1">
            <p className="mb-1.5 font-black text-[10px] text-zinc-500 uppercase tracking-[0.2em]">
              Administrative Control: Member Logs
            </p>
            <select
              className="w-full cursor-pointer appearance-none bg-transparent pr-8 font-bold text-lg text-white outline-none sm:w-auto"
              onChange={(e) => handleMemberChange(e.target.value)}
              value={selectedUserId || ""}
            >
              <option className="bg-zinc-900 text-white" value="">
                My Own Hours (Self)
              </option>
              <option
                className="bg-zinc-900 font-bold text-blue-400"
                value="all"
              >
                Entire Organization (All Members)
              </option>
              {members
                .filter((m) => m.id !== currentUserId)
                .map((m) => (
                  <option
                    className="bg-zinc-900 text-white"
                    key={m.id}
                    value={m.id}
                  >
                    {m.name}
                  </option>
                ))}
            </select>
          </div>
        </div>
      )}

      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex max-w-full overflow-x-auto rounded-lg bg-zinc-100 p-1 dark:bg-zinc-900">
          {(["week", "month", "year", "custom", "all"] as const).map((t) => (
            <button
              className={`whitespace-nowrap rounded-md px-4 py-1.5 font-semibold text-xs transition-all ${
                timeframe === t
                  ? "bg-white text-zinc-950 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                  : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
              }`}
              key={t}
              onClick={() => handleTimeframeChange(t)}
              type="button"
            >
              {t.toUpperCase()}
            </button>
          ))}
        </div>

        {timeframe === "custom" && (
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <input
              className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-zinc-400"
              defaultValue={startDate}
              name="start-date"
              onChange={(e) => updateParams({ start: e.target.value })}
              type="date"
            />
            <span className="text-zinc-400">to</span>
            <input
              className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-zinc-400"
              defaultValue={endDate}
              name="end-date"
              onChange={(e) => updateParams({ end: e.target.value })}
              type="date"
            />
          </div>
        )}

        {timeframe === "week" && (
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <Calendar className="h-4 w-4 text-zinc-400" />
            <select
              className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-zinc-400 dark:border-zinc-800 dark:bg-zinc-950"
              onChange={handleDropdownChange}
              value={getWeekRange(currentYear, currentMonth, currentWeek)}
            >
              {[1, 2, 3, 4].map((w) => (
                <option
                  key={w}
                  value={getWeekRange(currentYear, currentMonth, w)}
                >
                  Week {w}{" "}
                  {w === 4
                    ? `(24-${format(endOfMonth(new Date(currentYear, currentMonth, 1)), "d")})`
                    : `(${1 + (w - 1) * 7}-${w * 7})`}
                </option>
              ))}
            </select>
            <select
              className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-zinc-400 dark:border-zinc-800 dark:bg-zinc-950"
              onChange={handleDropdownChange}
              value={getWeekRange(currentYear, currentMonth, currentWeek)}
            >
              {Array.from({ length: 12 }).map((_, i) => {
                const monthName = format(new Date(2025, i, 1), "MMMM");
                return (
                  <option
                    key={monthName}
                    value={getWeekRange(currentYear, i, currentWeek)}
                  >
                    {monthName}
                  </option>
                );
              })}
            </select>
            <select
              className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-zinc-400 dark:border-zinc-800 dark:bg-zinc-950"
              onChange={handleDropdownChange}
              value={getWeekRange(currentYear, currentMonth, currentWeek)}
            >
              {availableYears.map((y) => (
                <option
                  key={y}
                  value={getWeekRange(y, currentMonth, currentWeek)}
                >
                  {y}
                </option>
              ))}
            </select>
          </div>
        )}

        {timeframe === "month" && (
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <Calendar className="h-4 w-4 text-zinc-400" />
            <select
              className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-zinc-400 dark:border-zinc-800 dark:bg-zinc-950"
              onChange={handleDropdownChange}
              value={getMonthRange(currentYear, currentMonth)}
            >
              {Array.from({ length: 12 }).map((_, i) => {
                const monthName = format(new Date(2025, i, 1), "MMMM");
                return (
                  <option key={monthName} value={getMonthRange(currentYear, i)}>
                    {monthName}
                  </option>
                );
              })}
            </select>
            <select
              className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-zinc-400 dark:border-zinc-800 dark:bg-zinc-950"
              onChange={handleDropdownChange}
              value={getMonthRange(currentYear, currentMonth)}
            >
              {availableYears.map((y) => (
                <option key={y} value={getMonthRange(y, currentMonth)}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        )}

        {timeframe === "year" && (
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <Calendar className="h-4 w-4 text-zinc-400" />
            <select
              className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-zinc-400 dark:border-zinc-800 dark:bg-zinc-950"
              onChange={handleDropdownChange}
              value={getYearRange(currentYear)}
            >
              {availableYears.map((y) => (
                <option key={y} value={getYearRange(y)}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  );
}
