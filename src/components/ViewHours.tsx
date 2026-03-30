"use client";

import {
  endOfDay,
  endOfMonth,
  endOfWeek,
  endOfYear,
  isWithinInterval,
  startOfDay,
  startOfMonth,
  startOfWeek,
  startOfYear,
  subMonths,
  subWeeks,
  subYears,
} from "date-fns";
import { use, useMemo, useState } from "react";
import type { TimeEntry } from "@/lib/dal";
import { EntryList } from "./ViewHours/EntryList";
import { HoursChart } from "./ViewHours/HoursChart";
import {
  TimeframeSelector,
  type TimeframeValue,
} from "./ViewHours/TimeframeSelector";

interface ViewHoursProps {
  entries: TimeEntry[];
  isAdmin?: boolean;
  membersPromise?: Promise<
    {
      id: string;
      name: string;
    }[]
  >;
  selectedUserIdPromise?: Promise<string | undefined>;
  currentUserId?: string;
}

export default function ViewHours({
  entries,
  isAdmin = false,
  membersPromise,
  selectedUserIdPromise,
  currentUserId,
}: ViewHoursProps) {
  const members = use(membersPromise || Promise.resolve([]));
  const selectedUserId = use(selectedUserIdPromise || Promise.resolve(""));
  // Determine default timeframe based on current data
  const defaultTimeframe = useMemo(() => {
    const start = startOfWeek(new Date(), { weekStartsOn: 1 });
    const end = endOfWeek(new Date(), { weekStartsOn: 1 });
    const hasEntriesInWeek = entries.some(
      (e) =>
        e.clock_out && isWithinInterval(new Date(e.clock_in), { start, end }),
    );
    return hasEntriesInWeek ? "week" : "all";
  }, [entries]);

  // View state
  const [timeframe, setTimeframe] = useState<TimeframeValue>(defaultTimeframe);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());

  // Derive available years from entries
  const availableYears = useMemo(() => {
    const years = new Set<number>();
    years.add(new Date().getFullYear());
    for (const e of entries) {
      years.add(new Date(e.clock_in).getFullYear());
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [entries]);

  // Filter entries based on timeframe
  const filteredEntries = useMemo(() => {
    let result = entries.filter((e) => e.clock_out); // Only completed shifts

    if (timeframe === "week") {
      const start = startOfWeek(new Date(), { weekStartsOn: 1 });
      const end = endOfWeek(new Date(), { weekStartsOn: 1 });
      result = result.filter((e) => {
        try {
          return isWithinInterval(new Date(e.clock_in), { start, end });
        } catch {
          return false;
        }
      });
    } else if (timeframe === "month") {
      const start = startOfMonth(new Date(selectedYear, selectedMonth, 1));
      const end = endOfMonth(new Date(selectedYear, selectedMonth, 1));
      result = result.filter((e) => {
        try {
          return isWithinInterval(new Date(e.clock_in), { start, end });
        } catch {
          return false;
        }
      });
    } else if (timeframe === "year") {
      const start = startOfYear(new Date(selectedYear, 0, 1));
      const end = endOfYear(new Date(selectedYear, 0, 1));
      result = result.filter((e) => {
        try {
          return isWithinInterval(new Date(e.clock_in), { start, end });
        } catch {
          return false;
        }
      });
    } else if (timeframe === "custom" && startDate && endDate) {
      const start = startOfDay(new Date(startDate));
      const end = endOfDay(new Date(endDate));
      result = result.filter((e) => {
        try {
          const d = new Date(e.clock_in);
          return isWithinInterval(d, { start, end });
        } catch {
          return false;
        }
      });
    }

    return result;
  }, [entries, timeframe, startDate, endDate, selectedYear, selectedMonth]);

  // Calculate previous period total hours for comparison
  const previousTotalHours = useMemo(() => {
    let prevStart: Date;
    let prevEnd: Date;

    if (timeframe === "week") {
      prevStart = subWeeks(startOfWeek(new Date(), { weekStartsOn: 1 }), 1);
      prevEnd = subWeeks(endOfWeek(new Date(), { weekStartsOn: 1 }), 1);
    } else if (timeframe === "month") {
      const currentMonth = new Date(selectedYear, selectedMonth, 1);
      prevStart = startOfMonth(subMonths(currentMonth, 1));
      prevEnd = endOfMonth(subMonths(currentMonth, 1));
    } else if (timeframe === "year") {
      const currentYear = new Date(selectedYear, 0, 1);
      prevStart = startOfYear(subYears(currentYear, 1));
      prevEnd = endOfYear(subYears(currentYear, 1));
    } else {
      return 0; // No comparison for custom or all
    }

    return entries
      .filter((e) => {
        try {
          return (
            e.clock_out &&
            isWithinInterval(new Date(e.clock_in), {
              start: prevStart,
              end: prevEnd,
            })
          );
        } catch {
          return false;
        }
      })
      .reduce((acc, e) => {
        const clockOutDate = e.clock_out ? new Date(e.clock_out) : null;
        if (!clockOutDate) return acc;
        const durationMs = clockOutDate.getTime() - new Date(e.clock_in).getTime();
        return acc + durationMs / (1000 * 60 * 60);
      }, 0);
  }, [entries, timeframe, selectedYear, selectedMonth]);

  return (
    <div className="space-y-6 pb-20">
      <TimeframeSelector
        timeframe={timeframe}
        setTimeframe={setTimeframe}
        startDate={startDate}
        setStartDate={setStartDate}
        endDate={endDate}
        setEndDate={setEndDate}
        selectedYear={selectedYear}
        setSelectedYear={setSelectedYear}
        selectedMonth={selectedMonth}
        setSelectedMonth={setSelectedMonth}
        availableYears={availableYears}
        isAdmin={isAdmin}
        members={members}
        selectedUserId={selectedUserId}
        currentUserId={currentUserId}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <HoursChart
          filteredEntries={filteredEntries}
          timeframe={timeframe}
          selectedYear={selectedYear}
          selectedMonth={selectedMonth}
          previousTotalHours={previousTotalHours}
        />
        <EntryList entries={filteredEntries} isAdmin={isAdmin} />
      </div>
    </div>
  );
}
