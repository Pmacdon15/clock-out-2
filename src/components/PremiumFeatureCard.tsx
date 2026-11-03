import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { Button, Card } from "./ui";

/** Shown in place of a feature the organization's plan doesn't include. */
export function PremiumFeatureCard({
  icon: Icon,
  description,
}: {
  icon: LucideIcon;
  description: string;
}) {
  return (
    <Card className="p-8 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
        <Icon className="h-6 w-6 text-zinc-400" />
      </div>
      <h3 className="mb-2 font-bold text-xl">Premium Feature</h3>
      <p className="mx-auto max-w-sm text-muted-foreground">{description}</p>
      <Link className="mt-6 inline-block" href="/plans">
        <Button variant="outline">View Plans</Button>
      </Link>
    </Card>
  );
}
