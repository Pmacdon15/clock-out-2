import Link from "next/link";
import { MailIcon } from "./ui/Icons";

export default function Footer() {
  
  return (
    <footer className="mt-auto border-t border-zinc-200 bg-white/50 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/50">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="flex flex-col items-center justify-between gap-6 md:flex-row">
          <div className="flex flex-col gap-2 text-center md:text-left">
            <h2 className="text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              Clock Out
            </h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              © 2026 Patrick MacDonald. All rights reserved.
            </p>
          </div>

          <div className="flex flex-wrap justify-center gap-x-8 gap-y-4">
            <Link
              href="/"
              className="text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
            >
              Dashboard
            </Link>
            <Link
              href="/plans"
              className="text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
            >
              Plans
            </Link>
            <Link
              href="/privacy"
              className="text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
            >
              Privacy Policy
            </Link>
            <Link
              href="/tos"
              className="text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
            >
              Terms of Service
            </Link>
          </div>

          <div className="flex items-center gap-4">
            <a
              href="mailto:patrick@patmac.ca"
              className="group flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-4 py-2 text-sm font-medium text-zinc-600 hover:border-zinc-300 hover:bg-white hover:text-zinc-900 transition-all dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:border-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              <MailIcon className="h-4 w-4" />
              <span>patrick@patmac.ca</span>
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
