"use client";

import { format } from "date-fns";
import { BarChart3, LineChart as LineIcon } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  autoGranularity,
  type ChartGranularity,
  type JobHours,
  jobChartRows,
} from "@/lib/jobs";
import { useIsClient } from "./LocalTime";
import { COLORS } from "./ViewHours/HoursLineChart";

/** One colour per member of a job, in the order of `job.members`. */
export function memberColor(index: number) {
  return COLORS[index % COLORS.length];
}

const GRANULARITIES: { value: ChartGranularity; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

const labelFor = (start: number, g: ChartGranularity) => {
  const d = new Date(start);
  if (g === "month") return format(d, "MMM yyyy");
  if (g === "week") return `Wk of ${format(d, "MMM d")}`;
  return format(d, "MMM d");
};

const fullLabelFor = (start: number, g: ChartGranularity) => {
  const d = new Date(start);
  if (g === "month") return format(d, "MMMM yyyy");
  if (g === "week") return `Week of ${format(d, "MMM d, yyyy")}`;
  return format(d, "EEE MMM d, yyyy");
};

const pill = (active: boolean) =>
  `rounded-md px-2 py-1 font-medium text-xs ${
    active
      ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-50"
      : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
  }`;

/**
 * Bar or line chart of one job's hours, one colour per member. Long ranges
 * group by week or month so a year doesn't turn into hundreds of bars; the
 * member chips hide or show each person's series.
 */
export default function JobsChart({ job }: { job: JobHours }) {
  const isClient = useIsClient();
  const [kind, setKind] = useState<"bar" | "line">("bar");
  const [granularity, setGranularity] = useState<ChartGranularity>(() =>
    autoGranularity(job.entries),
  );
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());

  const memberIds = useMemo(
    () => job.members.map((m) => m.userId),
    [job.members],
  );

  // Bucketing uses the browser's time zone, so it waits for the client.
  const rows = useMemo(
    () =>
      isClient
        ? jobChartRows(job.entries, memberIds, granularity).map((row) => ({
            ...row,
            name: labelFor(row.start, granularity),
            fullLabel: fullLabelFor(row.start, granularity),
          }))
        : [],
    [isClient, job.entries, memberIds, granularity],
  );

  if (job.entries.length === 0) return null;

  const toggleMember = (id: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < memberIds.length - 1) next.add(id);
      return next;
    });
  };

  const visible = job.members.filter((m) => !hidden.has(m.userId));
  const lastVisible = visible.at(-1)?.userId;
  const showChips = job.members.length > 1;

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <fieldset className="flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800">
          <legend className="sr-only">Chart type</legend>
          <button
            aria-pressed={kind === "bar"}
            className={pill(kind === "bar")}
            onClick={() => setKind("bar")}
            type="button"
          >
            <BarChart3 className="mr-1 inline h-3.5 w-3.5" />
            Bar
          </button>
          <button
            aria-pressed={kind === "line"}
            className={pill(kind === "line")}
            onClick={() => setKind("line")}
            type="button"
          >
            <LineIcon className="mr-1 inline h-3.5 w-3.5" />
            Line
          </button>
        </fieldset>
        <fieldset className="flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800">
          <legend className="sr-only">Group by</legend>
          {GRANULARITIES.map((g) => (
            <button
              aria-pressed={granularity === g.value}
              className={pill(granularity === g.value)}
              key={g.value}
              onClick={() => setGranularity(g.value)}
              type="button"
            >
              {g.label}
            </button>
          ))}
        </fieldset>
      </div>

      {showChips && (
        <fieldset className="flex flex-wrap gap-2">
          <legend className="sr-only">Members in chart</legend>
          {job.members.map((m, i) => {
            const on = !hidden.has(m.userId);
            return (
              <button
                aria-pressed={on}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs ${
                  on
                    ? "border-zinc-300 dark:border-zinc-600"
                    : "border-zinc-200 text-zinc-400 line-through dark:border-zinc-800"
                }`}
                key={m.userId}
                onClick={() => toggleMember(m.userId)}
                type="button"
              >
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 rounded-full"
                  style={{
                    backgroundColor: on ? memberColor(i) : "transparent",
                    border: `2px solid ${memberColor(i)}`,
                  }}
                />
                {m.name}
              </button>
            );
          })}
        </fieldset>
      )}

      <div className="h-64 w-full">
        <ResponsiveContainer height="100%" width="100%">
          {kind === "bar" ? (
            <BarChart
              data={rows}
              margin={{ top: 8, right: 8, left: -20, bottom: 0 }}
            >
              <CartesianGrid
                stroke="#e5e7eb"
                strokeDasharray="3 3"
                vertical={false}
              />
              <XAxis
                axisLine={false}
                dataKey="name"
                tick={{ fill: "#71717a", fontSize: 11 }}
                tickLine={false}
              />
              <YAxis
                axisLine={false}
                tick={{ fill: "#71717a", fontSize: 11 }}
                tickLine={false}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                cursor={{ fill: "rgba(0,0,0,0.05)" }}
                itemStyle={{ color: "#fff" }}
                labelFormatter={(value, payload) =>
                  payload[0]?.payload.fullLabel || value
                }
              />
              {job.members.map((m, i) => (
                <Bar
                  dataKey={m.userId}
                  fill={memberColor(i)}
                  hide={hidden.has(m.userId)}
                  key={m.userId}
                  name={m.name}
                  radius={lastVisible === m.userId ? [4, 4, 0, 0] : 0}
                  stackId="hours"
                />
              ))}
            </BarChart>
          ) : (
            <LineChart
              data={rows}
              margin={{ top: 8, right: 8, left: -20, bottom: 0 }}
            >
              <CartesianGrid
                stroke="#e5e7eb"
                strokeDasharray="3 3"
                vertical={false}
              />
              <XAxis
                axisLine={false}
                dataKey="name"
                tick={{ fill: "#71717a", fontSize: 11 }}
                tickLine={false}
              />
              <YAxis
                axisLine={false}
                tick={{ fill: "#71717a", fontSize: 11 }}
                tickLine={false}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                itemStyle={{ color: "#fff" }}
                labelFormatter={(value, payload) =>
                  payload[0]?.payload.fullLabel || value
                }
              />
              {job.members.map((m, i) => (
                <Line
                  activeDot={{ r: 5 }}
                  dataKey={m.userId}
                  dot={{ r: 3, fill: memberColor(i) }}
                  hide={hidden.has(m.userId)}
                  key={m.userId}
                  name={m.name}
                  stroke={memberColor(i)}
                  strokeWidth={2.5}
                  type="monotone"
                />
              ))}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

const tooltipStyle = {
  borderRadius: "12px",
  border: "none",
  boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1)",
  backgroundColor: "#18181b",
  color: "#fff",
};
