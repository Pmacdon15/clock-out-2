import { NextResponse } from "next/server";
import {
  isQStashConfigured,
  parseAlertJob,
  runAlertJob,
  verifyQStashSignature,
} from "@/lib/alert-jobs";

/**
 * Where Upstash QStash delivers the delayed alert jobs scheduled at clock-in,
 * break start, schedule changes and so on (see `src/lib/alert-jobs.ts`).
 * Only signed QStash deliveries are accepted. A 5xx makes QStash retry.
 */
export async function POST(request: Request) {
  if (!isQStashConfigured()) {
    return NextResponse.json(
      { error: "Alert jobs are not configured" },
      { status: 503 },
    );
  }
  const body = await request.text();
  const signature = request.headers.get("upstash-signature");
  if (!(await verifyQStashSignature(signature, body))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const job = parseAlertJob(body);
  // Malformed but signed: retrying won't fix it, so don't ask for a retry.
  if (!job) {
    return NextResponse.json({ error: "Unknown job" }, { status: 400 });
  }
  try {
    const result = await runAlertJob(job);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error(`[Dispatch] ${job.type} job failed:`, error);
    return NextResponse.json({ error: "Job failed" }, { status: 500 });
  }
}
