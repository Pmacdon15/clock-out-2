"use client";

import { useMutation } from "@tanstack/react-query";
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
import { useTimeframeDefaults } from "@/hooks/useTimeframeDefaults";
import {
  clockInAction,
  clockOutAction,
  endBreakAction,
  startBreakAction,
} from "@/lib/actions";
import {
  BREAK_TYPE_VALUES,
  BREAK_TYPES,
  breakTypeLabel,
  DEFAULT_BREAK_TYPE,
  getBreakDeadlineMs,
  getBreakDurationMs,
  getDockedMinutes,
  getEffectiveDurationMs,
  getOpenBreak,
  getUnpaidBreakMs,
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
import { Button, Card } from "./ui";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";

/** What the "back to work" dialog says about the break that just ran out. */
type ExpiredBreak = { label: string; limitMinutes: number };

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
  useTimeframeDefaults();
  const [elapsedTime, setElapsedTime] = useState<string>("");
  const [breakElapsed, setBreakElapsed] = useState<string>("");
  const [breakRemaining, setBreakRemaining] = useState<string>("");
  const [expiredBreak, setExpiredBreak] = useState<ExpiredBreak | null>(null);
  // The break already being auto-ended, so the ticker fires it only once.
  const autoEndedBreakId = useRef<number | null>(null);
  const [breakType, setBreakType] = useState<BreakType>(DEFAULT_BREAK_TYPE);
  const [isLocating, setIsLocating] = useState(false);
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
      if (res.success) toast.success("Clocked in");
      else if ("error" in res) toast.error(res.error || "Failed to clock in");
    },
  });

  const clockOutMutation = useMutation({
    mutationFn: (coordinates?: Coordinates) => clockOutAction(coordinates),
    onSuccess: (res) => {
      if (res.success) toast.success("Clocked out");
      else if ("error" in res) toast.error(res.error || "Failed to clock out");
    },
  });

  const startBreakMutation = useMutation({
    mutationFn: (type: BreakType) => startBreakAction(type),
    onSuccess: (res) => {
      if (res.success) toast.success("Break started");
      else if ("error" in res)
        toast.error(res.error || "Failed to start break");
    },
  });

  const endBreakMutation = useMutation({
    mutationFn: endBreakAction,
    onSuccess: (res) => {
      if (res.success) toast.success("Break ended");
      else if ("error" in res) toast.error(res.error || "Failed to end break");
    },
  });

  // Ends a break that ran past its limit and tells the member to get back
  // to work. The server caps the record at the limit, so it doesn't matter
  // how late this fires (e.g. the tab was asleep).
  const autoEnd = useMutation({
    mutationFn: endBreakAction,
    onSuccess: (res) => {
      if (!res.success && "error" in res)
        toast.error(res.error || "Failed to end break");
    },
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

    startTransition(() => {
      setOptimisticEntries({
        type: "UPDATE",
        payload: {
          id: activeEntry.id,
          breaks: breaks.map((b) =>
            b.id === brk.id ? { ...b, break_end: new Date(deadlineMs) } : b,
          ),
          updated_at: new Date(),
        },
      });
      autoEnd.mutate();
    });
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

    startTransition(() => {
      setOptimisticEntries({
        type: "UPDATE",
        payload: {
          id: activeEntry.id,
          breaks: [...(activeEntry.breaks ?? []), optimisticBreak],
          updated_at: now,
        },
      });

      startBreakMutation.mutate(breakType);
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

    startTransition(() => {
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

      endBreakMutation.mutate();
    });
  };

  /**
   * Asks the browser for coordinates. `undefined` means "send nothing": either
   * the browser could not help and capture is only optional, or the punch is
   * being abandoned (`aborted`), which happens when capture is required and
   * the browser refused. The server re-checks either way — the client's word
   * is evidence, never the verdict.
   */
  const resolveCoordinates = async (): Promise<
    { send: Coordinates | undefined } | { aborted: true }
  > => {
    setIsLocating(true);
    const capture = await captureCurrentPosition();
    setIsLocating(false);

    if (capture.ok) return { send: capture.coordinates };

    if (locationRequired) {
      toast.error(capture.failure.message);
      return { aborted: true };
    }
    // Capture is optional: say what happened, but don't block the punch.
    toast.warning(capture.failure.message);
    return { send: undefined };
  };

  const submitClockIn = (coordinates?: Coordinates) => {
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

    startTransition(() => {
      setOptimisticEntries({ type: "ADD", payload: tempEntry });
      clockInMutation.mutate(coordinates);
    });
  };

  const submitClockOut = (entry: TimeEntry, coordinates?: Coordinates) => {
    const now = new Date();

    startTransition(() => {
      setOptimisticEntries({
        type: "UPDATE",
        payload: {
          id: entry.id,
          clock_out: now,
          updated_at: now,
        },
      });

      clockOutMutation.mutate(coordinates);
    });
  };

  const handleClockIn = () => {
    triggerHaptic();

    // Orgs that never switched location on take exactly the old path: no
    // geolocation prompt, no extra tick before the optimistic entry appears.
    if (!captureLocation) {
      submitClockIn();
      return;
    }

    void resolveCoordinates().then((resolved) => {
      if ("aborted" in resolved) return;
      submitClockIn(resolved.send);
    });
  };

  const handleClockOut = () => {
    // The Clock Out button only renders while there is an active entry.
    /* v8 ignore next -- @preserve */
    if (!activeEntry) return;

    triggerHaptic();

    if (!captureLocation) {
      submitClockOut(activeEntry);
      return;
    }

    // Clocking out is never geofenced, so a capture failure is not fatal.
    void resolveCoordinates().then((resolved) => {
      submitClockOut(
        activeEntry,
        "aborted" in resolved ? undefined : resolved.send,
      );
    });
  };

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
          <p
            className="mb-4 flex items-center gap-2 text-muted-foreground"
            suppressHydrationWarning
          >
            <Clock className="h-4 w-4" />
            Started at {new Date(activeEntry.clock_in).toLocaleTimeString()}
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
                  {BREAK_TYPE_VALUES.map((value) => (
                    <option key={value} value={value}>
                      {BREAK_TYPES[value].label} (
                      {BREAK_TYPES[value].paid ? "paid" : "unpaid"})
                    </option>
                  ))}
                </select>
                <Button
                  disabled={startBreakMutation.isPending}
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
            disabled={clockOutMutation.isPending || isLocating}
            onClick={handleClockOut}
            variant="destructive"
          >
            {clockOutMutation.isPending || isLocating ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Square className="fill-current" />
            )}
            Clock Out
          </Button>
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
            disabled={clockInMutation.isPending || isLocating}
            onClick={handleClockIn}
          >
            {clockInMutation.isPending || isLocating ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Play className="fill-current" />
            )}
            {isLocating ? "Checking location..." : "Clock In"}
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
        // There is no trigger, so the only change is the member closing it.
        onOpenChange={() => setExpiredBreak(null)}
        open={expiredBreak !== null}
      >
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
                key={entry.id}
              >
                <div className="flex flex-col">
                  <span className="font-semibold" suppressHydrationWarning>
                    {new Date(entry.clock_in).toLocaleDateString()}
                  </span>
                  <span
                    className="text-muted-foreground text-xs"
                    suppressHydrationWarning
                  >
                    {new Date(entry.clock_in).toLocaleTimeString()} -{" "}
                    {entry.clock_out
                      ? new Date(entry.clock_out).toLocaleTimeString()
                      : "Current"}
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
