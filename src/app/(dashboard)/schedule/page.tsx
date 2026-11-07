import { CalendarDays } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { ViewHoursFallback } from "@/components/fallbacks/view-hours-fallback";
import { PremiumFeatureCard } from "@/components/PremiumFeatureCard";
import Schedule from "@/components/Schedule";
import {
  getCalendarFeedPath,
  getOrgMembers,
  getSchedule,
  getTimeOffRequests,
} from "@/lib/dal";
import { SCHEDULING_FEATURE } from "@/lib/plan-features";
import { hasFeature, isAdmin } from "@/lib/session";

export const metadata: Metadata = { title: "Schedule | Clock Out" };

export default function SchedulePage() {
  return (
    <>
      <h2 className="sr-only">Schedule</h2>
      <Suspense fallback={<ViewHoursFallback />}>
        {Promise.all([hasFeature(SCHEDULING_FEATURE), isAdmin()]).then(
          ([hasScheduling, admin]) =>
            hasScheduling ? (
              <Schedule
                calendarFeedPromise={getCalendarFeedPath()}
                isAdmin={admin}
                membersPromise={getOrgMembers()}
                schedulePromise={getSchedule()}
                timeOffPromise={getTimeOffRequests()}
              />
            ) : (
              <PremiumFeatureCard
                description="Scheduling shifts is only available on paid plans. Upgrade your organization to unlock this feature."
                icon={CalendarDays}
              />
            ),
        )}
      </Suspense>
    </>
  );
}
