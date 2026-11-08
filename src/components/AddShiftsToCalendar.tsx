"use client";

import { useUser } from "@clerk/nextjs";
import { useMutation } from "@tanstack/react-query";
import { CalendarPlus, Loader2 } from "lucide-react";
import { use, useEffect, useRef } from "react";
import { toast } from "sonner";
import { syncMyShiftsToGoogleCalendarAction } from "@/lib/actions";
import {
  calendarSubscribeLinks,
  GOOGLE_CALENDAR_SCOPE,
} from "@/lib/calendar-feed-links";
import { Button, Card } from "./ui";

/** Set on the URL Google sends the member back to, to finish the add. */
export const RETURN_PARAM = "googleCalendar";

const linkClass =
  "inline-flex h-9 items-center justify-center rounded-xl border-2 border-zinc-200 px-3 font-semibold text-sm transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-800";

function returnUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set(RETURN_PARAM, "sync");
  return url.toString();
}

export function syncedMessage(counts: {
  added: number;
  updated: number;
  removed: number;
}) {
  const total = counts.added + counts.updated;
  if (total === 0 && counts.removed === 0) {
    return "You have no upcoming shifts to add yet. New ones will show up in Google Calendar automatically.";
  }
  const parts = [
    counts.added > 0 && `${counts.added} added`,
    counts.updated > 0 && `${counts.updated} already there`,
    counts.removed > 0 && `${counts.removed} cancelled removed`,
  ].filter(Boolean);
  return `Your shifts are in Google Calendar (${parts.join(", ")}). New and changed shifts will update automatically.`;
}

/**
 * "Add my shifts to Google Calendar": puts the member's shifts on their own
 * main Google calendar, no extra calendar. The first time, Google asks them
 * to allow it; after that, shifts admins add, move or cancel follow along.
 * Apple Calendar and Outlook can subscribe to the feed instead.
 */
export default function AddShiftsToCalendar({
  feedPathPromise,
}: {
  feedPathPromise?: Promise<string | null>;
}) {
  const feedPath = feedPathPromise ? use(feedPathPromise) : null;
  const { user } = useUser();
  const resumed = useRef(false);

  /** Sends the member to Google to allow calendar access, then back here. */
  const connectGoogle = async () => {
    if (!user) return;
    try {
      const existing = user.externalAccounts.find(
        (account) => account.provider === "google",
      );
      const account = existing
        ? await existing.reauthorize({
            additionalScopes: [GOOGLE_CALENDAR_SCOPE],
            redirectUrl: returnUrl(),
          })
        : await user.createExternalAccount({
            strategy: "oauth_google",
            additionalScopes: [GOOGLE_CALENDAR_SCOPE],
            redirectUrl: returnUrl(),
          });
      const redirect = account.verification?.externalVerificationRedirectURL;
      if (redirect) {
        window.location.href = redirect.toString();
      } else {
        toast.error("Couldn't open Google. Try again.");
      }
    } catch (e) {
      console.error("Couldn't connect Google Calendar:", e);
      toast.error("Couldn't connect to Google. Try again.");
    }
  };

  const { mutate, isPending } = useMutation({
    mutationFn: () => syncMyShiftsToGoogleCalendarAction(),
    onSuccess: async (res, _vars) => {
      if (res.ok) {
        toast.success(syncedMessage(res));
      } else if (res.connect && !resumed.current) {
        await connectGoogle();
      } else {
        toast.error(res.reason);
      }
    },
    onError: () => toast.error("Couldn't update Google Calendar. Try again."),
  });

  // Back from Google: finish adding the shifts.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get(RETURN_PARAM) !== "sync") return;
    url.searchParams.delete(RETURN_PARAM);
    window.history.replaceState(null, "", url.toString());
    resumed.current = true;
    mutate();
  }, [mutate]);

  const feedUrl = () => `${window.location.origin}${feedPath}`;

  return (
    <Card className="p-6 sm:p-8">
      <div className="mb-4 flex items-start gap-3">
        <div className="rounded-xl bg-zinc-900 p-2 text-white dark:bg-zinc-100 dark:text-black">
          <CalendarPlus className="h-5 w-5" />
        </div>
        <div>
          <h4 className="font-bold text-lg">Add my shifts to my calendar</h4>
          <p className="text-muted-foreground text-sm">
            Your shifts go straight onto your Google Calendar, on your phone and
            computer. New, moved and cancelled shifts update by themselves.
          </p>
        </div>
      </div>
      <Button
        className="w-full sm:w-auto"
        disabled={isPending || !user}
        onClick={() => {
          resumed.current = false;
          mutate();
        }}
        type="button"
      >
        {isPending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <CalendarPlus className="mr-2 h-4 w-4" />
        )}
        Add my shifts to Google Calendar
      </Button>
      {feedPath && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            Use Apple Calendar or Outlook instead?
          </summary>
          <p className="mt-2 mb-3 text-muted-foreground text-xs">
            These add a separate "Clock Out shifts" calendar that stays up to
            date. Keep it to yourself: anyone with the link can see your shifts.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              className={linkClass}
              onClick={() => {
                window.location.href = calendarSubscribeLinks(feedUrl()).apple;
              }}
              type="button"
            >
              Apple Calendar
            </button>
            <button
              className={linkClass}
              onClick={() =>
                window.open(
                  calendarSubscribeLinks(feedUrl()).outlook,
                  "_blank",
                  "noopener,noreferrer",
                )
              }
              type="button"
            >
              Outlook
            </button>
          </div>
        </details>
      )}
    </Card>
  );
}
