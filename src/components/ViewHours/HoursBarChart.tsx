"use client";

import { useAuth } from "@clerk/nextjs";
import { format, startOfDay } from "date-fns";
import { Download, Loader2, TrendingUp } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TimeEntry } from "@/lib/dal";
import { downloadElementAsImage } from "@/lib/download";
import { Button, Card } from "../ui";
import { COLORS } from "./HoursLineChart";

interface HoursBarChartProps {
  filteredEntries: TimeEntry[];
  timeframe: string;
  startDate: string;
  endDate: string;
  previousTotalHours: number;
  employeeName?: string;
  members?: { id: string; name: string }[];
  visibleMemberIds?: Set<string>;
  isViewingAll?: boolean;
}

export function HoursBarChart(props: HoursBarChartProps) {
  const { timeframe, startDate, endDate, employeeName } = props;
  const { has } = useAuth();
  const downloadRef = useRef<HTMLDivElement>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const canDownload = has({ feature: "download_graph" });

  const summaryText = useMemo(() => {
    if (!startDate) return timeframe;
    const start = new Date(startDate);

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
      return `${format(start, "MMM d, yyyy")} - ${endDate ? format(new Date(endDate), "MMM d, yyyy") : ""}`;
    }
    return timeframe;
  }, [timeframe, startDate, endDate]);

  const handleDownload = async () => {
    setIsDownloading(true);
    // Small delay to allow the hidden div to be rendered by React
    setTimeout(async () => {
      if (downloadRef.current) {
        const name =
          employeeName?.toLowerCase().replace(/\s+/g, "-") || "employee";
        const period = summaryText.toLowerCase().replace(/\s+/g, "-");
        const fileName = `hours-report-${name}-${period}`;
        await downloadElementAsImage(downloadRef.current, fileName);
      }
      setIsDownloading(false);
    }, 150);
  };

  return (
    <>
      <Card className="p-6 md:col-span-2">
        <HoursBarChartContent
          {...props}
          isDownloading={isDownloading}
          onDownload={canDownload ? handleDownload : undefined}
          summaryText={summaryText}
        />
      </Card>

      {/* Hidden desktop-sized version for download */}
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
            <HoursBarChartContent
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

function HoursBarChartContent({
  filteredEntries,
  employeeName,
  onDownload,
  isDownloading,
  isDownloadMode = false,
  summaryText,
  previousTotalHours,
  timeframe,
  members = [],
  visibleMemberIds,
  isViewingAll = false,
}: HoursBarChartProps & {
  onDownload?: () => void;
  isDownloading?: boolean;
  isDownloadMode?: boolean;
  summaryText: string;
}) {
  const chartData = useMemo(() => {
    const dataMap: Record<
      string,
      { date: Date; [key: string]: number | Date }
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

      if (isViewingAll) {
        const memberId = e.user_id;
        if (visibleMemberIds?.has(memberId)) {
          dataMap[dayKey][memberId] =
            ((dataMap[dayKey][memberId] as number) || 0) + hours;
        }
      } else {
        dataMap[dayKey].hours =
          ((dataMap[dayKey].hours as number) || 0) + hours;
      }
    });

    return Object.values(dataMap)
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .map((val) => {
        const row: Record<string, string | number> = {
          name: format(val.date, "MMM dd"),
          fullLabel: format(val.date, "MMM dd, yyyy"),
        };
        if (isViewingAll) {
          let dayTotal = 0;
          members.forEach((m) => {
            if (visibleMemberIds?.has(m.id)) {
              const h = parseFloat(((val[m.id] as number) || 0).toFixed(2));
              row[m.id] = h;
              dayTotal += h;
            }
          });
          row.total = parseFloat(dayTotal.toFixed(2));
        } else {
          row.hours = parseFloat(((val.hours as number) || 0).toFixed(2));
        }
        return row;
      });
  }, [filteredEntries, isViewingAll, visibleMemberIds, members]);

  const totalHours = useMemo(() => {
    if (isViewingAll) {
      return chartData.reduce(
        (acc, curr) => acc + ((curr.total as number) || 0),
        0,
      );
    }
    return chartData.reduce(
      (acc, curr) => acc + ((curr.hours as number) || 0),
      0,
    );
  }, [chartData, isViewingAll]);

  const percentage = useMemo(() => {
    if (previousTotalHours === 0) return null;
    return ((totalHours - previousTotalHours) / previousTotalHours) * 100;
  }, [totalHours, previousTotalHours]);

  const vsText = useMemo(() => {
    if (timeframe === "week") return "than last week";
    if (timeframe === "month") return "than last month";
    if (timeframe === "year") return "than last year";
    return "";
  }, [timeframe]);

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
                ? "Team Hours Summary"
                : `${employeeName || "Employee"}'s Hours`}
          </h3>

          {/* Timeframe Subtitle */}
          <p className="font-semibold text-xs text-zinc-500 dark:text-zinc-400">
            {summaryText}
          </p>

          {/* Metric (Total Hours) & Trend */}
          <div className="mt-2 flex items-end gap-2">
            <span
              className={`font-black text-3xl tracking-tight ${isDownloadMode ? "text-zinc-900" : "text-zinc-900 dark:text-zinc-100"}`}
            >
              {totalHours.toFixed(2)}h
            </span>
            <span className="mb-1 font-bold text-[10px] text-zinc-400 uppercase tracking-wider dark:text-zinc-500">
              Total Logged
            </span>
            {percentage !== null && !isDownloadMode && (
              <span
                className={`mb-1 flex items-center gap-0.5 font-bold text-xs ${
                  percentage >= 0 ? "text-green-500" : "text-red-500"
                }`}
              >
                <TrendingUp
                  className={`h-3 w-3 ${percentage < 0 ? "rotate-180" : ""}`}
                />
                {Math.abs(percentage).toFixed(0)}%{" "}
                {percentage >= 0 ? "more" : "less"} {vsText}
              </span>
            )}
          </div>

          {/* Explanation paragraph */}
          {!isDownloadMode && (
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {isViewingAll
                ? "Stacked breakdown of total hours logged by all active team members per day."
                : "Daily logged work hours for the selected timeframe."}
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

      <div
        className={
          isDownloadMode ? "mt-4 h-[400px] w-full" : "mt-4 h-[300px] w-full"
        }
      >
        <ResponsiveContainer height="100%" width="100%">
          <BarChart
            data={chartData}
            margin={
              isDownloadMode
                ? { top: 20, right: 30, left: 0, bottom: 20 }
                : { top: 0, right: 0, left: -20, bottom: 0 }
            }
          >
            <CartesianGrid
              stroke="#e5e7eb"
              strokeDasharray="3 3"
              vertical={false}
            />
            <XAxis
              axisLine={false}
              dataKey="name"
              dy={10}
              tick={{ fill: "#71717a", fontSize: 12 }}
              tickLine={false}
            />
            <YAxis
              axisLine={false}
              tick={{ fill: "#71717a", fontSize: 12 }}
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
                cursor={{ fill: "rgba(0,0,0,0.05)" }}
                itemStyle={{ color: "#fff" }}
                labelFormatter={(value, payload) =>
                  payload[0]?.payload.fullLabel || value
                }
                labelStyle={{
                  fontWeight: "bold",
                  marginBottom: "4px",
                }}
              />
            )}

            {isViewingAll ? (
              members.map((m, index) => {
                const visibleMembers = members.filter((member) =>
                  visibleMemberIds?.has(member.id),
                );
                const isLast = visibleMembers.at(-1)?.id === m.id;
                return (
                  <Bar
                    dataKey={m.id}
                    fill={COLORS[index % COLORS.length]}
                    hide={!visibleMemberIds?.has(m.id)}
                    isAnimationActive={!isDownloadMode}
                    key={m.id}
                    name={m.name}
                    radius={isLast ? [6, 6, 0, 0] : 0}
                    stackId="a"
                  />
                );
              })
            ) : (
              <Bar
                barSize={32}
                dataKey="hours"
                fill={isDownloadMode ? "#2563eb" : "#18181b"}
                isAnimationActive={!isDownloadMode}
                radius={[6, 6, 0, 0]}
              >
                {isDownloadMode && (
                  <LabelList
                    dataKey="hours"
                    position="top"
                    style={{
                      fill: "#71717a",
                      fontSize: 10,
                      fontWeight: "bold",
                    }}
                  />
                )}
                {chartData.map((d, _index) => (
                  <Cell
                    className={
                      isDownloadMode
                        ? "fill-blue-600"
                        : "fill-zinc-900 dark:fill-zinc-50"
                    }
                    key={`cell-${JSON.stringify(d)}`}
                  />
                ))}
              </Bar>
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {isDownloadMode && (
        <div className="mt-12 border-zinc-200 border-t pt-8">
          <h4 className="mb-6 flex items-center gap-2 font-bold text-lg text-zinc-900">
            Detailed Entry Log
            <span className="rounded bg-zinc-100 px-2 py-0.5 font-medium text-xs text-zinc-500">
              {filteredEntries.length} entries
            </span>
          </h4>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-zinc-200 border-b text-left">
                <th className="pb-3 font-bold text-[10px] text-zinc-400 uppercase tracking-wider">
                  Date
                </th>
                {isViewingAll && (
                  <th className="pb-3 font-bold text-[10px] text-zinc-400 uppercase tracking-wider">
                    Member
                  </th>
                )}
                <th className="pb-3 font-bold text-[10px] text-zinc-400 uppercase tracking-wider">
                  Clock In
                </th>
                <th className="pb-3 font-bold text-[10px] text-zinc-400 uppercase tracking-wider">
                  Clock Out
                </th>
                <th className="pb-3 text-right font-bold text-[10px] text-zinc-400 uppercase tracking-wider">
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
                        {format(clockIn, "eee, MMM d, yyyy")}
                      </td>
                      {isViewingAll && (
                        <td className="py-3 text-zinc-500">
                          {member?.name || "Unknown"}
                        </td>
                      )}
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
          <div className="mt-8 flex justify-end border-zinc-100 border-t pt-6">
            <div className="text-right">
              <span className="mb-1 block font-bold text-[10px] text-zinc-400 uppercase tracking-widest">
                Total Hours for Period
              </span>
              <span className="font-black text-2xl text-zinc-900">
                {totalHours.toFixed(2)}h
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
