"use client";

import { useMutation } from "@tanstack/react-query";
import { Clock, Loader2, MapPin, Play, Square, Trash2 } from "lucide-react";
import { startTransition, useEffect, useState } from "react";
import { toast } from "sonner";
import { useTimeframeDefaults } from "@/hooks/useTimeframeDefaults";
import { clockInAction, clockOutAction } from "@/lib/actions";
import { getDockedMinutes, getEffectiveDurationMs } from "@/lib/break-utils";
import {
  type Coordinates,
  isCaptureEnabled,
  isLocationRequired,
} from "@/lib/geo";
import { captureCurrentPosition } from "@/lib/geolocation";
import type { EntryAction } from "@/lib/reducers/time-entries";
import type {
  BreakSettingsData,
  LocationSettingsData,
  TimeEntry,
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
  const [isLocating, setIsLocating] = useState(false);
  const captureLocation = isCaptureEnabled(locationSettings);
  const locationRequired = isLocationRequired(locationSettings);

  const activeEntry = initialEntries
    .filter((entry: TimeEntry) => entry.clock_out === null)
    .sort(
      (a, b) => new Date(b.clock_in).getTime() - new Date(a.clock_in).getTime(),
    )[0];

  useEffect(() => {
    if (!activeEntry) return;

    const interval = setInterval(() => {
      setElapsedTime(formatDuration(new Date(activeEntry.clock_in)));
    }, 1000);

    setElapsedTime(formatDuration(new Date(activeEntry.clock_in)));

    return () => clearInterval(interval);
  }, [activeEntry]);

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
          <p className="mb-8 flex items-center gap-2 text-muted-foreground">
            <Clock className="h-4 w-4" />
            Started at {new Date(activeEntry.clock_in).toLocaleTimeString()}
          </p>
          <Button
            className="h-16 w-full max-w-sm gap-3 rounded-2xl font-bold text-lg"
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
            className="h-16 w-full max-w-sm gap-3 rounded-2xl font-bold text-lg"
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

      <div className="mt-12 w-full text-left">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-bold text-lg">Recent Activity</h3>
        </div>
        <div className="space-y-3">
          {initialEntries.slice(0, 5).map((entry) => {
            const dockedMinutes = entry.clock_out
              ? getDockedMinutes(entry, breakSettings)
              : 0;
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
