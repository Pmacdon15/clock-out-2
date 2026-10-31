"use client";

import { useMutation } from "@tanstack/react-query";
import { Clock, Coffee, Loader2, Play, Square, Trash2 } from "lucide-react";
import { startTransition, useEffect, useState } from "react";
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
  getBreakDurationMs,
  getDockedMinutes,
  getEffectiveDurationMs,
  getOpenBreak,
  getUnpaidBreakMs,
  isPaidBreakType,
} from "@/lib/break-utils";
import type { EntryAction } from "@/lib/reducers/time-entries";
import type {
  BreakSettingsData,
  BreakType,
  TimeEntry,
  TimeEntryBreak,
} from "@/lib/types";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";
import { Button, Card } from "./ui";

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

interface ManageHoursProps {
  initialEntries: TimeEntry[];
  isAdmin: boolean;
  setOptimisticEntries: (action: EntryAction) => void;
  breakSettings?: BreakSettingsData | null;
}

export default function TimeClock({
  initialEntries = [],
  isAdmin,
  setOptimisticEntries,
  breakSettings,
}: ManageHoursProps) {
  useTimeframeDefaults();
  const [elapsedTime, setElapsedTime] = useState<string>("");
  const [breakElapsed, setBreakElapsed] = useState<string>("");
  const [breakType, setBreakType] = useState<BreakType>(DEFAULT_BREAK_TYPE);

  const activeEntry = initialEntries
    .filter((entry: TimeEntry) => entry.clock_out === null)
    .sort(
      (a, b) => new Date(b.clock_in).getTime() - new Date(a.clock_in).getTime(),
    )[0];

  const openBreak = getOpenBreak(activeEntry);

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
      return;
    }

    const tick = () =>
      setBreakElapsed(formatDurationMs(getBreakDurationMs(openBreak)));
    const interval = setInterval(tick, 1000);
    tick();

    return () => clearInterval(interval);
  }, [openBreak]);

  const clockInMutation = useMutation({
    mutationFn: clockInAction,
    onSuccess: (res) => {
      if (res.success) toast.success("Clocked in");
      else if ("error" in res) toast.error(res.error || "Failed to clock in");
    },
  });

  const clockOutMutation = useMutation({
    mutationFn: clockOutAction,
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

  const handleStartBreak = () => {
    // The break controls only render while there is an active entry.
    /* v8 ignore next -- @preserve */
    if (!activeEntry) return;

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

  const handleClockIn = () => {
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
      clockInMutation.mutate();
    });
  };

  const handleClockOut = () => {
    // The Clock Out button only renders while there is an active entry.
    /* v8 ignore next -- @preserve */
    if (!activeEntry) return;

    const now = new Date();

    startTransition(() => {
      setOptimisticEntries({
        type: "UPDATE",
        payload: {
          id: activeEntry.id,
          clock_out: now,
          updated_at: now,
        },
      });

      clockOutMutation.mutate();
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
          <p className="mb-4 flex items-center gap-2 text-muted-foreground">
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
            className="h-16 w-full max-w-sm gap-3 rounded-2xl font-bold text-lg"
            disabled={clockOutMutation.isPending}
            onClick={handleClockOut}
            variant="destructive"
          >
            {clockOutMutation.isPending ? (
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
            className="h-16 w-full max-w-sm gap-3 rounded-2xl font-bold text-lg"
            disabled={clockInMutation.isPending}
            onClick={handleClockIn}
          >
            {clockInMutation.isPending ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Play className="fill-current" />
            )}
            Clock In
          </Button>
        </>
      )}

      <div className="mt-12 w-full text-left">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-bold text-lg">Recent Activity</h3>
        </div>
        <div className="space-y-3">
          {initialEntries.slice(0, 5).map((entry) => {
            const dockedMinutes = entry.clock_out
              ? getDockedMinutes(entry, breakSettings)
              : 0;
            const unpaidBreakMinutes = Math.round(
              getUnpaidBreakMs(entry) / 60_000,
            );
            return (
              <div
                className="flex items-center justify-between rounded-xl border p-4 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900"
                key={entry.id}
              >
                <div className="flex flex-col">
                  <span className="font-semibold">
                    {new Date(entry.clock_in).toLocaleDateString()}
                  </span>
                  <span className="text-muted-foreground text-xs">
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
