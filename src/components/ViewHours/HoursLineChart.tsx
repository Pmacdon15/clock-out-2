"use client";

import { useAuth } from "@clerk/nextjs";
import { format, startOfDay } from "date-fns";
import { Download, Loader2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TimeEntry } from "@/lib/dal";
import { downloadElementAsImage } from "@/lib/download";
import { Button, Card } from "../ui";

interface HoursLineChartProps {
  filteredEntries: TimeEntry[];
  members: { id: string; name: string }[];
  visibleMemberIds: Set<string>;
  timeframe?: string;
  startDate?: string;
  endDate?: string;
  isViewingAll?: boolean;
  employeeName?: string;
}

export const COLORS = [
  "#3b82f6", // blue-500
  "#22c55e", // green-500
  "#ef4444", // red-500
  "#eab308", // yellow-500
  "#a855f7", // purple-500
  "#06b6d4", // cyan-500
  "#f97316", // orange-500
  "#ec4899", // pink-500
  "#6366f1", // indigo-500
  "#10b981", // emerald-500
];

export function HoursLineChart(props: HoursLineChartProps) {
  const { timeframe, startDate, endDate } = props;
  const { has } = useAuth();
  const downloadRef = useRef<HTMLDivElement>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const canDownload = has?.({ feature: "download_graph" });

  const summaryText = useMemo(() => {
    if (!startDate) return timeframe || "custom";
    const start = new Date(startDate.includes('T') ? startDate : `${startDate}T00:00:00`);

    if (timeframe === "week") {
      const date = start.getDate();
      const weekNum = Math.min(4, Math.ceil(date / 7));
      const monthName = format(start, "MMMM");
      const year = start.getFullYear();
      return `Week ${weekNum} - ${monthName} ${year}`;
    }
    if (timeframe === "month") {
      return format(start, "MMMM yyyy");
    }
    if (timeframe === "year") {
      return format(start, "yyyy");
    }
    if (timeframe === "custom") {
      return `${format(start, "MMM d, yyyy")} - ${endDate ? format(new Date(endDate.includes('T') ? endDate : `${endDate}T00:00:00`), "MMM d, yyyy") : ""}`;
    }
    return timeframe || "custom";
  }, [timeframe, startDate, endDate]);

  const handleDownload = async () => {
    setIsDownloading(true);
    setTimeout(async () => {
      if (downloadRef.current) {
        const period = summaryText.toLowerCase().replace(/\s+/g, "-");
        await downloadElementAsImage(
          downloadRef.current,
          `org-hours-report-${period}`,
        );
      }
      setIsDownloading(false);
    }, 150);
  };

  return (
    <>
      {/* On-screen version matches the bar graph style */}
      <Card className="p-6">
        <HoursLineChartContent
          {...props}
          isDownloading={isDownloading}
          onDownload={canDownload ? handleDownload : undefined}
          summaryText={summaryText}
        />
      </Card>

      {/* Hidden desktop-sized version for download (Light Mode) */}
      {isDownloading && (
        <div
          style={{
            position: "fixed",
            left: "-9999px",
            top: 0,
            width: "1200px",
            zIndex: -1,
          }}
        >
          <div
            className="rounded-xl border border-zinc-200 bg-white p-12 text-zinc-950"
            ref={downloadRef}
          >
            <HoursLineChartContent
              {...props}
              isDownloadMode
              summaryText={summaryText}
            />
          </div>
        </div>
      )}
    </>
  );
}

function HoursLineChartContent({
  filteredEntries,
  members,
  visibleMemberIds,
  onDownload,
  isDownloading,
  isDownloadMode = false,
  summaryText,
  isViewingAll = false,
  employeeName,
}: HoursLineChartProps & {
  onDownload?: () => void;
  isDownloading?: boolean;
  isDownloadMode?: boolean;
  summaryText: string;
}) {
  const chartData = useMemo(() => {
    const dataMap: Record<
      string,
      { date: Date; [userId: string]: number | Date }
    > = {};

    filteredEntries.forEach((e) => {
      const clockIn = new Date(e.clock_in);
      const dayKey = startOfDay(clockIn).toISOString();
      const durationMs = e.clock_out
        ? new Date(e.clock_out).getTime() - clockIn.getTime()
        : Date.now() - clockIn.getTime();
      const hours = Math.max(0, durationMs / (1000 * 60 * 60));

      if (!dataMap[dayKey]) {
        dataMap[dayKey] = { date: clockIn };
      }

      if (!dataMap[dayKey][e.user_id]) {
        dataMap[dayKey][e.user_id] = 0;
      }
      dataMap[dayKey][e.user_id] =
        ((dataMap[dayKey][e.user_id] as number) || 0) + hours;
    });

    return Object.values(dataMap)
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .map((val) => {
        const entry: Record<string, string | number> = {
          name: format(val.date, "MMM dd"),
          fullLabel: format(val.date, "MMM dd, yyyy"),
        };
        for (const member of members) {
          if (val[member.id] !== undefined) {
            entry[member.id] = parseFloat(
              ((val[member.id] as number) || 0).toFixed(2),
            );
          } else {
            entry[member.id] = 0;
          }
        }
        return entry;
      });
  }, [filteredEntries, members]);

  const totalOrgHours = useMemo(() => {
    return filteredEntries.reduce((acc, e) => {
      const clockIn = new Date(e.clock_in);
      const durationMs = e.clock_out
        ? new Date(e.clock_out).getTime() - clockIn.getTime()
        : Date.now() - clockIn.getTime();
      return acc + Math.max(0, durationMs / (1000 * 60 * 60));
    }, 0);
  }, [filteredEntries]);

  const memberBreakdown = useMemo(() => {
    const breakdown: Record<string, number> = {};
    filteredEntries.forEach((e) => {
      const clockIn = new Date(e.clock_in);
      const durationMs = e.clock_out
        ? new Date(e.clock_out).getTime() - clockIn.getTime()
        : Date.now() - clockIn.getTime();
      const hours = Math.max(0, durationMs / (1000 * 60 * 60));
      breakdown[e.user_id] = (breakdown[e.user_id] || 0) + hours;
    });
    return breakdown;
  }, [filteredEntries]);

  // Theme variables for the chart itself
  // In app: use zinc-400 for ticks/grid to look good in both themes
  // In download: use zinc-900/zinc-200
  const textColor = isDownloadMode ? "#18181b" : "#71717a";
  const gridColor = isDownloadMode ? "#e5e7eb" : "#3f3f46";

  return (
    <>
      <div className="mb-8 flex items-start justify-between">
        <div className="flex flex-col gap-1">
          {/* Uppercase Category Label */}
          <span className="font-bold text-[10px] text-zinc-500 uppercase tracking-widest dark:text-zinc-400">
            {isViewingAll ? "Organization Hours" : "Individual Hours"}
          </span>

          {/* Main Title */}
          <h3
            className={`font-black text-xl tracking-tight ${isDownloadMode ? "text-zinc-900" : "text-zinc-900 dark:text-zinc-100"}`}
          >
            {isDownloadMode
              ? isViewingAll
                ? `Organization Hours Report: ${summaryText}`
                : `${employeeName || "Employee"} Hours Report: ${summaryText}`
              : isViewingAll
                ? "Team Hours Over Time"
                : `${employeeName || "Employee"}'s Hours`}
          </h3>

          {/* Timeframe Subtitle */}
          <p className="font-semibold text-xs text-zinc-500 dark:text-zinc-400">
            {summaryText}
          </p>

          {/* Metric (Total Hours) */}
          <div className="mt-2 flex items-end gap-2">
            <span
              className={`font-black text-3xl tracking-tight ${isDownloadMode ? "text-zinc-900" : "text-zinc-900 dark:text-zinc-100"}`}
            >
              {totalOrgHours.toFixed(2)}h
            </span>
            <span className="mb-1 font-bold text-[10px] text-zinc-400 uppercase tracking-wider dark:text-zinc-500">
              Total Logged
            </span>
          </div>

          {/* Explanation paragraph */}
          {!isDownloadMode && (
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {isViewingAll
                ? "Comparative timeline showing daily hours logged by each team member."
                : "Daily progression of logged hours over this period."}
            </p>
          )}
        </div>

        {onDownload && (
          <Button
            className="h-8 w-8 p-0"
            disabled={isDownloading}
            onClick={onDownload}
            variant="outline"
          >
            {isDownloading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            <span className="sr-only">Download graph</span>
          </Button>
        )}
      </div>

      <div className={isDownloadMode ? "h-[450px] w-full" : "h-[400px] w-full"}>
        <ResponsiveContainer height="100%" width="100%">
          <LineChart
            data={chartData}
            margin={
              isDownloadMode
                ? { top: 10, right: 30, left: 0, bottom: 20 }
                : { top: 5, right: 30, left: -20, bottom: 5 }
            }
          >
            <CartesianGrid
              stroke={gridColor}
              strokeDasharray="3 3"
              vertical={false}
            />
            <XAxis
              axisLine={false}
              dataKey="name"
              dy={10}
              tick={{ fill: textColor, fontSize: 12 }}
              tickLine={false}
            />
            <YAxis
              axisLine={false}
              tick={{ fill: textColor, fontSize: 12 }}
              tickLine={false}
            />
            {!isDownloadMode && (
              <Tooltip
                contentStyle={{
                  borderRadius: "12px",
                  border: "none",
                  boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1)",
                  backgroundColor: "#18181b",
                  color: "#fff",
                }}
                itemStyle={{ color: "#fff", fontSize: "12px" }}
                labelFormatter={(value, payload) =>
                  payload[0]?.payload.fullLabel || value
                }
                labelStyle={{
                  fontWeight: "bold",
                  marginBottom: "4px",
                }}
              />
            )}
            <Legend
              align="right"
              iconType="circle"
              layout="horizontal"
              verticalAlign="top"
              wrapperStyle={{
                paddingBottom: "20px",
                fontSize: "12px",
                color: textColor,
              }}
            />
            {members.map((member, index) => (
              <Line
                activeDot={{ r: 6, strokeWidth: 0 }}
                connectNulls
                dataKey={member.id}
                dot={{
                  r: 4,
                  strokeWidth: 0,
                  fill: COLORS[index % COLORS.length],
                }}
                hide={!visibleMemberIds.has(member.id)}
                isAnimationActive={!isDownloadMode}
                key={member.id}
                name={member.name}
                stroke={COLORS[index % COLORS.length]}
                strokeWidth={3}
                type="monotone"
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {isDownloadMode && (
        <div className="mt-12 space-y-12">
          <div className="border-zinc-200 border-t pt-8">
            <h4 className="mb-6 font-bold text-lg text-zinc-900">
              Employee Breakdown
            </h4>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-zinc-200 border-b text-left">
                  <th className="pb-3 font-bold text-[10px] text-zinc-400 uppercase">
                    Employee
                  </th>
                  <th className="pb-3 text-right font-bold text-[10px] text-zinc-400 uppercase">
                    Total Hours
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {members
                  .filter((m) => memberBreakdown[m.id])
                  .map((member, index) => (
                    <tr key={member.id}>
                      <td className="py-3 font-medium text-zinc-900">
                        <div className="flex items-center gap-2">
                          <div
                            className="h-2 w-2 rounded-full"
                            style={{
                              backgroundColor: COLORS[index % COLORS.length],
                            }}
                          />
                          {member.name}
                        </div>
                      </td>
                      <td className="py-3 text-right font-bold text-zinc-900 tabular-nums">
                        {(memberBreakdown[member.id] || 0).toFixed(2)}h
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          <div className="border-zinc-200 border-t pt-8">
            <h4 className="mb-6 flex items-center gap-2 font-bold text-lg text-zinc-900">
              Detailed Organization Log
              <span className="rounded bg-zinc-100 px-2 py-0.5 font-medium text-xs text-zinc-500">
                {filteredEntries.length} entries
              </span>
            </h4>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-zinc-200 border-b text-left">
                  <th className="pb-3 font-bold text-[10px] text-zinc-400 uppercase">
                    Date
                  </th>
                  <th className="pb-3 font-bold text-[10px] text-zinc-400 uppercase">
                    Employee
                  </th>
                  <th className="pb-3 font-bold text-[10px] text-zinc-400 uppercase">
                    Clock In
                  </th>
                  <th className="pb-3 font-bold text-[10px] text-zinc-400 uppercase">
                    Clock Out
                  </th>
                  <th className="pb-3 text-right font-bold text-[10px] text-zinc-400 uppercase">
                    Hours
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {filteredEntries
                  .sort(
                    (a, b) =>
                      new Date(b.clock_in).getTime() -
                      new Date(a.clock_in).getTime(),
                  )
                  .map((e) => {
                    const clockIn = new Date(e.clock_in);
                    const clockOut = e.clock_out ? new Date(e.clock_out) : null;
                    const durationMs = clockOut
                      ? clockOut.getTime() - clockIn.getTime()
                      : Date.now() - clockIn.getTime();
                    const hours = Math.max(0, durationMs / (1000 * 60 * 60));
                    const member = members.find((m) => m.id === e.user_id);

                    return (
                      <tr key={e.id}>
                        <td className="py-3 font-medium text-zinc-900">
                          {format(clockIn, "MMM d, yyyy")}
                        </td>
                        <td className="py-3 text-zinc-500">
                          {member?.name || "Unknown"}
                        </td>
                        <td className="py-3 text-zinc-500">
                          {format(clockIn, "hh:mm a")}
                        </td>
                        <td className="py-3 text-zinc-500">
                          {clockOut ? (
                            format(clockOut, "hh:mm a")
                          ) : (
                            <span className="font-medium text-blue-500 italic">
                              Active
                            </span>
                          )}
                        </td>
                        <td className="py-3 text-right font-bold text-zinc-900 tabular-nums">
                          {hours.toFixed(2)}h
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
