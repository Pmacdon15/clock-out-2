import { Show, SignInButton } from "@clerk/nextjs";
import { Suspense } from "react";
import DashboardTabs from "@/components/DashboardTabs";
import MainPageHeader from "@/components/headers/main-page-header";
import { getAuthSession, getOrgMembers, getTimeEntries } from "@/lib/dal";

export default function Home(props: PageProps<"/">) {
  const userIdPromise = props.searchParams.then((params) =>
    Array.isArray(params.userId) ? params.userId[0] : params.userId,
  );

   const defaultTabPromise = props.searchParams.then((params) =>
    Array.isArray(params.defaultTab) ? params.defaultTab[0] : params.defaultTab,
  );

  const selectedWeekPromise = props.searchParams.then((params) =>
    Array.isArray(params.week) ? params.week[0] : params.week,
  );

  const selectedMonthPromise = props.searchParams.then((params) =>
    Array.isArray(params.month) ? params.month[0] : params.month,
  );

  const selectedYearPromise = props.searchParams.then((params) =>
    Array.isArray(params.year) ? params.year[0] : params.year,
  );

  const timeframePromise = props.searchParams.then((params) =>
    Array.isArray(params.timeframe) ? params.timeframe[0] : params.timeframe,
  );

  const timeEntriesPromise = props.searchParams.then((params) =>
    getTimeEntries(
      Array.isArray(params.userId) ? params.userId[0] : params.userId,
    ),
  );

  // Add the parentheses here:
  const isAdminPromise = getAuthSession();
  const membersPromise = getOrgMembers();

  return (
    <main className="flex-1 flex flex-col max-w-5xl mx-auto w-full px-4 py-8">
      <MainPageHeader />
      <Suspense>
        <Show when="signed-in">
          <Suspense fallback={<DashboardSkeleton />}>
            <DashboardTabs
              defaultTabPromise={defaultTabPromise}
              entriesPromise={timeEntriesPromise}
              isAdminPromise={isAdminPromise}
              membersPromise={membersPromise}
              selectedUserIdPromise={userIdPromise}
              selectedWeekPromise={selectedWeekPromise}
              selectedMonthPromise={selectedMonthPromise}
              selectedYearPromise={selectedYearPromise}
              timeframePromise={timeframePromise}
            />
          </Suspense>
        </Show>
      </Suspense>
      <Suspense>
        <Show when="signed-out">
          <div className="flex-1 flex flex-col items-center justify-center text-center py-20">
            <h2 className="text-4xl font-extrabold mb-4 tracking-tight">
              Time tracking, simplified.
            </h2>
            <p className="text-xl text-muted-foreground max-w-lg mb-8">
              Clock in, clock out, and manage your hours with ease. Built for
              teams that value simplicity and precision.
            </p>
            <SignInButton>
              <button
                type="button"
                className="px-8 py-4 bg-zinc-900 text-zinc-50 rounded-xl text-lg font-semibold hover:bg-zinc-800 transition-all active:scale-95 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
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

function DashboardSkeleton() {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="h-10 bg-zinc-200 dark:bg-zinc-800 rounded-md w-1/3"></div>
      <div className="h-[400px] bg-zinc-200 dark:bg-zinc-800 rounded-xl"></div>
    </div>
  );
}
