"use client";

import { useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Calendar,
  Check,
  Coffee,
  Edit3,
  Loader2,
  MapPin,
  X,
} from "lucide-react";
import { startTransition, useState } from "react";
import { toast } from "sonner";
import { deleteBreakAction, updateTimeEntryAction } from "@/lib/actions";
import {
  breakTypeLabel,
  getBreakDurationMs,
  getDockedMinutes,
  getEffectiveHours,
  getUnpaidBreakMs,
  isPaidBreakType,
} from "@/lib/break-utils";
import { formatCoordinates } from "@/lib/geo";
import type { EntryAction } from "@/lib/reducers/time-entries";
import type { BreakSettingsData, TimeEntry, TimeEntryBreak } from "@/lib/types";
import { DeleteConfirmDialog } from "../DeleteConfirmDialog";

interface EntryItemProps {
  entry: TimeEntry;
  isAdmin: boolean;
  setOptimisticEntries: (action: EntryAction) => void;
  memberName?: string;
  breakSettings?: BreakSettingsData | null;
}

export function EntryItem({
  entry,
  isAdmin,
  setOptimisticEntries,
  memberName,
  breakSettings,
}: EntryItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editClockIn, setEditClockIn] = useState(
    format(new Date(entry.clock_in), "yyyy-MM-dd'T'HH:mm"),
  );
  const [editClockOut, setEditClockOut] = useState(
    entry.clock_out
      ? format(new Date(entry.clock_out), "yyyy-MM-dd'T'HH:mm")
      : "",
  );
  const [editSkipLunch, setEditSkipLunch] = useState(Boolean(entry.skip_lunch));

  const deleteBreakMutation = useMutation({
    mutationFn: (breakId: number) => deleteBreakAction(breakId),
    onSuccess: (res) => {
      if (res.success) toast.success("Break removed");
      else if ("error" in res)
        toast.error(res.error || "Failed to remove break");
    },
  });

  const handleDeleteBreak = (breakId: number) => {
    // The remove button only renders for a break of this entry's own list.
    const recorded = entry.breaks as TimeEntryBreak[];
    startTransition(() => {
      setOptimisticEntries({
        type: "UPDATE",
        payload: {
          id: entry.id,
          breaks: recorded.filter((brk) => brk.id !== breakId),
          updated_at: new Date(),
        },
      });

      deleteBreakMutation.mutate(breakId);
    });
  };

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      clock_in,
      clock_out,
      skip_lunch,
    }: {
      id: number;
      clock_in: string;
      clock_out: string;
      skip_lunch: boolean;
    }) => updateTimeEntryAction(id, clock_in, clock_out, skip_lunch),
    onSuccess: (res) => {
      if (res.success) {
        toast.success("Entry updated");
        setIsEditing(false);
      } else if ("error" in res) {
        toast.error(res.error || "Failed to update");
      }
    },
  });

  const handleUpdate = () => {
    const updatedData = {
      id: entry.id,
      clock_in: new Date(editClockIn),
      clock_out: editClockOut ? new Date(editClockOut) : null,
      skip_lunch: editSkipLunch,
      updated_at: new Date(),
    };

    startTransition(() => {
      setOptimisticEntries({ type: "UPDATE", payload: updatedData });

      updateMutation.mutate({
        id: entry.id,
        clock_in: new Date(editClockIn).toISOString(),
        clock_out: editClockOut ? new Date(editClockOut).toISOString() : "",
        skip_lunch: editSkipLunch,
      });
    });
  };

  if (isEditing) {
    return (
      <div className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/50">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label
              className="font-bold text-[10px] text-zinc-400 uppercase"
              htmlFor={`edit-in-${entry.id}`}
            >
              Clock In
            </label>
            <input
              className="w-full rounded-lg border bg-white p-2 text-xs outline-none focus:ring-1 focus:ring-zinc-400 dark:bg-zinc-950"
              id={`edit-in-${entry.id}`}
              onChange={(e) => setEditClockIn(e.target.value)}
              type="datetime-local"
              value={editClockIn}
            />
          </div>
          <div className="space-y-1">
            <label
              className="font-bold text-[10px] text-zinc-400 uppercase"
              htmlFor={`edit-out-${entry.id}`}
            >
              Clock Out
            </label>
            <input
              className="w-full rounded-lg border bg-white p-2 text-xs outline-none focus:ring-1 focus:ring-zinc-400 dark:bg-zinc-950"
              id={`edit-out-${entry.id}`}
              onChange={(e) => setEditClockOut(e.target.value)}
              type="datetime-local"
              value={editClockOut}
            />
          </div>
        </div>
        <label
          className="flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 font-medium text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300"
          htmlFor={`edit-skip-lunch-${entry.id}`}
        >
          <input
            checked={editSkipLunch}
            className="h-4 w-4 rounded border-zinc-300 accent-zinc-900 dark:accent-zinc-100"
            id={`edit-skip-lunch-${entry.id}`}
            onChange={(e) => setEditSkipLunch(e.target.checked)}
            type="checkbox"
          />
          <span>Skipped lunch / break (do not dock)</span>
        </label>
        <div className="flex justify-end gap-2">
          <button
            className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-200 dark:hover:bg-zinc-800"
            onClick={() => setIsEditing(false)}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
          <button
            className="rounded-lg bg-zinc-900 p-1.5 text-white transition-transform hover:scale-105 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950"
            disabled={updateMutation.isPending}
            onClick={handleUpdate}
            type="button"
          >
            {updateMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
    );
  }

  const dockedMinutes = getDockedMinutes(entry, breakSettings);
  const effectiveHours = getEffectiveHours(entry, breakSettings);
  const breaks = entry.breaks ?? [];
  const unpaidBreakMinutes = Math.round(getUnpaidBreakMs(entry) / 60_000);
  // Only admins see where a punch happened, and only when the org captured it.
  const punches = isAdmin
    ? [
        {
          label: "In",
          latitude: entry.clock_in_latitude,
          longitude: entry.clock_in_longitude,
          accuracy: entry.clock_in_accuracy_m,
          siteName: entry.clock_in_site_name,
        },
        {
          label: "Out",
          latitude: entry.clock_out_latitude,
          longitude: entry.clock_out_longitude,
          accuracy: entry.clock_out_accuracy_m,
          siteName: entry.clock_out_site_name,
        },
      ].filter(
        (punch) =>
          typeof punch.latitude === "number" &&
          typeof punch.longitude === "number",
      )
    : [];

  return (
    <div className="group flex flex-col gap-2 border-zinc-100 border-b pb-5 transition-all last:border-0 dark:border-zinc-800">
      <div className="flex items-center justify-between font-bold text-sm">
        <span>{format(new Date(entry.clock_in), "eeee, MMM d")}</span>
        <div className="flex items-center gap-3">
          <span className="tabular-nums">{effectiveHours.toFixed(2)}h</span>
          {isAdmin && (
            <div className="flex items-center gap-1 opacity-100 transition-opacity lg:opacity-0 lg:group-hover:opacity-100">
              <button
                className="p-1 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
                onClick={() => setIsEditing(true)}
                type="button"
              >
                <Edit3 className="h-3.5 w-3.5" />
              </button>
              <DeleteConfirmDialog
                entryId={entry.id}
                setOptimisticEntries={setOptimisticEntries}
              />
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 font-medium text-muted-foreground text-xs">
        <Calendar className="h-3 w-3" />
        <span>
          {format(new Date(entry.clock_in), "hh:mm a")} -{" "}
          {entry.clock_out
            ? format(new Date(entry.clock_out), "hh:mm a")
            : "..."}
        </span>
        {unpaidBreakMinutes > 0 && (
          <span className="ml-1.5 rounded-full bg-amber-100 px-2 py-0.5 font-bold text-[10px] text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
            -{unpaidBreakMinutes}m unpaid break
          </span>
        )}
        {entry.skip_lunch ? (
          <span className="ml-1.5 rounded-full bg-amber-100 px-2 py-0.5 font-bold text-[10px] text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
            Not docked
          </span>
        ) : (
          dockedMinutes > 0 && (
            <span className="ml-1.5 rounded-full bg-blue-100 px-2 py-0.5 font-bold text-[10px] text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
              -{dockedMinutes}m break
            </span>
          )
        )}
        {memberName && (
          <span className="ml-1.5 rounded-full bg-zinc-100 px-2 py-0.5 font-bold text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
            {memberName}
          </span>
        )}
      </div>
      {breaks.length > 0 && (
        <ul
          className="space-y-1 border-zinc-100 border-l pl-3 dark:border-zinc-800"
          data-testid={`breaks-${entry.id}`}
        >
          {breaks.map((brk) => (
            <li
              className="flex items-center gap-1.5 text-muted-foreground text-xs"
              key={brk.id}
            >
              <Coffee className="h-3 w-3" />
              <span className="font-medium">
                {breakTypeLabel(brk.break_type)}
              </span>
              <span>
                {format(new Date(brk.break_start), "hh:mm a")} -{" "}
                {brk.break_end
                  ? format(new Date(brk.break_end), "hh:mm a")
                  : "..."}
              </span>
              <span className="tabular-nums">
                {Math.round(getBreakDurationMs(brk) / 60_000)}m
              </span>
              <span
                className={
                  isPaidBreakType(brk.break_type)
                    ? "rounded-full bg-emerald-100 px-2 py-0.5 font-bold text-[10px] text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                    : "rounded-full bg-amber-100 px-2 py-0.5 font-bold text-[10px] text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                }
              >
                {isPaidBreakType(brk.break_type) ? "Paid" : "Unpaid"}
              </span>
              {isAdmin && (
                <button
                  aria-label="Remove break"
                  className="p-1 transition-colors hover:text-red-500"
                  disabled={deleteBreakMutation.isPending}
                  onClick={() => handleDeleteBreak(brk.id)}
                  type="button"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {punches.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 font-medium text-[10px] text-muted-foreground">
          {punches.map((punch) => (
            <span
              className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400"
              key={punch.label}
            >
              <MapPin className="h-3 w-3" />
              <span className="font-bold">{punch.label}</span>
              <span className="tabular-nums">
                {formatCoordinates(
                  punch.latitude as number,
                  punch.longitude as number,
                )}
              </span>
              {typeof punch.accuracy === "number" && (
                <span>±{Math.round(punch.accuracy)}m</span>
              )}
              <span>
                {punch.siteName ? `· ${punch.siteName}` : "· No site"}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
