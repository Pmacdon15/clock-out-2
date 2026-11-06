"use client";

import { useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Clock,
  Coffee,
  Loader2,
  MapPin,
  Play,
  Square,
  Trash2,
} from "lucide-react";
import { startTransition, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  clockInAction,
  clockOutAction,
  endBreakAction,
  startBreakAction,
} from "@/lib/actions";
import {
  BREAK_TYPES,
  breakCountLimitMessage,
  breakTypeLabel,
  getBreakDeadlineMs,
  getBreakDurationMs,
  getDockedMinutes,
  getEffectiveDurationMs,
  getOfferedBreakTypes,
  getOpenBreak,
  getRemainingBreakCount,
  getUnpaidBreakMs,
  isBreakCountReached,
  isPaidBreakType,
} from "@/lib/break-utils";
import {
  type Coordinates,
  isCaptureEnabled,
  isLocationRequired,
} from "@/lib/geo";
import { captureCurrentPosition } from "@/lib/geolocation";
import type { EntryAction } from "@/lib/reducers/time-entries";
import type {
  BreakSettingsData,
  BreakType,
  LocationSettingsData,
  TimeEntry,
  TimeEntryBreak,
} from "@/lib/types";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";
import LocalTime from "./LocalTime";
import { Button, Card } from "./ui";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";

/**
 * Punch and break toasts share one id so a new one replaces the last instead
 * of stacking when someone punches in and out in quick succession.
 */
const CLOCK_TOAST = { id: "time-clock" } as const;
/** Location problems get their own slot so the punch result can't hide them. */
const LOCATION_TOAST = { id: "time-clock-location" } as const;

/**
 * Waits for a mutation inside an async transition, so the optimistic state
 * stays up until the server action (and the refresh it triggers) lands, and
 * the view swaps once instead of flickering back to the old state. Failures
 * are already reported by the mutation's own callbacks.
 */
const settle = async (pending: Promise<unknown>) => {
  try {
    await pending;
  } catch {
    // Reported by onError; the optimistic state rolls back on its own.
  }
};

/** What the "back to work" dialog says about the break that just ran out. */
type ExpiredBreak = { label: string; limitMinutes: number };

/**
 * How long the "back to work" dialog takes to cover the card. The break view
 * swaps to the break picker only after that, so the card's change in height
 * happens under the overlay instead of as a jump beside the opening dialog.
 */
const BACK_TO_WORK_COVER_MS = 200;

const formatDurationMs = (diffMs: number) => {
  const totalMinutes = Math.floor(Math.max(0, diffMs) / (1000 * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
};

const formatDuration = (start: Date, end: Date = new Date()) =>
  formatDurationMs(Math.abs(end.getTime() - start.getTime()));

/* v8 ignore start */
const triggerHaptic = () => {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try {
      navigator.vibrate(40);
    } catch {
      // Vibration not supported or allowed
    }
  }
};
/* v8 ignore stop */

interface ManageHoursProps {
  initialEntries: TimeEntry[];
  isAdmin: boolean;
  setOptimisticEntries: (action: EntryAction) => void;
  breakSettings?: BreakSettingsData | null;
  locationSettings?: LocationSettingsData | null;
}

export default function TimeClock({
  initialEntries = [],
  isAdmin,
  setOptimisticEntries,
  breakSettings,
  locationSettings,
}: ManageHoursProps) {
  const [elapsedTime, setElapsedTime] = useState<string>("");
  const [breakElapsed, setBreakElapsed] = useState<string>("");
  const [breakRemaining, setBreakRemaining] = useState<string>("");
  // Kept after the dialog closes so its text doesn't empty mid fade-out.
  const [expiredBreak, setExpiredBreak] = useState<ExpiredBreak | null>(null);
  const [backToWorkOpen, setBackToWorkOpen] = useState(false);
  const [confirmingClockOut, setConfirmingClockOut] = useState(false);
  // The break already being auto-ended, so the ticker fires it only once.
  const autoEndedBreakId = useRef<number | null>(null);
  // The kinds the org offers, lunch (paid or unpaid, per the org) first.
  const offeredBreakTypes = getOfferedBreakTypes(breakSettings);
  const [pickedBreakType, setBreakType] = useState<BreakType | null>(null);
  // Defaults to lunch, and falls back to it if the org's lunch pay changes.
  const breakType =
    pickedBreakType && offeredBreakTypes.includes(pickedBreakType)
      ? pickedBreakType
      : offeredBreakTypes[0];
  // Which punch is waiting on the browser for a position, if any.
  const [locatingFor, setLocatingFor] = useState<"in" | "out" | null>(null);
  const isLocating = locatingFor !== null;
  const captureLocation = isCaptureEnabled(locationSettings);
  const locationRequired = isLocationRequired(locationSettings);

  const activeEntry = initialEntries
    .filter((entry: TimeEntry) => entry.clock_out === null)
    .sort(
      (a, b) => new Date(b.clock_in).getTime() - new Date(a.clock_in).getTime(),
    )[0];

  const openBreak = getOpenBreak(activeEntry);
  // When the running break hits its type's limit, if the org set one.
  const breakDeadlineMs = openBreak
    ? getBreakDeadlineMs(openBreak, breakSettings)
    : null;

  // Per-shift break count limits, if the org set any.
  const selectedBreakUsedUp = isBreakCountReached(
    activeEntry,
    breakType,
    breakSettings,
  );
  const selectedBreaksLeft = getRemainingBreakCount(
    activeEntry,
    breakType,
    breakSettings,
  );

  useEffect(() => {
    if (!activeEntry) return;

    const interval = setInterval(() => {
      setElapsedTime(formatDuration(new Date(activeEntry.clock_in)));
    }, 1000);

    setElapsedTime(formatDuration(new Date(activeEntry.clock_in)));

    return () => clearInterval(interval);
  }, [activeEntry]);

  useEffect(() => {
    if (!openBreak) {
      setBreakElapsed("");
      setBreakRemaining("");
      return;
    }

    const tick = () => {
      const nowMs = Date.now();
      setBreakElapsed(formatDurationMs(getBreakDurationMs(openBreak, nowMs)));
      if (breakDeadlineMs === null) {
        setBreakRemaining("");
        return;
      }
      // Round up so the last minute reads "1m left", not "0m left".
      setBreakRemaining(
        formatDurationMs(
          Math.ceil(Math.max(0, breakDeadlineMs - nowMs) / 60_000) * 60_000,
        ),
      );
      if (nowMs >= breakDeadlineMs) autoEndBreak(openBreak, breakDeadlineMs);
    };
    const interval = setInterval(tick, 1000);
    tick();

    return () => clearInterval(interval);
  });

  const clockInMutation = useMutation({
    mutationFn: (coordinates?: Coordinates) => clockInAction(coordinates),
    onSuccess: (res) => {
      if (res.success) toast.success("Clocked in", CLOCK_TOAST);
      else if ("error" in res)
        toast.error(res.error || "Failed to clock in", CLOCK_TOAST);
    },
    onError: () => toast.error("Failed to clock in", CLOCK_TOAST),
  });

  const clockOutMutation = useMutation({
    mutationFn: (coordinates?: Coordinates) => clockOutAction(coordinates),
    onSuccess: (res) => {
      if (res.success) toast.success("Clocked out", CLOCK_TOAST);
      else if ("error" in res)
        toast.error(res.error || "Failed to clock out", CLOCK_TOAST);
    },
    onError: () => toast.error("Failed to clock out", CLOCK_TOAST),
  });

  const startBreakMutation = useMutation({
    mutationFn: (type: BreakType) => startBreakAction(type),
    onSuccess: (res) => {
      if (res.success) toast.success("Break started", CLOCK_TOAST);
      else if ("error" in res)
        toast.error(res.error || "Failed to start break", CLOCK_TOAST);
    },
    onError: () => toast.error("Failed to start break", CLOCK_TOAST),
  });

  const endBreakMutation = useMutation({
    mutationFn: endBreakAction,
    onSuccess: (res) => {
      if (res.success) toast.success("Break ended", CLOCK_TOAST);
      else if ("error" in res)
        toast.error(res.error || "Failed to end break", CLOCK_TOAST);
    },
    onError: () => toast.error("Failed to end break", CLOCK_TOAST),
  });

  // Ends a break that ran past its limit and tells the member to get back
  // to work. The server caps the record at the limit, so it doesn't matter
  // how late this fires (e.g. the tab was asleep).
  const autoEnd = useMutation({
    mutationFn: endBreakAction,
    onSuccess: (res) => {
      if (!res.success && "error" in res)
        toast.error(res.error || "Failed to end break", CLOCK_TOAST);
    },
    onError: () => toast.error("Failed to end break", CLOCK_TOAST),
  });

  function autoEndBreak(brk: TimeEntryBreak, deadlineMs: number) {
    // The ticker only runs while a break is open on the active entry.
    /* v8 ignore next -- @preserve */
    if (!activeEntry) return;
    if (autoEndedBreakId.current === brk.id) return;
    autoEndedBreakId.current = brk.id;

    const breaks = activeEntry.breaks as TimeEntryBreak[];
    setExpiredBreak({
      label: breakTypeLabel(brk.break_type),
      limitMinutes: Math.round(
        (deadlineMs - new Date(brk.break_start).getTime()) / 60_000,
      ),
    });
    setBackToWorkOpen(true);

    // The server caps the break at its deadline, so waiting for the dialog
    // to cover the card changes nothing on the record.
    const entryId = activeEntry.id;
    setTimeout(() => {
      startTransition(async () => {
        setOptimisticEntries({
          type: "UPDATE",
          payload: {
            id: entryId,
            breaks: breaks.map((b) =>
              b.id === brk.id ? { ...b, break_end: new Date(deadlineMs) } : b,
            ),
            updated_at: new Date(),
          },
        });
        await settle(autoEnd.mutateAsync());
      });
    }, BACK_TO_WORK_COVER_MS);
  }

  const handleStartBreak = () => {
    // The break controls only render while there is an active entry.
    /* v8 ignore next -- @preserve */
    if (!activeEntry) return;

    triggerHaptic();

    const now = new Date();
    const optimisticBreak: TimeEntryBreak = {
      // Negative so it cannot collide with a real row id.
      id: -now.getTime(),
      time_entry_id: activeEntry.id,
      break_type: breakType,
      break_start: now,
      break_end: null,
    };

    startTransition(async () => {
      setOptimisticEntries({
        type: "UPDATE",
        payload: {
          id: activeEntry.id,
          breaks: [...(activeEntry.breaks ?? []), optimisticBreak],
          updated_at: now,
        },
      });

      await settle(startBreakMutation.mutateAsync(breakType));
    });
  };

  const handleEndBreak = () => {
    // The End Break button only renders while a break is running.
    /* v8 ignore next -- @preserve */
    if (!activeEntry || !openBreak) return;

    triggerHaptic();

    const now = new Date();
    // `openBreak` came out of this list, so the list is always there.
    const breaks = activeEntry.breaks as TimeEntryBreak[];

    startTransition(async () => {
      setOptimisticEntries({
        type: "UPDATE",
        payload: {
          id: activeEntry.id,
          breaks: breaks.map((brk) =>
            brk.id === openBreak.id ? { ...brk, break_end: now } : brk,
          ),
          updated_at: now,
        },
      });

      await settle(endBreakMutation.mutateAsync());
    });
  };

  /**
   * Asks the browser for coordinates. `undefined` means "send nothing": either
   * the browser could not help and capture is only optional, or the punch is
   * being abandoned (`aborted`), which happens when capture is required and
   * the browser refused. The server re-checks either way — the client's word
   * is evidence, never the verdict.
   *
   * The caller sets `locatingFor` before its transition starts (a set inside
   * the transition would only show once the whole punch had finished); this
   * clears it as soon as the browser answers.
   */
  const resolveCoordinates = async (): Promise<
    { send: Coordinates | undefined } | { aborted: true }
  > => {
    const capture = await captureCurrentPosition().finally(() =>
      setLocatingFor(null),
    );

    if (capture.ok) return { send: capture.coordinates };

    if (locationRequired) {
      toast.error(capture.failure.message, LOCATION_TOAST);
      return { aborted: true };
    }
    // Capture is optional: say what happened, but don't block the punch.
    toast.warning(capture.failure.message, LOCATION_TOAST);
    return { send: undefined };
  };

  /**
   * The punch shows straight away and the location check runs behind it. If a
   * required location can't be had, the transition ends without a punch and
   * React drops the optimistic entry, so the view returns to "ready".
   */
  const handleClockIn = () => {
    triggerHaptic();

    // Orgs that never switched location on take exactly the old path: no
    // geolocation prompt at all.
    if (captureLocation) setLocatingFor("in");

    const now = new Date();
    const tempEntry: TimeEntry = {
      id: Math.random(),
      user_id: "current",
      org_id: "current",
      clock_in: now,
      clock_out: null,
      created_at: now,
      updated_at: now,
    };

    startTransition(async () => {
      setOptimisticEntries({ type: "ADD", payload: tempEntry });

      let coordinates: Coordinates | undefined;
      if (captureLocation) {
        const resolved = await resolveCoordinates();
        if ("aborted" in resolved) return;
        coordinates = resolved.send;
      }

      await settle(clockInMutation.mutateAsync(coordinates));
    });
  };

  const handleClockOut = () => {
    setConfirmingClockOut(false);
    // The confirm dialog only opens while there is an active entry.
    /* v8 ignore next -- @preserve */
    if (!activeEntry) return;

    triggerHaptic();

    if (captureLocation) setLocatingFor("out");

    const entry = activeEntry;
    const now = new Date();

    startTransition(async () => {
      setOptimisticEntries({
        type: "UPDATE",
        payload: {
          id: entry.id,
          clock_out: now,
          updated_at: now,
        },
      });

      let coordinates: Coordinates | undefined;
      if (captureLocation) {
        // Clocking out is never geofenced, so a capture failure is not fatal.
        const resolved = await resolveCoordinates();
        coordinates = "aborted" in resolved ? undefined : resolved.send;
      }

      await settle(clockOutMutation.mutateAsync(coordinates));
    });
  };

  // A punch is in flight until the server answers; the other button waits.
  const isPunching =
    clockInMutation.isPending || clockOutMutation.isPending || isLocating;

  return (
    <Card className="mb-8 flex flex-col items-center justify-center p-8 text-center sm:p-12">
      {activeEntry ? (
        <>
          <div className="mb-6 flex items-center gap-2 rounded-full bg-green-100 px-3 py-1 font-medium text-green-700 text-sm dark:bg-green-900/30 dark:text-green-500">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500"></span>
            </span>
            Active Session
          </div>
          <div className="mb-2 font-black font-mono text-6xl tracking-tighter">
            {elapsedTime || "0m"}
          </div>
          <p className="mb-4 flex items-center gap-2 text-muted-foreground">
            <Clock className="h-4 w-4" />
            Started at{" "}
            <LocalTime>
              {() => format(new Date(activeEntry.clock_in), "h:mm a")}
            </LocalTime>
          </p>

          <div className="mb-8 flex w-full max-w-sm flex-col gap-3">
            {openBreak ? (
              <>
                <div
                  className="flex items-center justify-center gap-2 rounded-full bg-amber-100 px-3 py-1 font-medium text-amber-700 text-sm dark:bg-amber-900/30 dark:text-amber-400"
                  data-testid="running-break"
                >
                  <Coffee className="h-4 w-4" />
                  On {breakTypeLabel(openBreak.break_type)} ·{" "}
                  {breakElapsed || "0m"} ·{" "}
                  {isPaidBreakType(openBreak.break_type)
                    ? "paid"
                    : "unpaid (deducted)"}
                </div>
                {breakRemaining && (
                  <p
                    className="text-muted-foreground text-xs"
                    data-testid="break-remaining"
                  >
                    {breakRemaining} left · you'll be clocked back in
                    automatically
                  </p>
                )}
                <Button
                  disabled={endBreakMutation.isPending}
                  onClick={handleEndBreak}
                  variant="outline"
                >
                  {endBreakMutation.isPending ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Coffee className="h-4 w-4" />
                  )}
                  End Break
                </Button>
              </>
            ) : (
              <>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <label className="sr-only" htmlFor="break-type">
                    Break type
                  </label>
                  <select
                    className="flex-1 rounded-xl border bg-white px-3 py-2 text-sm dark:bg-zinc-950"
                    id="break-type"
                    onChange={(e) => setBreakType(e.target.value as BreakType)}
                    value={breakType}
                  >
                    {offeredBreakTypes.map((value) => (
                      <option
                        disabled={isBreakCountReached(
                          activeEntry,
                          value,
                          breakSettings,
                        )}
                        key={value}
                        value={value}
                      >
                        {BREAK_TYPES[value].label} (
                        {BREAK_TYPES[value].paid ? "paid" : "unpaid"})
                      </option>
                    ))}
                  </select>
                  <Button
                    disabled={
                      startBreakMutation.isPending || selectedBreakUsedUp
                    }
                    onClick={handleStartBreak}
                    variant="outline"
                  >
                    {startBreakMutation.isPending ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Coffee className="h-4 w-4" />
                    )}
                    Start Break
                  </Button>
                </div>
                {selectedBreakUsedUp ? (
                  <p
                    className="text-amber-700 text-xs dark:text-amber-400"
                    data-testid="break-count-limit"
                    role="status"
                  >
                    {breakCountLimitMessage(breakType, breakSettings)}
                  </p>
                ) : (
                  selectedBreaksLeft !== null && (
                    <p
                      className="text-muted-foreground text-xs"
                      data-testid="breaks-left"
                    >
                      {selectedBreaksLeft}{" "}
                      {isPaidBreakType(breakType) ? "paid" : "unpaid"} break
                      {selectedBreaksLeft === 1 ? "" : "s"} left this shift
                    </p>
                  )
                )}
              </>
            )}
            {getUnpaidBreakMs(activeEntry) > 0 && (
              <p className="text-muted-foreground text-xs">
                {formatDurationMs(getUnpaidBreakMs(activeEntry))} of unpaid
                break deducted so far
              </p>
            )}
          </div>

          <Button
            className="h-16 w-full max-w-sm gap-3 rounded-2xl font-bold text-lg transition-transform active:scale-[0.98] touch-manipulation"
            disabled={isPunching}
            onClick={() => setConfirmingClockOut(true)}
            variant="destructive"
          >
            {isPunching ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Square className="fill-current" />
            )}
            Clock Out
          </Button>
          {locatingFor === "in" && (
            <p
              className="mt-4 flex items-center gap-1.5 text-muted-foreground text-xs"
              role="status"
            >
              <MapPin className="h-3 w-3" />
              Checking location...
            </p>
          )}
        </>
      ) : (
        <>
          <div className="mb-6 flex items-center gap-2 rounded-full border bg-zinc-100 px-3 py-1 font-medium text-sm text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
            Offline
          </div>
          <div className="mb-8 font-black text-4xl tracking-tight">
            Ready to start your shift?
          </div>
          <Button
            className="h-16 w-full max-w-sm gap-3 rounded-2xl font-bold text-lg transition-transform active:scale-[0.98] touch-manipulation"
            disabled={isPunching}
            onClick={handleClockIn}
          >
            {isPunching ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Play className="fill-current" />
            )}
            {locatingFor === "in" ? "Checking location..." : "Clock In"}
          </Button>
          {captureLocation && (
            <p className="mt-4 flex items-center gap-1.5 text-muted-foreground text-xs">
              <MapPin className="h-3 w-3" />
              {locationRequired
                ? "Your organization requires your location to clock in."
                : "Your location is recorded with this punch when your browser shares it."}
            </p>
          )}
        </>
      )}

      <AlertDialog
        onOpenChange={setConfirmingClockOut}
        open={confirmingClockOut && activeEntry !== undefined}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clock out now?</AlertDialogTitle>
            <AlertDialogDescription>
              {`This ends your current shift${elapsedTime ? ` after ${elapsedTime}` : ""}.`}
              {openBreak
                ? ` Your ${breakTypeLabel(openBreak.break_type).toLowerCase()} will end too.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleClockOut}>
              Yes, clock out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog onOpenChange={setBackToWorkOpen} open={backToWorkOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Break's over — time to get back to work
            </AlertDialogTitle>
            <AlertDialogDescription>
              {expiredBreak
                ? `Your ${expiredBreak.label.toLowerCase()} reached the ${expiredBreak.limitMinutes}-minute limit set by your organization, so you've been clocked back in automatically.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction>Back to work</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="mt-12 w-full text-left">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-bold text-lg">Recent Activity</h3>
        </div>
        <div className="space-y-3">
          {initialEntries.slice(0, 5).map((entry) => {
            const dockedMinutes = getDockedMinutes(entry, breakSettings);
            const unpaidBreakMinutes = Math.round(
              getUnpaidBreakMs(entry) / 60_000,
            );
            return (
              <div
                className="flex items-center justify-between rounded-xl border p-4 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900"
                // The open shift keeps one key from its optimistic stand-in
                // to the saved row, so the list doesn't remount it.
                key={entry === activeEntry ? "active" : entry.id}
              >
                <div className="flex flex-col">
                  <span className="font-semibold">
                    <LocalTime>
                      {() => new Date(entry.clock_in).toLocaleDateString()}
                    </LocalTime>
                  </span>
                  <span className="text-muted-foreground text-xs">
                    <LocalTime>
                      {() =>
                        `${format(new Date(entry.clock_in), "h:mm a")} - ${
                          entry.clock_out
                            ? format(new Date(entry.clock_out), "h:mm a")
                            : "Current"
                        }`
                      }
                    </LocalTime>
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  {unpaidBreakMinutes > 0 && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 font-bold text-[10px] text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                      -{unpaidBreakMinutes}m unpaid break
                    </span>
                  )}
                  {entry.skip_lunch ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 font-bold text-[10px] text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                      Not docked
                    </span>
                  ) : (
                    dockedMinutes > 0 && (
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 font-bold text-[10px] text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                        -{dockedMinutes}m break
                      </span>
                    )
                  )}
                  <div className="rounded-md bg-zinc-100 px-3 py-1 font-bold font-mono text-sm dark:bg-zinc-800">
                    {entry.clock_out
                      ? formatDurationMs(
                          getEffectiveDurationMs(entry, breakSettings),
                        )
                      : "Active"}
                  </div>
                  {isAdmin && (
                    <DeleteConfirmDialog
                      entryId={entry.id}
                      setOptimisticEntries={setOptimisticEntries}
                      trigger={
                        <button
                          className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                          type="button"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      }
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
