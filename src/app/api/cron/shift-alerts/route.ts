import { NextResponse } from "next/server";
import { runShiftAlerts } from "@/lib/alerts-runner";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import {
  runUpcomingShiftReminders,
  runWeeklyScheduleDigests,
} from "@/lib/schedule-notify";

/**
 * Sends "forgot to clock out" / "still on break" alerts, closes shifts that
 * ran past their org's limit, sends weekly schedules that are due, and
 * reminds members an hour before each scheduled shift. Safe
 * to call as often as you like: each alert is sent once. Call it every 5–15
 * minutes (see README, "Shift alerts").
 */
async function handle(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  // Independent jobs: one failing never stops the other.
  const [alerts, digests, reminders] = await Promise.allSettled([
    runShiftAlerts(now),
    runWeeklyScheduleDigests(now),
    runUpcomingShiftReminders(now),
  ]);
  if (alerts.status === "rejected") {
    console.error("[Cron] Shift alerts failed:", alerts.reason);
  }
  if (digests.status === "rejected") {
    console.error("[Cron] Weekly schedules failed:", digests.reason);
  }
  if (reminders.status === "rejected") {
    console.error("[Cron] Shift reminders failed:", reminders.reason);
  }
  const failed = [alerts, digests, reminders].some(
    (job) => job.status === "rejected",
  );
  return NextResponse.json(
    {
      success: !failed,
      date: now.toISOString(),
      orgs: alerts.status === "fulfilled" ? alerts.value : null,
      schedules: digests.status === "fulfilled" ? digests.value : null,
      reminders: reminders.status === "fulfilled" ? reminders.value : null,
      ...(failed ? { error: "Some jobs failed; see logs" } : {}),
    },
    { status: failed ? 500 : 200 },
  );
}

export const GET = handle;
export const POST = handle;
