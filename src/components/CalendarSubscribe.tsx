"use client";

import { use, useState, useTransition } from "react";
import { resetCalendarFeedAction } from "@/lib/calendar-feed-actions";
import { calendarSubscribeLinks } from "@/lib/calendar-feed-links";

const buttonClass =
  "inline-flex h-9 items-center justify-center rounded-xl border-2 border-zinc-200 px-3 font-semibold text-sm transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-800";

/** The feed's full URL; only built on click, so the page's HTML stays origin free. */
const absolute = (path: string) => `${window.location.origin}${path}`;

/**
 * For Apple Calendar and Outlook users: subscribes their calendar app to a
 * feed of their shifts. Google users use "Add all to Google Calendar", which
 * puts shifts on their own calendar instead of adding a separate one.
 */
export default function CalendarSubscribe({
  feedPathPromise,
}: {
  feedPathPromise: Promise<string | null>;
}) {
  const initialPath = use(feedPathPromise);
  const [path, setPath] = useState(initialPath);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [isResetting, startReset] = useTransition();
  if (!path) return null;

  const reset = () => {
    if (
      !window.confirm(
        "Reset your calendar link? Calendars already subscribed to the old link will stop updating, and you'll need to subscribe again.",
      )
    ) {
      return;
    }
    startReset(async () => {
      const result = await resetCalendarFeedAction();
      if (result.status === "ok") {
        setPath(result.path);
        setResetMessage("Link reset. Subscribe again with the new link.");
      } else {
        setResetMessage(result.error);
      }
    });
  };

  return (
    <details className="px-1 text-sm">
      <summary className="cursor-pointer text-muted-foreground">
        Use Apple Calendar or Outlook instead?
      </summary>
      <p className="mt-2 mb-3 text-muted-foreground text-xs">
        These add a separate “Clock Out shifts” calendar that keeps itself up to
        date. Keep it to yourself: anyone with the link can see your shifts. If
        it gets out, reset the link.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          className={buttonClass}
          onClick={() => {
            window.location.href = calendarSubscribeLinks(absolute(path)).apple;
          }}
          type="button"
        >
          Apple Calendar
        </button>
        <button
          className={buttonClass}
          onClick={() =>
            window.open(
              calendarSubscribeLinks(absolute(path)).outlook,
              "_blank",
              "noopener,noreferrer",
            )
          }
          type="button"
        >
          Outlook
        </button>
        <button
          className={buttonClass}
          disabled={isResetting}
          onClick={reset}
          type="button"
        >
          {isResetting ? "Resetting…" : "Reset link"}
        </button>
      </div>
      {resetMessage && (
        <p className="mt-2 text-muted-foreground text-xs" role="status">
          {resetMessage}
        </p>
      )}
    </details>
  );
}
