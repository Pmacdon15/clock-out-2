"use client";

import { CalendarPlus, Copy } from "lucide-react";
import { use } from "react";
import { toast } from "sonner";
import { calendarSubscribeLinks } from "@/lib/calendar-feed-links";
import { Card } from "./ui";

const buttonClass =
  "inline-flex h-10 items-center justify-center rounded-xl border-2 border-zinc-200 px-4 font-semibold text-sm transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-800";

/** The feed's full URL; only built on click, so the page's HTML stays origin free. */
const absolute = (path: string) => `${window.location.origin}${path}`;

/**
 * Subscribes the member's calendar app to their shifts: Google Calendar,
 * Apple Calendar and Outlook add the feed in one click and keep it updated
 * as shifts are published, moved or cancelled.
 */
export default function CalendarSubscribe({
  feedPathPromise,
}: {
  feedPathPromise: Promise<string | null>;
}) {
  const path = use(feedPathPromise);
  if (!path) return null;

  const open = (app: "google" | "apple" | "outlook") => {
    const url = calendarSubscribeLinks(absolute(path))[app];
    if (app === "apple") {
      window.location.href = url;
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(absolute(path));
      toast.success("Calendar link copied");
    } catch {
      toast.error("Couldn't copy the link");
    }
  };

  return (
    <Card className="p-6 sm:p-8">
      <div className="mb-4 flex items-start gap-3">
        <div className="rounded-xl bg-zinc-900 p-2 text-white dark:bg-zinc-100 dark:text-black">
          <CalendarPlus className="h-5 w-5" />
        </div>
        <div>
          <h4 className="font-bold text-lg">Add my shifts to my calendar</h4>
          <p className="text-muted-foreground text-sm">
            Your shifts show up in your calendar and stay up to date: new shifts
            are added, moved ones update and cancelled ones disappear.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          className={buttonClass}
          onClick={() => open("google")}
          type="button"
        >
          Google Calendar
        </button>
        <button
          className={buttonClass}
          onClick={() => open("apple")}
          type="button"
        >
          Apple Calendar
        </button>
        <button
          className={buttonClass}
          onClick={() => open("outlook")}
          type="button"
        >
          Outlook
        </button>
        <button className={buttonClass} onClick={copy} type="button">
          <Copy className="mr-2 h-4 w-4" />
          Copy link
        </button>
      </div>
      <p className="mt-3 text-muted-foreground text-xs">
        Changes can take a few hours to reach Google Calendar. Keep this link
        private: anyone with it can see your shifts.
      </p>
    </Card>
  );
}
