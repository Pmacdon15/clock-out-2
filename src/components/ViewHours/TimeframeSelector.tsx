"use client";

import { Calendar, Users } from "lucide-react";
import { format } from "date-fns";
import { useRouter, usePathname, useSearchParams } from "next/navigation";

export type TimeframeValue = "week" | "month" | "year" | "custom" | "all";

interface TimeframeSelectorProps {
  timeframe: TimeframeValue;
  setTimeframe: (t: TimeframeValue) => void;
  startDate: string;
  setStartDate: (s: string) => void;
  endDate: string;
  setEndDate: (s: string) => void;
  selectedYear: number;
  setSelectedYear: (y: number) => void;
  selectedMonth: number;
  setSelectedMonth: (m: number) => void;
  availableYears: number[];
  isAdmin?: boolean;
  members?: { id: string; name: string }[];
  selectedUserId?: string;
  currentUserId?: string;
}

export function TimeframeSelector({
  timeframe,
  setTimeframe,
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  selectedYear,
  setSelectedYear,
  selectedMonth,
  setSelectedMonth,
  availableYears,
  isAdmin,
  members,
  selectedUserId,
  currentUserId,
}: TimeframeSelectorProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleMemberChange = (userId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (userId) {
      params.set("userId", userId);
    } else {
      params.delete("userId");
    }
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="flex flex-col gap-6">
      {isAdmin && members && members.length > 0 && (
        <div className="flex items-center gap-4 p-5 bg-zinc-900 dark:bg-zinc-900 text-white rounded-2xl border border-zinc-800 shadow-xl overflow-hidden relative mb-2">
          <div className="absolute top-0 right-0 p-3 opacity-10">
            <Users className="h-20 w-20 text-white" />
          </div>
          <div className="h-10 w-10 rounded-xl bg-zinc-800 flex items-center justify-center flex-shrink-0 border border-zinc-700">
            <Users className="h-5 w-5 text-white" />
          </div>
          <div className="flex-1 relative z-10">
            <p className="text-[10px] uppercase font-black tracking-[0.2em] text-zinc-500 mb-1.5">
              Administrative Control: Member Logs
            </p>
            <select
              value={selectedUserId || ""}
              onChange={(e) => handleMemberChange(e.target.value)}
              className="w-full sm:w-auto bg-transparent text-lg font-bold outline-none cursor-pointer text-white appearance-none pr-8"
            >
              <option value="" className="bg-zinc-900 text-white">My Own Hours (Self)</option>
              {members
                .filter((m) => m.id !== currentUserId)
                .map((m) => (
                  <option 
                    key={m.id} 
                    value={m.id} 
                    className="bg-zinc-900 text-white"
                  >
                    {m.name}
                  </option>
                ))}
            </select>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex bg-zinc-100 dark:bg-zinc-900 p-1 rounded-lg overflow-x-auto max-w-full">
          {(["week", "month", "year", "custom", "all"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTimeframe(t)}
              className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-all whitespace-nowrap ${
                timeframe === t
                  ? "bg-white text-zinc-950 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                  : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
              }`}
            >
              {t.toUpperCase()}
            </button>
          ))}
        </div>

        {timeframe === "custom" && (
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-3 py-1.5 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs outline-none focus:ring-1 focus:ring-zinc-400"
            />
            <span className="text-zinc-400">to</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-3 py-1.5 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs outline-none focus:ring-1 focus:ring-zinc-400"
            />
          </div>
        )}

        {timeframe === "month" && (
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Calendar className="h-4 w-4 text-zinc-400" />
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(Number(e.target.value))}
              className="px-2 py-1.5 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs outline-none focus:ring-1 focus:ring-zinc-400"
            >
              {Array.from({ length: 12 }).map((_, i) => {
                const monthName = format(new Date(2025, i, 1), "MMMM");
                return (
                  <option key={monthName} value={i}>
                    {monthName}
                  </option>
                );
              })}
            </select>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="px-2 py-1.5 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs outline-none focus:ring-1 focus:ring-zinc-400"
            >
              {availableYears.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        )}

        {timeframe === "year" && (
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Calendar className="h-4 w-4 text-zinc-400" />
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="px-3 py-1.5 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs outline-none focus:ring-1 focus:ring-zinc-400"
            >
              {availableYears.map((y) => (
                <option key={y} value={y}>
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
