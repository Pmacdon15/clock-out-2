"use client";

import { useUser } from "@clerk/nextjs";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { addShiftsToGoogleCalendarAction } from "@/lib/google-calendar-actions";
import { GOOGLE_CALENDAR_SCOPE } from "@/lib/google-calendar-scope";

/** Query parameter that carries the shifts to add back from Google's consent page. */
export const RESUME_PARAM = "addToGoogle";

const shiftWord = (count: number) => (count === 1 ? "shift" : "shifts");

function successMessage(added: number, updated: number) {
  if (added === 0) {
    return `Already on your Google Calendar (${updated} ${shiftWord(updated)} updated)`;
  }
  return updated === 0
    ? `Added ${added} ${shiftWord(added)} to your Google Calendar`
    : `Added ${added} ${shiftWord(added)} to your Google Calendar, updated ${updated}`;
}

/**
 * Adds shifts to the user's Google Calendar in one tap. The first time, it
 * sends them to Google to allow calendar access (linking Google if needed)
 * and finishes the add when they come back.
 */
export function useAddToGoogleCalendar() {
  const { user } = useUser();
  const [pending, setPending] = useState(false);

  const connect = async (shiftIds: number[]) => {
    if (!user) {
      toast.error("Sign in again to add shifts to Google Calendar");
      return;
    }
    const back = new URL(window.location.href);
    back.searchParams.set(RESUME_PARAM, shiftIds.join(","));
    const redirectUrl = back.toString();
    const additionalScopes = [GOOGLE_CALENDAR_SCOPE];
    const existing = user.externalAccounts.find(
      (account) => account.provider === "google",
    );
    const account = existing
      ? await existing.reauthorize({ additionalScopes, redirectUrl })
      : await user.createExternalAccount({
          strategy: "oauth_google",
          additionalScopes,
          redirectUrl,
        });
    const googleUrl = account.verification?.externalVerificationRedirectURL;
    if (!googleUrl) throw new Error("No Google consent URL");
    window.location.assign(googleUrl.href);
  };

  const add = async (
    shiftIds: number[],
    {
      fallbackUrl,
      resumed = false,
    }: { fallbackUrl?: string; resumed?: boolean } = {},
  ) => {
    setPending(true);
    try {
      const res = await addShiftsToGoogleCalendarAction(shiftIds);
      if (res.status === "ok") {
        toast.success(successMessage(res.added, res.updated));
      } else if (res.status === "connect") {
        if (resumed) {
          toast.error(
            "Google Calendar access wasn't allowed, so the shift wasn't added",
          );
        } else {
          await connect(shiftIds);
        }
      } else {
        toast.error(res.error);
        if (fallbackUrl) window.open(fallbackUrl, "_blank", "noopener");
      }
    } catch {
      toast.error("Couldn't reach Google Calendar. Try again.");
    } finally {
      setPending(false);
    }
  };

  return { add, pending };
}

/** Finishes an add after the user comes back from Google's consent page. */
export function GoogleCalendarResume() {
  const { add } = useAddToGoogleCalendar();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    const url = new URL(window.location.href);
    const raw = url.searchParams.get(RESUME_PARAM);
    if (raw === null) return;
    started.current = true;
    url.searchParams.delete(RESUME_PARAM);
    window.history.replaceState(window.history.state, "", url.toString());
    const ids = raw
      .split(",")
      .map(Number)
      .filter((id) => Number.isInteger(id) && id > 0);
    if (ids.length > 0) void add(ids, { resumed: true });
  }, [add]);

  return null;
}
