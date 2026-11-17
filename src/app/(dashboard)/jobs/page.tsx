import type { Metadata } from "next";
import { Suspense } from "react";
import { ViewHoursFallback } from "@/components/fallbacks/view-hours-fallback";
import JobsPanel from "@/components/JobsPanel";
import { getJobsHours } from "@/lib/jobs-dal";
import { parseParams } from "@/lib/utils";

export const metadata: Metadata = { title: "Jobs | Clock Out" };

/**
 * Hours across all (or a chosen few) of the signed-in user's organizations
 * at once. Who sees what is decided per job on the server: admins of a job
 * see everyone in it, members only themselves.
 */
export default function JobsPage({ searchParams }: PageProps<"/jobs">) {
  // Not awaited: the page stays in the static shell.
  const params = searchParams.then((p) => ({
    jobs: parseParams(p.jobs),
    timeframe: parseParams(p.timeframe),
    filters: {
      start: parseParams(p.start),
      end: parseParams(p.end),
      timezone: parseParams(p.timezone),
    },
  }));

  return (
    <>
      <h2 className="sr-only">Jobs</h2>
      <Suspense fallback={<ViewHoursFallback />}>
        <JobsPanel
          endDatePromise={params.then((p) => p.filters.end)}
          startDatePromise={params.then((p) => p.filters.start)}
          timeframePromise={params.then((p) => p.timeframe)}
          viewPromise={params.then((p) => getJobsHours(p.jobs, p.filters))}
        />
      </Suspense>
    </>
  );
}
