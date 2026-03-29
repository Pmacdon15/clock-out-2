'use client';

import { useMutation } from '@tanstack/react-query';
import { clockInAction, clockOutAction, deleteTimeEntryAction } from '@/lib/actions';
import { TimeEntry } from '@/lib/dal';
import { Button, Card } from './ui';
import { Play, Square, Loader2, Clock, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useState, useEffect } from 'react';
import { formatDistanceToNow } from 'date-fns';

interface ManageHoursProps {
    initialEntries: TimeEntry[];
}

export default function ManageHours({ initialEntries = [] }: ManageHoursProps) {
    
    const activeEntry = initialEntries?.find?.(e => !e.clock_out);
    const [elapsedTime, setElapsedTime] = useState<string>('');

    useEffect(() => {
        if (!activeEntry) return;

        const interval = setInterval(() => {
            setElapsedTime(formatDistanceToNow(new Date(activeEntry.clock_in), { addSuffix: false }));
        }, 1000);

        setElapsedTime(formatDistanceToNow(new Date(activeEntry.clock_in), { addSuffix: false }));

        return () => clearInterval(interval);
    }, [activeEntry]);

    const clockInMutation = useMutation({
        mutationFn: clockInAction,
       
    });

    const clockOutMutation = useMutation({
        mutationFn: clockOutAction,
        });

    const deleteMutation = useMutation({
        mutationFn: deleteTimeEntryAction,
        onSuccess: (res) => {
            if (res.success) toast.success('Entry deleted');
            else if ('error' in res) toast.error(res.error || 'Failed to delete');
        }
    });

    return (
        <Card className="p-8 sm:p-12 mb-8 flex flex-col items-center justify-center text-center">
            {activeEntry ? (
                <>
                    <div className="flex items-center gap-2 px-3 py-1 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-500 rounded-full text-sm font-medium mb-6">
                        <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                        </span>
                        Active Session
                    </div>
                    <div className="text-6xl font-black tracking-tighter mb-2 font-mono">
                        {elapsedTime || "0m"}
                    </div>
                    <p className="text-muted-foreground mb-8 flex items-center gap-2">
                        <Clock className="h-4 w-4" />
                        Started at {new Date(activeEntry.clock_in).toLocaleTimeString()}
                    </p>
                    <Button 
                        onClick={() => clockOutMutation.mutate()} 
                        disabled={clockOutMutation.isPending}
                        variant="destructive"
                        className="w-full max-w-sm h-16 text-lg font-bold gap-3 rounded-2xl"
                    >
                        {clockOutMutation.isPending ? <Loader2 className="animate-spin" /> : <Square className="fill-current" />}
                        Clock Out
                    </Button>
                </>
            ) : (
                <>
                    <div className="flex items-center gap-2 px-3 py-1 bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 rounded-full text-sm font-medium mb-6 border">
                        Offline
                    </div>
                    <div className="text-4xl font-black tracking-tight mb-8">
                        Ready to start your shift?
                    </div>
                    <Button 
                        onClick={() => clockInMutation.mutate()} 
                        disabled={clockInMutation.isPending}
                        className="w-full max-w-sm h-16 text-lg font-bold gap-3 rounded-2xl"
                    >
                        {clockInMutation.isPending ? <Loader2 className="animate-spin" /> : <Play className="fill-current" />}
                        Clock In
                    </Button>
                </>
            )}

            <div className="mt-12 w-full text-left">
                <h3 className="text-lg font-bold mb-4">Recent Activity</h3>
                <div className="space-y-3">
                    {initialEntries.slice(0, 5).map(entry => (
                        <div key={entry.id} className="flex justify-between items-center p-4 border rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors">
                            <div className="flex flex-col">
                                <span className="font-semibold">{new Date(entry.clock_in).toLocaleDateString()}</span>
                                <span className="text-xs text-muted-foreground">
                                    {new Date(entry.clock_in).toLocaleTimeString()} - {entry.clock_out ? new Date(entry.clock_out).toLocaleTimeString() : 'Current'}
                                </span>
                            </div>
                            <div className="flex items-center gap-3">
                                <div className="text-sm font-mono font-bold bg-zinc-100 dark:bg-zinc-800 px-3 py-1 rounded-md">
                                    {entry.clock_out 
                                        ? formatDistanceToNow(new Date(entry.clock_in), { addSuffix: false }) // Simplified Duration
                                        : 'Active'}
                                </div>
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (confirm('Delete this entry?')) {
                                            deleteMutation.mutate(entry.id);
                                        }
                                    }}
                                    className="p-2 text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                >
                                    <Trash2 className="h-4 w-4" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </Card>
    );
}
