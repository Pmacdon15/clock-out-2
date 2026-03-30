"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { format, parse } from "date-fns";
import { TrendingUp } from "lucide-react";
import { Card } from "../ui";
import type { TimeEntry } from "@/lib/dal";

interface HoursChartProps {
  filteredEntries: TimeEntry[];
  timeframe: string;
  selectedYear: number;
  selectedMonth: number;
  previousTotalHours: number;
}

export function HoursChart({
  filteredEntries,
  timeframe,
  selectedYear,
  selectedMonth,
  previousTotalHours,
}: HoursChartProps) {
  const chartData = useMemo(() => {
    const dataMap: Record<string, number> = {};

    filteredEntries.forEach((e) => {
      const dateStr = format(new Date(e.clock_in), "MMM dd");
      const durationMs = e.clock_out
        ? new Date(e.clock_out).getTime() - new Date(e.clock_in).getTime()
        : 0;
      const hours = durationMs / (1000 * 60 * 60);
      dataMap[dateStr] = (dataMap[dateStr] || 0) + hours;
    });

    // Sort chronologically (Past -> Present) so most recent is on the right
    return Object.entries(dataMap)
      .map(([name, hours]) => ({
        name,
        hours: parseFloat(hours.toFixed(2)),
        // Helper date for sorting
        sortDate: parse(name, "MMM dd", new Date(selectedYear, selectedMonth, 1)),
      }))
      .sort((a, b) => a.sortDate.getTime() - b.sortDate.getTime());
  }, [filteredEntries, selectedYear, selectedMonth]);

  const totalHours = useMemo(
    () => chartData.reduce((acc, curr) => acc + curr.hours, 0),
    [chartData]
  );

  const summaryText = useMemo(() => {
    if (timeframe === "month") {
      return `${format(new Date(selectedYear, selectedMonth, 1), "MMMM")} ${selectedYear}`;
    }
    if (timeframe === "year") {
      return `${selectedYear}`;
    }
    return timeframe;
  }, [timeframe, selectedYear, selectedMonth]);

  const percentage = useMemo(() => {
    if (previousTotalHours === 0) return null;
    return ((totalHours - previousTotalHours) / previousTotalHours) * 100;
  }, [totalHours, previousTotalHours]);

  const vsText = useMemo(() => {
    if (timeframe === "week") return "vs last week";
    if (timeframe === "month") return "vs last month";
    if (timeframe === "year") return "vs last year";
    return "";
  }, [timeframe]);

  return (
    <Card className="p-6 md:col-span-2">
      <div className="flex flex-col gap-1 mb-8">
        <h3 className="text-sm font-medium text-zinc-500">
          Summary hours for {summaryText}
        </h3>
        <div className="flex items-end gap-2">
          <span className="text-3xl font-black">{totalHours.toFixed(1)}h</span>
          {percentage !== null && (
            <span
              className={`text-xs font-bold mb-1 flex items-center gap-0.5 ${
                percentage >= 0 ? "text-green-500" : "text-red-500"
              }`}
            >
              <TrendingUp
                className={`h-3 w-3 ${percentage < 0 ? "rotate-180" : ""}`}
              />
              {Math.abs(percentage).toFixed(0)}% {vsText}
            </span>
          )}
        </div>
      </div>

      <div className="h-[300px] w-full mt-4">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            margin={{ top: 0, right: 0, left: -20, bottom: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke="#e5e7eb"
            />
            <XAxis
              dataKey="name"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#71717a", fontSize: 12 }}
              dy={10}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#71717a", fontSize: 12 }}
            />
            <Tooltip
              cursor={{ fill: "rgba(0,0,0,0.05)" }}
              contentStyle={{
                borderRadius: "12px",
                border: "none",
                boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1)",
                backgroundColor: "#18181b",
                color: "#fff",
              }}
              itemStyle={{ color: "#fff" }}
            />
            <Bar
              dataKey="hours"
              fill="#18181b"
              radius={[4, 4, 0, 0]}
              barSize={32}
            >
              {chartData.map((d) => (
                <Cell key={d.name} className="fill-zinc-900 dark:fill-zinc-50" />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
