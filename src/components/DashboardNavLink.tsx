"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { DashboardPath } from "@/lib/routes";
import { cn } from "@/lib/utils";

/**
 * One page link in the dashboard nav. Only the active highlight needs the
 * browser's pathname; the link itself is plain HTML in the static shell, and
 * Next prefetches each page's shell so switching is near-instant.
 */
export default function DashboardNavLink({
  href,
  children,
}: {
  href: DashboardPath;
  children: React.ReactNode;
}) {
  const isActive = usePathname() === href;

  return (
    <Link
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 font-medium text-sm ring-offset-white transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 dark:ring-offset-zinc-950 dark:focus-visible:ring-zinc-300",
        isActive
          ? "bg-white text-zinc-950 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
          : "hover:text-zinc-900 dark:hover:text-zinc-50",
      )}
      href={href}
    >
      {children}
    </Link>
  );
}
