import { Card } from "@/components/ui";

export function ViewHoursFallback() {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex max-w-full gap-2 overflow-x-auto rounded-lg bg-zinc-100 p-1 dark:bg-zinc-900">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="h-8 w-16 rounded-md bg-zinc-200 dark:bg-zinc-800"
              />
            ))}
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <div className="h-8 w-32 rounded-lg bg-zinc-200 dark:bg-zinc-800" />
            <div className="h-8 w-32 rounded-lg bg-zinc-200 dark:bg-zinc-800" />
          </div>
        </div>
      </div>

      <Card className="h-[350px] w-full bg-zinc-50 dark:bg-zinc-900/50" />

      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="space-y-3">
            <div className="h-6 w-32 rounded bg-zinc-200 dark:bg-zinc-800" />
            <Card className="p-4 bg-zinc-50 dark:bg-zinc-900/50">
              <div className="flex items-center justify-between">
                <div className="flex gap-4">
                  <div className="h-10 w-1 bg-zinc-200 dark:bg-zinc-800 rounded-full" />
                  <div className="space-y-2">
                    <div className="h-4 w-24 rounded bg-zinc-200 dark:bg-zinc-800" />
                    <div className="h-3 w-32 rounded bg-zinc-100 dark:bg-zinc-900" />
                  </div>
                </div>
                <div className="h-6 w-16 rounded bg-zinc-200 dark:bg-zinc-800" />
              </div>
            </Card>
          </div>
        ))}
      </div>
    </div>
  );
}
