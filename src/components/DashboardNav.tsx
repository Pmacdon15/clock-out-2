import { Show } from "@clerk/nextjs";
import { Suspense } from "react";
import { DASHBOARD_ROUTES } from "@/lib/routes";
import DashboardNavLink from "./DashboardNavLink";

/**
 * The dashboard's page links. Every member's links are in the static shell;
 * only the admin-only Settings link waits on the session, in its own hole.
 */
export default function DashboardNav() {
  return (
    <nav
      aria-label="Dashboard"
      // max-w-full + overflow-x-auto keeps a long row of links inside the
      // screen on phones (it scrolls sideways instead of widening the page).
      className="mb-8 inline-flex h-10 max-w-full items-center justify-start overflow-x-auto rounded-md bg-zinc-100 p-1 text-zinc-500 [scrollbar-width:none] dark:bg-zinc-900 dark:text-zinc-400 [&::-webkit-scrollbar]:hidden"
    >
      <DashboardNavLink href={DASHBOARD_ROUTES["time-clock"]}>
        Time Clock
      </DashboardNavLink>
      <DashboardNavLink href={DASHBOARD_ROUTES.view}>Hours</DashboardNavLink>
      <DashboardNavLink href={DASHBOARD_ROUTES.notifications}>
        Notifications
      </DashboardNavLink>
      <DashboardNavLink href={DASHBOARD_ROUTES.schedule}>
        Schedule
      </DashboardNavLink>
      <DashboardNavLink href={DASHBOARD_ROUTES["time-off"]}>
        Time Off
      </DashboardNavLink>
      <Suspense fallback={null}>
        <Show when={{ role: "org:admin" }}>
          <DashboardNavLink href={DASHBOARD_ROUTES.settings}>
            Settings
          </DashboardNavLink>
        </Show>
      </Suspense>
    </nav>
  );
}
