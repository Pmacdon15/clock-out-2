import { NextResponse } from "next/server";
import { scheduleAllAlertJobs } from "@/lib/alert-jobs";
import { dbPruneStaleFcmTokens } from "@/lib/alerts-db";
import { runShiftAlerts } from "@/lib/alerts-runner";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import {
  runUpcomingShiftReminders,
  runWeeklyScheduleDigests,
} from "@/lib/schedule-notify";

/** FCM expires tokens unused for 270 days; drop ours a little earlier. */
const STALE_FCM_TOKEN_DAYS = 240;

/**
 * The daily safety net behind the exactly-timed alert jobs (Vercel Cron, once
 * a day). Alerts themselves are scheduled to the second at clock-in, break
 * start and schedule changes and delivered by QStash to /api/alerts/dispatch;
 * this catches up on anything that slipped through (a failed publish, QStash
 * not configured yet), schedules reminders for shifts that have come within
 * six days, and forgets stale FCM tokens. Safe to call as often as you like:
 * each alert is sent once.
 */
async function handle(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  // Independent jobs: one failing never stops the others.
  const [alerts, digests, reminders, jobs, pruned] = await Promise.allSettled([
    runShiftAlerts(now),
    runWeeklyScheduleDigests(now),
    runUpcomingShiftReminders(now),
    scheduleAllAlertJobs(now),
    dbPruneStaleFcmTokens(STALE_FCM_TOKEN_DAYS),
  ]);
  const labelled = [
    ["Shift alerts", alerts],
    ["Weekly schedules", digests],
    ["Shift reminders", reminders],
    ["Alert scheduling", jobs],
    ["FCM token cleanup", pruned],
  ] as const;
  for (const [label, job] of labelled) {
    if (job.status === "rejected") {
      console.error(`[Cron] ${label} failed:`, job.reason);
    }
  }
  const value = <T>(job: PromiseSettledResult<T>) =>
    job.status === "fulfilled" ? job.value : null;
  const failed = labelled.some(([, job]) => job.status === "rejected");
  return NextResponse.json(
    {
      success: !failed,
      date: now.toISOString(),
      orgs: value(alerts),
      schedules: value(digests),
      reminders: value(reminders),
      jobs: value(jobs),
      prunedTokens: value(pruned),
      ...(failed ? { error: "Some jobs failed; see logs" } : {}),
    },
    { status: failed ? 500 : 200 },
  );
}

export const GET = handle;
export const POST = handle;
