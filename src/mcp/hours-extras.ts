import { computeEntryOvertime, isOvertimeEnabled } from "@/lib/overtime";
import { orgHasPlanFeature, TIME_OFF_FEATURE } from "@/lib/plan-features";
import {
  formatTimeOffDates,
  TIME_OFF_TYPE_LABELS,
  timeOffHoursInRange,
} from "@/lib/time-off-utils";
import type { TimeEntry, TimeOffRequest } from "@/lib/types";
import {
  dbGetBreakSettings,
  dbGetOvertimeSettings,
  dbGetTimeOffRequests,
} from "@/mcp/db";

/** Overtime and approved time off for one member over a period. */
export type HoursExtras = {
  /** Null when the organization tracks no overtime. */
  overtime_hours: number | null;
  regular_hours: number | null;
  time_off_hours: number;
  time_off: {
    request_id: number;
    type: TimeOffRequest["request_type"];
    type_label: string;
    dates: string;
    hours_in_period: number;
  }[];
};

const round = (n: number) => Number(n.toFixed(2));

/**
 * What the Hours view shows beside worked hours: overtime (by the org's
 * rules, net of unpaid breaks) and approved time off inside
 * [startDay, endDay] (YYYY-MM-DD). A failed lookup leaves that part out
 * rather than failing the whole timecard or report.
 */
export async function loadHoursExtras(
  orgId: string,
  entries: TimeEntry[],
  startDay: string,
  endDay: string,
  timezone: string,
): Promise<(userId: string) => HoursExtras> {
  const [overtimeSettings, breakSettings, requests] = await Promise.all([
    Promise.resolve()
      .then(() => dbGetOvertimeSettings(orgId))
      .catch(() => undefined),
    Promise.resolve()
      .then(() => dbGetBreakSettings(orgId))
      .catch(() => undefined),
    Promise.resolve()
      .then(() => orgHasPlanFeature(orgId, TIME_OFF_FEATURE))
      // Time off only counts on a plan that includes it, as in the app.
      .then((hasTimeOff) =>
        hasTimeOff ? dbGetTimeOffRequests(orgId, null, startDay) : [],
      )
      .catch(() => [] as TimeOffRequest[]),
  ]);

  const overtimeOn = isOvertimeEnabled(overtimeSettings);
  const overtimeByUser = new Map<
    string,
    { regular: number; overtime: number }
  >();
  if (overtimeOn) {
    const splits = computeEntryOvertime(
      entries,
      overtimeSettings,
      breakSettings ?? null,
      timezone,
    );
    for (const [entry, split] of splits) {
      const sum = overtimeByUser.get(entry.user_id) ?? {
        regular: 0,
        overtime: 0,
      };
      sum.regular += split.regularHours;
      sum.overtime += split.overtimeHours;
      overtimeByUser.set(entry.user_id, sum);
    }
  }

  const approved = (requests ?? []).filter(
    (r) =>
      r.status === "approved" &&
      r.start_date <= endDay &&
      r.end_date >= startDay,
  );

  return (userId) => {
    const timeOff = approved
      .filter((r) => r.user_id === userId)
      .map((r) => ({
        request_id: r.id,
        type: r.request_type,
        type_label: TIME_OFF_TYPE_LABELS[r.request_type],
        dates: formatTimeOffDates(r),
        hours_in_period: round(timeOffHoursInRange(r, startDay, endDay)),
      }));
    const ot = overtimeByUser.get(userId);
    return {
      overtime_hours: overtimeOn ? round(ot?.overtime ?? 0) : null,
      regular_hours: overtimeOn ? round(ot?.regular ?? 0) : null,
      time_off_hours: round(
        timeOff.reduce((sum, r) => sum + r.hours_in_period, 0),
      ),
      time_off: timeOff,
    };
  };
}

/** " (2h overtime, 8h vacation/sick time off)" or "". */
export function describeExtras(extras: HoursExtras) {
  const parts = [
    extras.overtime_hours ? `${extras.overtime_hours}h overtime` : null,
    extras.time_off_hours ? `${extras.time_off_hours}h time off` : null,
  ].filter(Boolean);
  return parts.length ? ` (${parts.join(", ")})` : "";
}
