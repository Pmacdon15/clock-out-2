"use client";

import { useMemo, useState } from "react";
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
} from "date-fns";
import type { TimeEntry } from "@/lib/dal";
import { TimeframeSelector, type TimeframeValue } from "./ViewHours/TimeframeSelector";
import { HoursChart } from "./ViewHours/HoursChart";
import { EntryList } from "./ViewHours/EntryList";

interface ViewHoursProps {
  entries: TimeEntry[];
}

export default function ViewHours({ entries }: ViewHoursProps) {
  // Determine default timeframe based on current data
  const defaultTimeframe = useMemo(() => {
    const start = startOfWeek(new Date(), { weekStartsOn: 1 });
    const end = endOfWeek(new Date(), { weekStartsOn: 1 });
    const hasEntriesInWeek = entries.some(
      (e) => e.clock_out && isWithinInterval(new Date(e.clock_in), { start, end })
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
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <HoursChart
          filteredEntries={filteredEntries}
          timeframe={timeframe}
          selectedYear={selectedYear}
          selectedMonth={selectedMonth}
        />
        <EntryList entries={filteredEntries} />
      </div>
    </div>
  );
}
