import { CalendarDays } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import Availability from "@/components/Availability";
import { ViewHoursFallback } from "@/components/fallbacks/view-hours-fallback";
import { PremiumFeatureCard } from "@/components/PremiumFeatureCard";
import Schedule from "@/components/Schedule";
import ShiftRequests from "@/components/ShiftRequests";
import { getAvailabilityView } from "@/lib/availability-dal";
import {
  getCalendarFeedPath,
  getOrgMembers,
  getOrgSites,
  getSchedule,
  getTimeOffRequests,
} from "@/lib/dal";
import { googleCalendarConnectedAction } from "@/lib/google-calendar-actions";
import { SCHEDULING_FEATURE } from "@/lib/plan-features";
import { hasFeature, isAdmin } from "@/lib/session";
import { getShiftRequestsView } from "@/lib/shift-requests-dal";

export const metadata: Metadata = {
  title: "Schedule",
  robots: { index: false, follow: false },
};

/** One read of availability, shared by the schedule's warnings and its card. */
function loadAvailability() {
  const view = getAvailabilityView();
  return {
    view,
    windows: view.then((result) => (result.ok ? result.value.windows : [])),
  };
}

export default function SchedulePage() {
  return (
    <>
      <h2 className="sr-only">Schedule</h2>
      <Suspense fallback={<ViewHoursFallback />}>
        {Promise.all([hasFeature(SCHEDULING_FEATURE), isAdmin()]).then(
          ([hasScheduling, admin]) => {
            if (!hasScheduling) {
              return (
                <PremiumFeatureCard
                  description="Scheduling shifts is only available on paid plans. Upgrade your organization to unlock this feature."
                  icon={CalendarDays}
                />
              );
            }
            const availability = loadAvailability();
            const members = getOrgMembers();
            return (
              <>
                <Schedule
                  availabilityPromise={admin ? availability.windows : undefined}
                  calendarFeedPromise={getCalendarFeedPath()}
                  googleConnectedPromise={googleCalendarConnectedAction()}
                  isAdmin={admin}
                  membersPromise={members}
                  schedulePromise={getSchedule()}
                  sitesPromise={admin ? getOrgSites() : undefined}
                  timeOffPromise={getTimeOffRequests()}
                />
                <div className="mt-6">
                  <Suspense fallback={null}>
                    <ShiftRequests viewPromise={getShiftRequestsView()} />
                  </Suspense>
                </div>
                <div className="mt-6">
                  <Suspense fallback={null}>
                    <Availability
                      membersPromise={admin ? members : undefined}
                      viewPromise={availability.view}
                    />
                  </Suspense>
                </div>
              </>
            );
          },
        )}
      </Suspense>
    </>
  );
}
