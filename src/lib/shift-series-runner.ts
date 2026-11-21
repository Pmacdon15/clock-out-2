import { revalidateTag } from "next/cache";
import { queueShiftAlertSync, syncShiftReminderJob } from "./alert-jobs";
import { loadOrgMembers } from "./alerts-runner";
import {
  dbClaimShiftSeriesWeeks,
  dbCreateScheduledShift,
  dbEndShiftSeries,
  dbGetActiveShiftSeries,
  dbGetApprovedTimeOffForPeriod,
  dbGetOverlappingScheduledShift,
} from "./db";
import { mirrorShiftToGoogleCalendar } from "./google-calendar";
import { orgHasPlanFeature, SCHEDULING_FEATURE } from "./plan-features";
import { OVERLAPPING_SHIFT_REASON } from "./schedule-utils";
import { dueSeriesOccurrences } from "./shift-series";
import { formatTimeOffDates } from "./time-off-utils";
import type { ScheduledShift, ShiftSeries } from "./types";

export type SeriesFill = {
  created: ScheduledShift[];
  skipped: { shiftStart: string; reason: string }[];
};

/**
 * Makes the weeks of a repeating shift that are due at `now`. Weeks the
 * member has approved time off or another shift are skipped, the same as
 * publishing by hand. The weeks are claimed first, so overlapping runs never
 * make one twice, and a week removed later is never made again.
 */
export async function fillShiftSeries(
  series: ShiftSeries,
  now: Date = new Date(),
): Promise<SeriesFill> {
  const result: SeriesFill = { created: [], skipped: [] };
  const due = dueSeriesOccurrences(series, now);
  if (due.nextIndex === series.next_index) return result;
  if (
    !(await dbClaimShiftSeriesWeeks(
      series.id,
      series.next_index,
      due.nextIndex,
    ))
  ) {
    return result;
  }

  for (const occurrence of due.occurrences) {
    const shiftStart = occurrence.shiftStart.toISOString();
    try {
      const timeOff = await dbGetApprovedTimeOffForPeriod(
        series.user_id,
        series.org_id,
        occurrence.localDays.start,
        occurrence.localDays.end,
      );
      if (timeOff.length > 0) {
        result.skipped.push({
          shiftStart,
          reason: `This member has approved time off on ${formatTimeOffDates(timeOff[0])}`,
        });
        continue;
      }
      if (
        await dbGetOverlappingScheduledShift(
          series.org_id,
          series.user_id,
          occurrence.shiftStart,
          occurrence.shiftEnd,
        )
      ) {
        result.skipped.push({ shiftStart, reason: OVERLAPPING_SHIFT_REASON });
        continue;
      }
      result.created.push(
        await dbCreateScheduledShift(
          series.org_id,
          series.user_id,
          occurrence.shiftStart,
          occurrence.shiftEnd,
          series.note,
          series.created_by,
          {
            site_id: series.site_id,
            location: series.location,
            location_address: series.location_address,
          },
          series.id,
        ),
      );
    } catch (error) {
      console.error(
        `[Repeating shifts] Couldn't make a week of series ${series.id}:`,
        error,
      );
      result.skipped.push({ shiftStart, reason: "Failed to create shift" });
    }
  }
  return result;
}

/** Shift reminders and Google Calendar follow each new week's shift. */
export async function syncNewSeriesShifts(shifts: ScheduledShift[]) {
  await Promise.allSettled(
    shifts.flatMap((shift) => [
      syncShiftReminderJob("added", shift),
      mirrorShiftToGoogleCalendar("added", shift),
    ]),
  );
}

export type SeriesRunResult = {
  series: number;
  created: number;
  ended: number;
};

/**
 * The daily job behind repeating shifts: tops every active series up to the
 * horizon. Series whose member left the org are stopped; orgs whose plan no
 * longer includes Scheduling are left alone (and pick up again on upgrade).
 * New shifts reach the member through the weekly schedule digest, their
 * reminders and Google Calendar, not a separate notice each week.
 */
export async function runShiftSeries(
  now: Date = new Date(),
): Promise<SeriesRunResult> {
  const result: SeriesRunResult = { series: 0, created: 0, ended: 0 };
  const all = await dbGetActiveShiftSeries();
  const byOrg = new Map<string, ShiftSeries[]>();
  for (const series of all) {
    byOrg.set(series.org_id, [...(byOrg.get(series.org_id) ?? []), series]);
  }

  for (const [orgId, list] of byOrg) {
    try {
      if (!(await orgHasPlanFeature(orgId, SCHEDULING_FEATURE))) continue;
      const memberIds = new Set(
        (await loadOrgMembers(orgId)).map((m) => m.userId),
      );
      const created: ScheduledShift[] = [];
      for (const series of list) {
        result.series += 1;
        if (!memberIds.has(series.user_id)) {
          if (await dbEndShiftSeries(series.id, orgId)) result.ended += 1;
          continue;
        }
        created.push(...(await fillShiftSeries(series, now)).created);
      }
      if (created.length === 0) continue;
      result.created += created.length;
      revalidateTag(`scheduled-shifts-${orgId}`, { expire: 0 });
      queueShiftAlertSync(orgId);
      await syncNewSeriesShifts(created);
    } catch (error) {
      console.error(`[Repeating shifts] Failed for org ${orgId}:`, error);
    }
  }
  return result;
}
