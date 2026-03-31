import {
  OrganizationSwitcher,
  Show,
  SignInButton,
  UserButton,
} from "@clerk/nextjs";
import { dark } from "@clerk/ui/themes";
import Link from "next/link";

import { Suspense } from "react";

export default function MainPageHeader() {
  return (
    <header className="flex flex-col md:flex-row items-center justify-between mb-12 border-b pb-6 gap-4 border-zinc-200 dark:border-zinc-800">
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
        <Suspense>
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
        </Suspense>
      </div>
    </header>
  );
}
