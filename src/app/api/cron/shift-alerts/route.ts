import { NextResponse } from "next/server";
import { runShiftAlerts } from "@/lib/alerts-runner";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";

/**
 * Sends "forgot to clock out" / "still on break" alerts and closes shifts
 * that ran past their org's limit. Safe to call as often as you like: each
 * alert is sent once. Call it every 5–15 minutes (see README, "Shift alerts").
 */
async function handle(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const now = new Date();
    const results = await runShiftAlerts(now);
    return NextResponse.json({
      success: true,
      date: now.toISOString(),
      orgs: results,
    });
  } catch (error) {
    console.error("[Cron] Shift alerts failed:", error);
    return NextResponse.json(
      { error: "Failed to run shift alerts" },
      { status: 500 },
    );
  }
}

export const GET = handle;
export const POST = handle;
