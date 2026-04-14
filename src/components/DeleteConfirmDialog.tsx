'use client'

import { useMutation } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { startTransition, useState } from 'react'
import { toast } from 'sonner'
import { deleteTimeEntryAction } from '@/lib/actions'
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
} from './ui/alert-dialog'

interface DeleteConfirmDialogProps {
	entryId: number
	setOptimisticEntries?: (action: {
		type: 'ADD' | 'REMOVE'
		payload: any
	}) => void
	trigger?: React.ReactNode
}

export function DeleteConfirmDialog({
	entryId,
	setOptimisticEntries,
	trigger,
}: DeleteConfirmDialogProps) {
	const [open, setOpen] = useState(false)

	const deleteMutation = useMutation({
		mutationFn: deleteTimeEntryAction,
		onSuccess: (res) => {
			if (res.success) {
				toast.success('Entry deleted')
				setOpen(false) // Only close on success
			} else if ('error' in res) {
				toast.error(res.error || 'Failed to delete')
			}
		},
	})

	const handleDelete = async () => {
		if (setOptimisticEntries) {
			startTransition(() => {
				setOptimisticEntries({
					type: 'REMOVE',
					payload: entryId,
				})
				deleteMutation.mutate(entryId)
			})
		} else {
			deleteMutation.mutate(entryId)
		}
	}

	return (
		<AlertDialog onOpenChange={setOpen} open={open}>
			<AlertDialogTrigger asChild>
				{trigger || (
					<button
						className="p-1 transition-colors hover:text-red-500"
						type="button"
					>
						<Trash2 className="h-3.5 w-3.5" />
					</button>
				)}
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						Are you absolutely sure?
					</AlertDialogTitle>
					<AlertDialogDescription>
						This action cannot be undone. This will permanently
						delete this shift entry from your records.
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
						{deleteMutation.isPending ? 'Deleting...' : 'Delete'}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
