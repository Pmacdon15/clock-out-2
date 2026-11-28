import { Card } from "@/components/ui";

/** Mirrors OrgSettings' layout: the section menu beside the open section. */
export function SettingsFallback() {
  return (
    <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-8">
      <div className="flex gap-1 overflow-hidden md:w-60 md:shrink-0 md:flex-col">
        {[1, 2, 3, 4].map((i) => (
          <div
            className="h-9 w-32 shrink-0 animate-pulse rounded-lg bg-zinc-100 md:h-14 md:w-full dark:bg-zinc-900"
            key={i}
          />
        ))}
      </div>

      <Card className="min-w-0 flex-1 p-8">
        <div className="mb-8 space-y-2">
          <div className="h-8 w-48 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
          <div className="h-4 w-full max-w-96 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-900" />
        </div>

        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div
              className="h-20 w-full animate-pulse rounded-2xl bg-zinc-100/50 dark:bg-zinc-800/50"
              key={i}
            />
          ))}
        </div>

        <div className="mt-8 flex justify-end">
          <div className="h-12 w-32 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800" />
        </div>
      </Card>
    </div>
  );
}
