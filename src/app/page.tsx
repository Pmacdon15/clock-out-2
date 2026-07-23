import { Show, SignInButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { Suspense } from "react";
import DashboardTabs from "@/components/DashboardTabs";
import DashboardSkeleton from "@/components/fallbacks/home-page-fallback";
import MainPageHeader from "@/components/headers/main-page-header";
import {
  getOrgMembers,
  getOrgReportingSettings,
  getOrgTimeEntries,
  getTimeEntries,
} from "@/lib/dal";
import { parseParams } from "@/lib/utils";

export default function Home(props: PageProps<"/">) {
  const authPromise = auth.protect();
  const hasPromise = authPromise.then((data) => data.has);
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-8">
      <MainPageHeader />
      <Suspense>
        <Show when="signed-in">
          <Suspense fallback={<DashboardSkeleton />}>
            <DashboardTabs
              defaultTabPromise={props.searchParams.then((p) =>
                parseParams(p.defaultTab),
              )}
              endDatePromise={props.searchParams.then((p) =>
                parseParams(p.end),
              )}
              entriesPromise={props.searchParams.then((p) =>
                getTimeEntries(parseParams(p.userId), {
                  start: parseParams(p.start),
                  end: parseParams(p.end),
                }),
              )}
              hasReportingPromise={hasPromise.then((has) =>
                has({ feature: "reporting" }),
              )}
              isAdminPromise={hasPromise.then((has) =>
                has({ role: "org:admin" }),
              )}
              membersPromise={getOrgMembers()}
              orgIdPromise={authPromise.then((auth) => auth.orgId)}
              orgSettingsPromise={getOrgReportingSettings()}
              orgTimeEntriesPromise={props.searchParams.then((p) =>
                getOrgTimeEntries({
                  start: parseParams(p.start),
                  end: parseParams(p.end),
                }),
              )}
              recentEntriesPromise={getTimeEntries()}
              selectedMonthPromise={props.searchParams.then((p) =>
                parseParams(p.month),
              )}
              selectedUserIdPromise={props.searchParams.then((p) =>
                parseParams(p.userId),
              )}
              selectedWeekPromise={props.searchParams.then((p) =>
                parseParams(p.week),
              )}
              selectedYearPromise={props.searchParams.then((p) =>
                parseParams(p.year),
              )}
              startDatePromise={props.searchParams.then((p) =>
                parseParams(p.start),
              )}
              timeframePromise={props.searchParams.then((p) =>
                parseParams(p.timeframe),
              )}
              userIdPromise={authPromise.then((auth) => auth.userId)}
            />
          </Suspense>
        </Show>
      </Suspense>
      <Suspense>
        <Show when="signed-out">
          <div className="flex flex-1 flex-col items-center justify-center py-20 text-center">
            <h2 className="mb-4 font-extrabold text-4xl tracking-tight">
              Time tracking, simplified.
            </h2>
            <p className="mb-8 max-w-lg text-muted-foreground text-xl">
              Clock in, clock out, and manage your hours with ease. Built for
              teams that value simplicity and precision.
            </p>
            <SignInButton>
              <button
                className="rounded-xl bg-zinc-900 px-8 py-4 font-semibold text-lg text-zinc-50 transition-all hover:bg-zinc-800 active:scale-95 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                type="button"
              >
                Get Started Now
              </button>
            </SignInButton>
          </div>
        </Show>
      </Suspense>
    </main>
  );
}
