import { Plane } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { ViewHoursFallback } from "@/components/fallbacks/view-hours-fallback";
import { PremiumFeatureCard } from "@/components/PremiumFeatureCard";
import TimeOff from "@/components/TimeOff";
import {
  getOrgMembers,
  getTimeOffAllowances,
  getTimeOffRequests,
} from "@/lib/dal";
import { TIME_OFF_FEATURE } from "@/lib/plan-features";
import { getSession, hasFeature, isAdmin } from "@/lib/session";

export const metadata: Metadata = { title: "Time Off | Clock Out" };

export default function TimeOffPage() {
  return (
    <>
      <h2 className="sr-only">Time Off</h2>
      <Suspense fallback={<ViewHoursFallback />}>
        {Promise.all([hasFeature(TIME_OFF_FEATURE), isAdmin()]).then(
          ([hasTimeOff, admin]) =>
            hasTimeOff ? (
              <TimeOff
                allowancesPromise={getTimeOffAllowances()}
                currentUserIdPromise={getSession().then((s) => s.userId)}
                isAdmin={admin}
                membersPromise={getOrgMembers()}
                timeOffPromise={getTimeOffRequests()}
              />
            ) : (
              <PremiumFeatureCard
                description="Time off requests and PTO tracking are only available on paid plans. Upgrade your organization to unlock this feature."
                icon={Plane}
              />
            ),
        )}
      </Suspense>
    </>
  );
}
