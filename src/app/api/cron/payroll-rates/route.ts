import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { syncPayrollRatesFromCra } from "@/lib/payroll-dal";

/**
 * Daily at 19:00 UTC (12:00 p.m. MST), see vercel.json. Checks the CRA's
 * current T4127 edition and stores CPP/QPP and EI figures that changed. On
 * any failure the stored rates are left as they are.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await syncPayrollRatesFromCra();
    console.log("[Cron] Payroll rates:", JSON.stringify(result));
    return NextResponse.json(result);
  } catch (error) {
    console.error("[Cron] Payroll rates update failed:", error);
    return NextResponse.json(
      { error: "Payroll rates update failed; existing rates kept" },
      { status: 500 },
    );
  }
}
