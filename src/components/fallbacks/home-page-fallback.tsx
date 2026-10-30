import { Card } from "@/components/ui";

/**
 * Placeholder for the signed-in dashboard (tabs + time clock card) while the
 * session and time entries load. Sized like the real content so the page
 * doesn't jump when it streams in.
 */
export default function DashboardSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading dashboard"
      className="animate-pulse space-y-8"
      data-testid="dashboard-skeleton"
      role="status"
    >
      <div className="inline-flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-900">
        {[1, 2, 3].map((i) => (
          <div
            className="h-8 w-24 rounded-md bg-zinc-200 dark:bg-zinc-800"
            key={i}
          />
        ))}
      </div>

      <Card className="mb-8 flex flex-col items-center justify-center p-8 sm:p-12">
        <div className="mb-6 h-7 w-20 rounded-full bg-zinc-200 dark:bg-zinc-800" />
        <div className="mb-8 h-10 w-full max-w-md rounded-lg bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-16 w-full max-w-sm rounded-2xl bg-zinc-200 dark:bg-zinc-800" />

        <div className="mt-12 w-full space-y-3">
          <div className="mb-4 h-6 w-36 rounded bg-zinc-200 dark:bg-zinc-800" />
          {[1, 2, 3].map((i) => (
            <div
              className="flex items-center justify-between rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
              key={i}
            >
              <div className="space-y-2">
                <div className="h-4 w-24 rounded bg-zinc-200 dark:bg-zinc-800" />
                <div className="h-3 w-40 rounded bg-zinc-200 dark:bg-zinc-800" />
              </div>
              <div className="h-5 w-12 rounded bg-zinc-200 dark:bg-zinc-800" />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
