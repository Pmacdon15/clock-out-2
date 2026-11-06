import { Suspense } from "react";
import DashboardNav from "@/components/DashboardNav";
import DashboardSync from "@/components/DashboardSync";
import MainPageHeader from "@/components/headers/main-page-header";
import InstallPrompt from "@/components/InstallPrompt";
import { getMyNotificationSettings } from "@/lib/alerts-dal";
import { getSession } from "@/lib/session";

/**
 * Shared frame for the signed-in pages (the proxy sends signed-out visitors
 * to /welcome or sign-in). The header and the page links are the static
 * shell; nothing here awaits, so each page keeps its own shell and only its
 * data streams in.
 */
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-3 py-4 sm:px-4 sm:py-8">
      <MainPageHeader />
      <InstallPrompt />
      <DashboardNav />
      <Suspense fallback={null}>
        <DashboardSync
          orgIdPromise={getSession().then(
            (session) => session.orgId ?? undefined,
          )}
          settingsPromise={getMyNotificationSettings()}
        />
      </Suspense>
      {children}
    </main>
  );
}
