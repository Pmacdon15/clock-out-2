"use client";

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
} from "../ui/alert-dialog";
import { Trash2 } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { deleteTimeEntryAction } from "@/lib/actions";
import { toast } from "sonner";

interface DeleteConfirmDialogProps {
  entryId: number;
  trigger?: React.ReactNode;
}

export function DeleteConfirmDialog({ entryId, trigger }: DeleteConfirmDialogProps) {
  const deleteMutation = useMutation({
    mutationFn: deleteTimeEntryAction,
    onSuccess: (res) => {
      if (res.success) {
        toast.success("Entry deleted");
      } else if ("error" in res) {
        toast.error(res.error || "Failed to delete");
      }
    },
  });

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        {trigger || (
          <button
            type="button"
            className="p-1 hover:text-red-500 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone. This will permanently delete this shift entry
            from your records.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={deleteMutation.isPending}
            onClick={() => deleteMutation.mutate(entryId)}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
