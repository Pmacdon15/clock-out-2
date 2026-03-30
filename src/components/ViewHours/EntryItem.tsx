"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Calendar, Check, Edit3, Loader2, X } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { updateTimeEntryAction } from "@/lib/actions";
import { toast } from "sonner";
import type { TimeEntry } from "@/lib/dal";
import { DeleteConfirmDialog } from "../DeleteConfirmDialog";

interface EntryItemProps {
  entry: TimeEntry;
}

export function EntryItem({ entry }: EntryItemProps) {
 
  const [editClockIn, setEditClockIn] = useState(
    format(new Date(entry.clock_in), "yyyy-MM-dd'T'HH:mm")
  );
  const [editClockOut, setEditClockOut] = useState(
    entry.clock_out
      ? format(new Date(entry.clock_out), "yyyy-MM-dd'T'HH:mm")
      : ""
  );

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      clock_in,
      clock_out,
    }: {
      id: number;
      clock_in: string;
      clock_out: string;
    }) => updateTimeEntryAction(id, clock_in, clock_out),
    onSuccess: (res) => {
      if (res.success) {
        toast.success("Entry updated");
       
      } else if ("error" in res) {
        toast.error(res.error || "Failed to update");
      }
    },
  });

  if (updateMutation.isPending) {
    return (
      <div className="space-y-3 p-3 bg-zinc-50 dark:bg-zinc-900/50 rounded-xl border border-zinc-200 dark:border-zinc-800">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label
              htmlFor={`edit-in-${entry.id}`}
              className="text-[10px] uppercase font-bold text-zinc-400"
            >
              Clock In
            </label>
            <input
              id={`edit-in-${entry.id}`}
              type="datetime-local"
              value={editClockIn}
              onChange={(e) => setEditClockIn(e.target.value)}
              className="w-full text-xs p-2 rounded-lg border bg-white dark:bg-zinc-950 outline-none focus:ring-1 focus:ring-zinc-400"
            />
          </div>
          <div className="space-y-1">
            <label
              htmlFor={`edit-out-${entry.id}`}
              className="text-[10px] uppercase font-bold text-zinc-400"
            >
              Clock Out
            </label>
            <input
              id={`edit-out-${entry.id}`}
              type="datetime-local"
              value={editClockOut}
              onChange={(e) => setEditClockOut(e.target.value)}
              className="w-full text-xs p-2 rounded-lg border bg-white dark:bg-zinc-950 outline-none focus:ring-1 focus:ring-zinc-400"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"            
            className="p-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-lg text-zinc-500 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() =>
              updateMutation.mutate({
                id: entry.id,
                clock_in: editClockIn,
                clock_out: editClockOut,
              })
            }
            disabled={updateMutation.isPending}
            className="p-1.5 bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 rounded-lg hover:scale-105 transition-transform disabled:opacity-50"
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

  return (
    <div className="group flex flex-col gap-2 pb-5 border-b last:border-0 border-zinc-100 dark:border-zinc-800 transition-all">
      <div className="flex justify-between items-center text-sm font-bold">
        <span>{format(new Date(entry.clock_in), "eeee, MMM d")}</span>
        <div className="flex items-center gap-3">
          <span className="tabular-nums">
            {entry.clock_out
              ? (
                  (new Date(entry.clock_out).getTime() -
                    new Date(entry.clock_in).getTime()) /
                  (1000 * 60 * 60)
                ).toFixed(2)
              : "0.00"}
            h
          </span>
          <div className="flex items-center gap-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity">
            <button
              type="button"              
              className="p-1 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
            >
              <Edit3 className="h-3.5 w-3.5" />
            </button>
            <DeleteConfirmDialog entryId={entry.id} />
          </div>
        </div>
      </div>
      <div className="text-xs text-muted-foreground flex items-center gap-1.5 font-medium">
        <Calendar className="h-3 w-3" />
        {format(new Date(entry.clock_in), "hh:mm a")} -{" "}
        {entry.clock_out
          ? format(new Date(entry.clock_out), "hh:mm a")
          : "..."}
      </div>
    </div>
  );
}
