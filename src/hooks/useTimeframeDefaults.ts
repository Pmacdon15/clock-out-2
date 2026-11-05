"use client";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { getMonthRange, getWeekRange, getYearRange } from "@/lib/date-utils";
import {
  getPayPeriod,
  isPayPeriodEnabled,
  payPeriodRangeValue,
} from "@/lib/pay-period";
import type { PayPeriodSettingsData } from "@/lib/types";

/**
 * Fills in the timezone and Hours range params when they're missing. The
 * range defaults to the current pay period when the org has pay periods on,
 * otherwise the current week.
 */
export function useTimeframeDefaults(
  payPeriodSettings?: PayPeriodSettingsData | null,
) {
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
      const payPeriods = isPayPeriodEnabled(payPeriodSettings)
        ? payPeriodSettings
        : null;
      const requested = params.get("timeframe");
      const targetTimeframe =
        requested === "pay-period" && !payPeriods
          ? "week"
          : requested || (payPeriods ? "pay-period" : "week");
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
      } else if (targetTimeframe === "pay-period" && payPeriods) {
        [start, end] = payPeriodRangeValue(getPayPeriod(payPeriods, now)).split(
          "|",
        );
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
  }, [searchParams, pathname, router, payPeriodSettings]);
}
