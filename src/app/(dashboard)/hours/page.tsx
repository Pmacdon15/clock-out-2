import type { Metadata } from "next";
import { Suspense } from "react";
import { ViewHoursFallback } from "@/components/fallbacks/view-hours-fallback";
import HoursPanel from "@/components/HoursPanel";
import {
  getOrgBreakSettings,
  getOrgMembers,
  getOrgOvertimeSettings,
  getOrgPayPeriodSettings,
  getOrgPayRates,
  getOrgTimeEntries,
  getTimeEntries,
  getTimeOffRequests,
} from "@/lib/dal";
import { getOrgPayroll } from "@/lib/payroll-dal";
import { getSession, isAdmin } from "@/lib/session";
import { parseParams } from "@/lib/utils";

export const metadata: Metadata = { title: "Hours | Clock Out" };

export default function HoursPage({ searchParams }: PageProps<"/hours">) {
  // Not awaited: the page stays in the static shell, and each read below
  // waits for the URL inside the Suspense hole.
  const params = searchParams.then((p) => ({
    userId: parseParams(p.userId),
    timeframe: parseParams(p.timeframe),
    filters: {
      start: parseParams(p.start),
      end: parseParams(p.end),
      timezone: parseParams(p.timezone),
    },
  }));

  return (
    <>
      <h2 className="sr-only">Hours</h2>
      <Suspense fallback={<ViewHoursFallback />}>
        <HoursPanel
          breakSettingsPromise={getOrgBreakSettings()}
          currentUserIdPromise={getSession().then((s) => s.userId)}
          endDatePromise={params.then((p) => p.filters.end)}
          entriesPromise={params.then((p) =>
            getTimeEntries(p.userId, p.filters),
          )}
          isAdminPromise={isAdmin()}
          membersPromise={getOrgMembers()}
          orgTimeEntriesPromise={params.then((p) =>
            getOrgTimeEntries(p.filters),
          )}
          overtimeSettingsPromise={getOrgOvertimeSettings()}
          payPeriodSettingsPromise={getOrgPayPeriodSettings()}
          payRatesPromise={getOrgPayRates()}
          payrollPromise={getOrgPayroll()}
          selectedUserIdPromise={params.then((p) => p.userId)}
          startDatePromise={params.then((p) => p.filters.start)}
          timeframePromise={params.then((p) => p.timeframe)}
          timeOffPromise={getTimeOffRequests()}
        />
      </Suspense>
    </>
  );
}
