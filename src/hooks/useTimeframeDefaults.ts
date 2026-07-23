"use client";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { getMonthRange, getWeekRange, getYearRange } from "@/lib/date-utils";

export function useTimeframeDefaults() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    let changed = false;
    const params = new URLSearchParams(searchParams.toString());

    if (!params.get("timezone")) {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      params.set("timezone", tz);
      changed = true;
    }

    if (
      !params.get("timeframe") ||
      !params.get("start") ||
      !params.get("end")
    ) {
      const targetTimeframe = params.get("timeframe") || "week";
      params.set("timeframe", targetTimeframe);

      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth();
      const week = Math.min(4, Math.ceil(now.getDate() / 7));

      let start: string | undefined, end: string | undefined;
      if (targetTimeframe === "week") {
        [start, end] = getWeekRange(year, month, week).split("|");
      } else if (targetTimeframe === "month") {
        [start, end] = getMonthRange(year, month).split("|");
      } else if (targetTimeframe === "year") {
        [start, end] = getYearRange(year).split("|");
      }

      if (start && end) {
        params.set("start", start);
        params.set("end", end);
      }
      changed = true;
    }

    if (changed) {
      router.replace(`${pathname}?${params.toString()}` as Route, {
        scroll: false,
      });
    }
  }, [searchParams, pathname, router]);
}
