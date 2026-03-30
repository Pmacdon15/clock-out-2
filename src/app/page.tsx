import {
  OrganizationSwitcher,
  Show,
  SignInButton,
  UserButton,
} from "@clerk/nextjs";
import { dark } from "@clerk/ui/themes";
import Link from "next/link";
import { Suspense } from "react";
import DashboardTabs from "@/components/DashboardTabs";
import { getAuthSession, getOrgMembers, getTimeEntries } from "@/lib/dal";

export const dynamic = "force-dynamic";

export default function Home(props: PageProps<"/">) {
  // const { userId: targetUserId } = await props.searchParams;

  const userIdPromise = props.searchParams.then((params) =>
    Array.isArray(params.userId) ? params.userId[0] : params.userId,
  );

  const timeEntriesPromise = props.searchParams.then((params) =>
    getTimeEntries(
      Array.isArray(params.userId) ? params.userId[0] : params.userId,
    ),
  );

  // Add the parentheses here:
  const isAdminPromise = getAuthSession().then((result) => {
    if (result.isOk()) {
      return result.value.isAdmin;
    }
    return false; // Default to false if auth fails
  });
  const membersPromise = getOrgMembers();

  return (
    <main className="flex-1 flex flex-col max-w-5xl mx-auto w-full px-4 py-8">
      <header className="flex items-center justify-between mb-12 border-b pb-6 border-zinc-200 dark:border-zinc-800">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Clock Out</h1>
          <p className="text-muted-foreground mt-1">
            Efficient time tracking for professional teams.
          </p>
        </div>
        <div className="flex items-center gap-6">
          <Link
            href="/plans"
            className="text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
          >
            Plans
          </Link>
          <Show when="signed-in">
            <OrganizationSwitcher
              appearance={{
                theme: dark,
                elements: {
                  organizationSwitcherTrigger:
                    "py-1.5 px-3 border border-zinc-200 dark:border-zinc-800 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors",
                },
              }}
            />
            <UserButton
              appearance={{
                theme: dark,
              }}
            />
          </Show>
          <Show when="signed-out">
            <SignInButton>
              <button
                type="button"
                className="px-4 py-2 bg-zinc-900 text-zinc-50 rounded-md hover:bg-zinc-800 transition-colors dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                Sign In
              </button>
            </SignInButton>
          </Show>
        </div>
      </header>

      <Show when="signed-in">
        <Suspense fallback={<DashboardSkeleton />}>
          <DashboardTabs
            entriesPromise={timeEntriesPromise}
            isAdminPromise={isAdminPromise}
            membersPromise={membersPromise}
            selectedUserIdPromise={userIdPromise}
          />
        </Suspense>
      </Show>

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
