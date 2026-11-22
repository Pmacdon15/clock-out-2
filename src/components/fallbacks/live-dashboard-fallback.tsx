import { Card, Skeleton } from "@/components/ui";

export function LiveDashboardFallback() {
  return (
    <div aria-busy="true" className="space-y-6">
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Card className="p-4" key={i}>
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-3 h-7 w-16" />
          </Card>
        ))}
      </div>
      <Card className="space-y-3 p-6">
        {[1, 2, 3].map((i) => (
          <Skeleton className="h-10 w-full" key={i} />
        ))}
      </Card>
    </div>
  );
}
