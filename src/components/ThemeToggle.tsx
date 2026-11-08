"use client";

import { MoonIcon, SunIcon } from "lucide-react";
import { applyTheme } from "@/lib/theme";

/**
 * Flips between light and dark mode. Both icons are rendered and the `dark:`
 * variant picks which one shows, so the server HTML never disagrees with the
 * theme the inline head script applied.
 */
export function ThemeToggle({ className = "" }: { className?: string }) {
  return (
    <button
      aria-label="Toggle dark mode"
      className={`inline-flex h-9 w-9 items-center justify-center rounded-md border border-zinc-200 text-zinc-500 transition-colors hover:bg-blue-50 hover:text-blue-600 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100 ${className}`}
      onClick={() =>
        applyTheme(
          document.documentElement.classList.contains("dark")
            ? "light"
            : "dark",
        )
      }
      title="Toggle dark mode"
      type="button"
    >
      <MoonIcon aria-hidden="true" className="h-4 w-4 dark:hidden" />
      <SunIcon aria-hidden="true" className="hidden h-4 w-4 dark:block" />
    </button>
  );
}
