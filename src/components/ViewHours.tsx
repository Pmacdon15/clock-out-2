'use client';

import { TimeEntry } from '@/lib/dal';
import { Card } from './ui';
import { useState, useMemo } from 'react';
import { 
    BarChart, 
    Bar, 
    XAxis, 
    YAxis, 
    Tooltip, 
    ResponsiveContainer, 
    CartesianGrid, 
    Cell 
} from 'recharts';
import { format, startOfWeek, endOfWeek, isWithinInterval, startOfYear, endOfYear, startOfDay, endOfDay } from 'date-fns';
import { Calendar, TrendingUp, Trash2, Edit3, Check, X, Loader2 } from 'lucide-react';
import { deleteTimeEntryAction, updateTimeEntryAction } from '@/lib/actions';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

interface ViewHoursProps {
    entries: TimeEntry[];
}

export default function ViewHours({ entries }: ViewHoursProps) {
    const defaultTimeframe = useMemo(() => {
        const start = startOfWeek(new Date(), { weekStartsOn: 1 });
        const end = endOfWeek(new Date(), { weekStartsOn: 1 });
        const hasEntriesInWeek = entries.some(e => 
            e.clock_out && isWithinInterval(new Date(e.clock_in), { start, end })
        );
        return hasEntriesInWeek ? 'week' : 'all';
    }, [entries]);

    const [timeframe, setTimeframe] = useState<'year' | 'week' | 'all' | 'custom'>(defaultTimeframe);
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    
    // Editing state
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editClockIn, setEditClockIn] = useState('');
    const [editClockOut, setEditClockOut] = useState('');

    const deleteMutation = useMutation({
        mutationFn: deleteTimeEntryAction,
        onSuccess: (res) => {
            if (res.success) {
                toast.success('Entry deleted');
            } else if ('error' in res) {
                toast.error(res.error || 'Failed to delete');
            }
        }
    });

    const updateMutation = useMutation({
        mutationFn: ({ id, clock_in, clock_out }: { id: number, clock_in: string, clock_out: string }) => 
            updateTimeEntryAction(id, clock_in, clock_out),
        onSuccess: (res) => {
            if (res.success) {
                toast.success('Entry updated');
                setEditingId(null);
            } else if ('error' in res) {
                toast.error(res.error || 'Failed to update');
            }
        }
    });

    const filteredEntries = useMemo(() => {
        let result = entries.filter(e => e.clock_out); // Only finished entries

        if (timeframe === 'week') {
            const start = startOfWeek(new Date(), { weekStartsOn: 1 });
            const end = endOfWeek(new Date(), { weekStartsOn: 1 });
            result = result.filter(e => {
                try {
                    return isWithinInterval(new Date(e.clock_in), { start, end });
                } catch {
                    return false;
                }
            });
        } else if (timeframe === 'year') {
            const start = startOfYear(new Date());
            const end = endOfYear(new Date());
            result = result.filter(e => {
                try {
                    return isWithinInterval(new Date(e.clock_in), { start, end });
                } catch {
                    return false;
                }
            });
        } else if (timeframe === 'custom' && startDate && endDate) {
            const start = startOfDay(new Date(startDate));
            const end = endOfDay(new Date(endDate));
            result = result.filter(e => {
                try {
                    const d = new Date(e.clock_in);
                    return isWithinInterval(d, { start, end });
                } catch {
                    return false;
                }
            });
        }

        return result;
    }, [entries, timeframe, startDate, endDate]);

    const chartData = useMemo(() => {
        // Group entries by date and calculate total hours
        const dataMap: Record<string, number> = {};
        
        filteredEntries.forEach(e => {
            const dateStr = format(new Date(e.clock_in), 'MMM dd');
            const durationMs = e.clock_out ? new Date(e.clock_out).getTime() - new Date(e.clock_in).getTime() : 0;
            const hours = durationMs / (1000 * 60 * 60);
            dataMap[dateStr] = (dataMap[dateStr] || 0) + hours;
        });

        return Object.entries(dataMap).map(([name, value]) => ({
            name,
            hours: parseFloat(value.toFixed(2))
        }));
    }, [filteredEntries]);

    const totalHours = chartData.reduce((acc, curr) => acc + curr.hours, 0);

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div className="flex bg-zinc-100 dark:bg-zinc-900 p-1 rounded-lg overflow-x-auto max-w-full">
                    {(['week', 'year', 'custom', 'all'] as const).map((t) => (
                        <button
                            key={t}
                            type="button"
                            onClick={() => setTimeframe(t)}
                            className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-all whitespace-nowrap ${
                                timeframe === t 
                                    ? "bg-white text-zinc-950 shadow-sm dark:bg-zinc-800 dark:text-zinc-50" 
                                    : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
                            }`}
                        >
                            {t.toUpperCase()}
                        </button>
                    ))}
                </div>

                {timeframe === 'custom' && (
                    <div className="flex items-center gap-2 w-full sm:w-auto">
                        <input 
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            className="px-3 py-1.5 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs outline-none focus:ring-1 focus:ring-zinc-400"
                        />
                        <span className="text-zinc-400">to</span>
                        <input 
                            type="date"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            className="px-3 py-1.5 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs outline-none focus:ring-1 focus:ring-zinc-400"
                        />
                    </div>
                )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card className="p-6 md:col-span-2">
                    <div className="flex flex-col gap-1 mb-8">
                        <h3 className="text-sm font-medium text-zinc-500">Summary hours for {timeframe}</h3>
                        <div className="flex items-end gap-2">
                             <span className="text-3xl font-black">{totalHours.toFixed(1)}h</span>
                             <span className="text-green-500 text-xs font-bold mb-1 flex items-center gap-0.5">
                                <TrendingUp className="h-3 w-3" />
                                12% vs last month
                             </span>
                        </div>
                    </div>
                    
                    <div className="h-[300px] w-full mt-4">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                                <XAxis 
                                    dataKey="name" 
                                    axisLine={false} 
                                    tickLine={false} 
                                    tick={{ fill: '#71717a', fontSize: 12 }}
                                    dy={10}
                                />
                                <YAxis 
                                    axisLine={false} 
                                    tickLine={false} 
                                    tick={{ fill: '#71717a', fontSize: 12 }}
                                />
                                <Tooltip 
                                    cursor={{ fill: 'rgba(0,0,0,0.05)' }} 
                                    contentStyle={{ 
                                        borderRadius: '12px', 
                                        border: 'none', 
                                        boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
                                        backgroundColor: '#18181b',
                                        color: '#fff'
                                    }}
                                    itemStyle={{ color: '#fff' }}
                                />
                                <Bar 
                                    dataKey="hours" 
                                    fill="#18181b" 
                                    radius={[4, 4, 0, 0]}
                                    barSize={32}
                                >
                                    {chartData.map((d) => (
                                        <Cell key={d.name} className="fill-zinc-900 dark:fill-zinc-50" />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </Card>

                <Card className="p-6 flex flex-col justify-between overflow-hidden relative">
                    <div className="space-y-4">
                        <h3 className="text-lg font-bold mb-6">Details</h3>
                        <div className="space-y-6 max-h-[500px] overflow-auto pr-2 custom-scrollbar">
                            {filteredEntries.length === 0 ? (
                                <p className="text-sm text-zinc-500 italic">No entries for this period</p>
                            ) : (
                                filteredEntries.map(entry => (
                                    <div key={entry.id} className="group flex flex-col gap-2 pb-5 border-b last:border-0 border-zinc-100 dark:border-zinc-800 transition-all">
                                        {editingId === entry.id ? (
                                            <div className="space-y-3 p-3 bg-zinc-50 dark:bg-zinc-900/50 rounded-xl border border-zinc-200 dark:border-zinc-800">
                                                <div className="grid grid-cols-2 gap-3">
                                                    <div className="space-y-1">
                                                        <label htmlFor={`edit-in-${entry.id}`} className="text-[10px] uppercase font-bold text-zinc-400">Clock In</label>
                                                        <input 
                                                            id={`edit-in-${entry.id}`}
                                                            type="datetime-local" 
                                                            value={editClockIn} 
                                                            onChange={(e) => setEditClockIn(e.target.value)}
                                                            className="w-full text-xs p-2 rounded-lg border bg-white dark:bg-zinc-950" 
                                                        />
                                                    </div>
                                                    <div className="space-y-1">
                                                        <label htmlFor={`edit-out-${entry.id}`} className="text-[10px] uppercase font-bold text-zinc-400">Clock Out</label>
                                                        <input 
                                                            id={`edit-out-${entry.id}`}
                                                            type="datetime-local" 
                                                            value={editClockOut} 
                                                            onChange={(e) => setEditClockOut(e.target.value)}
                                                            className="w-full text-xs p-2 rounded-lg border bg-white dark:bg-zinc-950" 
                                                        />
                                                    </div>
                                                </div>
                                                <div className="flex justify-end gap-2">
                                                    <button 
                                                        type="button"
                                                        onClick={() => setEditingId(null)}
                                                        className="p-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-lg text-zinc-500"
                                                    >
                                                        <X className="h-4 w-4" />
                                                    </button>
                                                    <button 
                                                        type="button"
                                                        onClick={() => updateMutation.mutate({ id: entry.id, clock_in: editClockIn, clock_out: editClockOut })}
                                                        disabled={updateMutation.isPending}
                                                        className="p-1.5 bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 rounded-lg hover:scale-105 transition-transform disabled:opacity-50"
                                                    >
                                                        {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <>
                                                <div className="flex justify-between items-center text-sm font-bold">
                                                    <span>{format(new Date(entry.clock_in), 'eeee, MMM d')}</span>
                                                    <div className="flex items-center gap-3">
                                                        <span className="tabular-nums">
                                                            {entry.clock_out ? ((new Date(entry.clock_out).getTime() - new Date(entry.clock_in).getTime()) / (1000 * 60 * 60)).toFixed(2) : '0.00'}h
                                                        </span>
                                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                            <button 
                                                                onClick={() => {
                                                                    setEditingId(entry.id);
                                                                    setEditClockIn(format(new Date(entry.clock_in), "yyyy-MM-dd'T'HH:mm"));
                                                                    setEditClockOut(entry.clock_out ? format(new Date(entry.clock_out), "yyyy-MM-dd'T'HH:mm") : '');
                                                                }}
                                                                className="p-1 hover:text-zinc-900 dark:hover:text-zinc-100"
                                                            >
                                                                <Edit3 className="h-3.5 w-3.5" />
                                                            </button>
                                                            <button 
                                                                onClick={() => {
                                                                    if (confirm('Delete this entry?')) {
                                                                        deleteMutation.mutate(entry.id);
                                                                    }
                                                                }}
                                                                className="p-1 hover:text-red-500"
                                                            >
                                                                <Trash2 className="h-3.5 w-3.5" />
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="text-xs text-muted-foreground flex items-center gap-1.5 font-medium">
                                                    <Calendar className="h-3 w-3" />
                                                    {format(new Date(entry.clock_in), 'hh:mm a')} - {entry.clock_out ? format(new Date(entry.clock_out), 'hh:mm a') : '...'}
                                                </div>
                                            </>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </Card>
            </div>
        </div>
    );
}
