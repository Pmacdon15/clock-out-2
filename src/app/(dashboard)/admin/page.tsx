import type { Metadata } from "next";
import { Suspense } from "react";
import { LiveDashboardFallback } from "@/components/fallbacks/live-dashboard-fallback";
import LiveDashboard from "@/components/LiveDashboard";
import { getLiveDashboard } from "@/lib/live-dashboard-dal";

export const metadata: Metadata = {
  title: "Live dashboard",
  robots: { index: false, follow: false },
};

/**
 * Admins' live view: who's working now, headcount and today's labour cost.
 * The read checks the caller is an admin; anyone else gets a notice.
 */
export default function AdminDashboardPage() {
  return (
    <>
      <h2 className="sr-only">Live dashboard</h2>
      <Suspense fallback={<LiveDashboardFallback />}>
        <LiveDashboard dataPromise={getLiveDashboard()} />
      </Suspense>
    </>
  );
}
