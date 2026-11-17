"use client";

import { useUser } from "@clerk/nextjs";
import { CalendarCheck, CalendarPlus, CalendarX, Loader2 } from "lucide-react";
import { Suspense, use, useState, useTransition } from "react";
import { toast } from "sonner";
import { disconnectGoogleCalendarAction } from "@/lib/google-calendar-actions";
import type { ScheduledShift } from "@/lib/types";
import { useAddToGoogleCalendar } from "./AddToGoogleCalendar";
import CalendarSubscribe from "./CalendarSubscribe";
import { Button, Card } from "./ui";

const shiftWord = (count: number) => (count === 1 ? "shift" : "shifts");

/**
 * Everything about getting your shifts onto your own calendar, in one place:
 * add them all to Google Calendar, stop syncing (and revoke access), or
 * subscribe from Apple Calendar / Outlook.
 */
export default function ScheduleCalendar({
  upcoming,
  googleConnectedPromise,
  calendarFeedPromise,
}: {
  /** Current and upcoming shifts; only the viewer's own are added. */
  upcoming: Pick<ScheduledShift, "id" | "user_id">[];
  googleConnectedPromise?: Promise<boolean>;
  calendarFeedPromise?: Promise<string | null>;
}) {
  const { user } = useUser();
  const mine = upcoming.filter((shift) => shift.user_id === user?.id);

  return (
    <Card className="p-6 sm:p-8">
      <div className="mb-4 flex items-start gap-3">
        <div className="rounded-xl bg-blue-600 p-2 text-white dark:bg-zinc-100 dark:text-black">
          <CalendarCheck className="h-5 w-5" />
        </div>
        <div>
          <h4 className="font-bold text-lg">Your calendar</h4>
          <p className="text-muted-foreground text-sm">
            Put your shifts on your own calendar. New, moved and cancelled
            shifts update there by themselves.
          </p>
        </div>
      </div>

      <GoogleCalendarControls
        connectedPromise={googleConnectedPromise}
        shiftIds={mine.map((shift) => shift.id)}
      />

      {calendarFeedPromise && (
        <div className="mt-4 border-zinc-100 border-t pt-4 dark:border-zinc-800">
          <Suspense fallback={null}>
            <CalendarSubscribe feedPathPromise={calendarFeedPromise} />
          </Suspense>
        </div>
      )}
    </Card>
  );
}

function GoogleCalendarControls({
  shiftIds,
  connectedPromise,
}: {
  shiftIds: number[];
  connectedPromise?: Promise<boolean>;
}) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      <AddAllButton shiftIds={shiftIds} />
      {connectedPromise && (
        <Suspense fallback={null}>
          <DisconnectButton connectedPromise={connectedPromise} />
        </Suspense>
      )}
    </div>
  );
}

function AddAllButton({ shiftIds }: { shiftIds: number[] }) {
  const { add, pending } = useAddToGoogleCalendar();
  const none = shiftIds.length === 0;
  return (
    <Button
      className="w-full sm:w-auto"
      disabled={pending || none}
      onClick={() => add(shiftIds)}
      title={none ? "You have no upcoming shifts" : undefined}
      type="button"
      variant="outline"
    >
      {pending ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <CalendarPlus className="mr-2 h-4 w-4" />
      )}
      {pending
        ? "Adding…"
        : none
          ? "No upcoming shifts to add"
          : `Add ${shiftIds.length} ${shiftWord(shiftIds.length)} to Google Calendar`}
    </Button>
  );
}

function DisconnectButton({
  connectedPromise,
}: {
  connectedPromise: Promise<boolean>;
}) {
  const initiallyConnected = use(connectedPromise);
  const [connected, setConnected] = useState(initiallyConnected);
  const [isPending, startTransition] = useTransition();
  if (!connected) return null;

  const disconnect = () => {
    if (
      !window.confirm(
        "Disconnect Google Calendar? Your upcoming shifts are taken off your Google Calendar and Clock Out loses access to it. You can add them again any time.",
      )
    ) {
      return;
    }
    startTransition(async () => {
      try {
        const res = await disconnectGoogleCalendarAction();
        if (res.status === "ok") {
          setConnected(false);
          toast.success(
            res.removed > 0
              ? `Google Calendar disconnected, ${res.removed} ${shiftWord(res.removed)} removed`
              : "Google Calendar disconnected",
          );
        } else {
          toast.error(res.error);
        }
      } catch {
        toast.error("Couldn't reach Google Calendar. Try again.");
      }
    });
  };

  return (
    <Button
      className="w-full sm:w-auto"
      disabled={isPending}
      onClick={disconnect}
      type="button"
      variant="outline"
    >
      {isPending ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <CalendarX className="mr-2 h-4 w-4" />
      )}
      {isPending ? "Disconnecting…" : "Disconnect Google Calendar"}
    </Button>
  );
}
