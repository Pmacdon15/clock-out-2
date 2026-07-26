import { Card } from "@/components/ui";

export function SettingsFallback() {
  return (
    <Card className="p-8">
      <div className="mb-8 space-y-2">
        <div className="h-8 w-48 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-4 w-96 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-900" />
      </div>

      <div className="space-y-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="flex w-full items-center justify-between rounded-2xl border-2 border-transparent bg-zinc-100/50 p-6 dark:bg-zinc-800/50"
          >
            <div className="flex items-center gap-4">
              <div className="h-10 w-10 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-700" />
              <div className="space-y-2">
                <div className="h-5 w-40 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-700" />
                <div className="h-4 w-64 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-700" />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8 flex justify-end">
        <div className="h-12 w-32 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800" />
      </div>
    </Card>
  );
}
