"use client";

import { format, startOfDay } from "date-fns";
import { Coffee, DollarSign, Timer, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import { breakTypeLabel } from "@/lib/break-utils";
import {
  formatDuration,
  type LiveDashboardData,
  summarizeLive,
} from "@/lib/live-dashboard";
import { formatMoney } from "@/lib/pay";
import type { SerializableResult } from "@/lib/types";
import { LiveDashboardFallback } from "./fallbacks/live-dashboard-fallback";
import { Button, Card } from "./ui";

/** How often running totals tick forward, without asking the server. */
export const TICK_MS = 30_000;
/** How often fresh punches are fetched from the server. */
export const REFRESH_MS = 60_000;

function Stat({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        {icon}
        <span>{label}</span>
      </div>
      <p className="mt-2 font-semibold text-2xl tabular-nums">{value}</p>
      <p className="mt-1 text-muted-foreground text-xs">{detail}</p>
    </Card>
  );
}

/**
 * The admin's live view of the organization: who's on the clock now, a
 * headcount, and today's hours and labour cost so far. Totals tick forward
 * every 30 seconds in the browser and fresh punches are fetched every
 * minute (and whenever the tab comes back into view).
 */
export default function LiveDashboard({
  dataPromise,
}: {
  dataPromise: Promise<
    SerializableResult<LiveDashboardData, { reason: string }>
  >;
}) {
  const result = use(dataPromise);
  const router = useRouter();
  // Null until mounted: "today" and "now" are the viewer's, not the server's.
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [updatedAt, setUpdatedAt] = useState(Date.now);

  // A new result means the server sent fresh data.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-stamp on each new result
  useEffect(() => {
    const now = Date.now();
    setNowMs(now);
    setUpdatedAt(now);
  }, [result]);

  useEffect(() => {
    const tick = setInterval(() => setNowMs(Date.now()), TICK_MS);
    const refresh = setInterval(() => router.refresh(), REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(tick);
      clearInterval(refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  if (!result.ok) {
    return (
      <Card className="p-8 text-center text-muted-foreground">
        {result.error.reason}
      </Card>
    );
  }

  if (nowMs === null) return <LiveDashboardFallback />;

  const summary = summarizeLive(
    result.value,
    nowMs,
    startOfDay(new Date(nowMs)).getTime(),
  );
  const { headcount, today, working } = summary;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold text-xl">Live dashboard</h3>
          <p className="text-muted-foreground text-sm">
            {`Updated ${format(new Date(updatedAt), "h:mm a")} · refreshes every minute`}
          </p>
        </div>
        <Button onClick={() => router.refresh()} size="sm" variant="outline">
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          detail={`of ${headcount.members} member${headcount.members === 1 ? "" : "s"}`}
          icon={<Users aria-hidden className="h-4 w-4" />}
          label="On the clock"
          value={String(headcount.onClock)}
        />
        <Stat
          detail={`${headcount.off} off the clock`}
          icon={<Coffee aria-hidden className="h-4 w-4" />}
          label="On break"
          value={String(headcount.onBreak)}
        />
        <Stat
          detail="Net of breaks"
          icon={<Timer aria-hidden className="h-4 w-4" />}
          label="Hours today"
          value={formatDuration(today.hours)}
        />
        <Stat
          detail="At base rates, before overtime"
          icon={<DollarSign aria-hidden className="h-4 w-4" />}
          label="Labour cost today"
          value={formatMoney(today.cost)}
        />
      </div>

      {today.unratedMembers.length > 0 ? (
        <p className="rounded-md bg-amber-50 p-3 text-amber-900 text-sm dark:bg-amber-950 dark:text-amber-200">
          {`${formatDuration(today.unratedHours)} today isn't costed: no pay rate for ${today.unratedMembers.join(", ")}. Set rates under Settings → Pay rates.`}
        </p>
      ) : null}

      <Card className="p-4 sm:p-6">
        <h4 className="mb-4 font-semibold">Who's working now</h4>
        {working.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nobody is on the clock right now.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {working.map((w) => (
              <li
                className="flex flex-wrap items-center justify-between gap-2 py-3"
                key={`${w.userId}-${w.clockIn.getTime()}`}
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{w.name}</p>
                  <p className="text-muted-foreground text-xs">
                    {`In since ${format(w.clockIn, "h:mm a")}`}
                    {w.siteName ? ` · ${w.siteName}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  {w.breakType ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-900 text-xs dark:bg-amber-900 dark:text-amber-100">
                      {breakTypeLabel(w.breakType)}
                    </span>
                  ) : (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-900 text-xs dark:bg-emerald-900 dark:text-emerald-100">
                      Working
                    </span>
                  )}
                  <span className="tabular-nums">
                    {formatDuration(w.shiftHours)}
                  </span>
                  {w.hourlyRate === null ? null : (
                    <span className="text-muted-foreground tabular-nums">
                      {`${formatMoney(w.hourlyRate)}/h`}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
