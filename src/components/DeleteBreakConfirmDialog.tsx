"use client";

import { useMutation } from "@tanstack/react-query";
import { X } from "lucide-react";
import { startTransition, useState } from "react";
import { toast } from "sonner";
import { deleteBreakAction } from "@/lib/actions";
import { breakTypeLabel } from "@/lib/break-utils";
import type { EntryAction } from "@/lib/reducers/time-entries";
import type { TimeEntryBreak } from "@/lib/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./ui/alert-dialog";

interface DeleteBreakConfirmDialogProps {
  /** The shift the break belongs to. */
  entryId: number;
  /** The break to delete. */
  breakItem: TimeEntryBreak;
  /** All recorded breaks on the shift, used for the optimistic update. */
  breaks: TimeEntryBreak[];
  setOptimisticEntries?: (action: EntryAction) => void;
  trigger?: React.ReactNode;
}

export function DeleteBreakConfirmDialog({
  entryId,
  breakItem,
  breaks,
  setOptimisticEntries,
  trigger,
}: DeleteBreakConfirmDialogProps) {
  const [open, setOpen] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: (breakId: number) => deleteBreakAction(breakId),
    onSuccess: (res) => {
      if (res.success) {
        toast.success("Break removed");
        setOpen(false);
      } else if ("error" in res) {
        toast.error(res.error || "Failed to remove break");
      }
    },
  });

  const handleDelete = () => {
    if (setOptimisticEntries) {
      startTransition(() => {
        setOptimisticEntries({
          type: "UPDATE",
          payload: {
            id: entryId,
            breaks: breaks.filter((brk) => brk.id !== breakItem.id),
            updated_at: new Date(),
          },
        });
        deleteMutation.mutate(breakItem.id);
      });
    } else {
      deleteMutation.mutate(breakItem.id);
    }
  };

  return (
    <AlertDialog onOpenChange={setOpen} open={open}>
      <AlertDialogTrigger asChild>
        {trigger || (
          <button
            aria-label="Remove break"
            className="p-1 transition-colors hover:text-red-500"
            disabled={deleteMutation.isPending}
            type="button"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this break?</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone. This will permanently delete this{" "}
            {breakTypeLabel(breakItem.break_type).toLowerCase()} from the shift,
            and the shift&apos;s hours will be recalculated.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleteMutation.isPending}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            className="bg-red-600 text-white hover:bg-red-700"
            disabled={deleteMutation.isPending}
            onClick={handleDelete}
          >
            {deleteMutation.isPending ? "Deleting..." : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
