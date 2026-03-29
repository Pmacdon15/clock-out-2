"use client";

import { Card } from "../ui";
import { EntryItem } from "./EntryItem";
import type { TimeEntry } from "@/lib/dal";

interface EntryListProps {
  entries: TimeEntry[];
}

export function EntryList({ entries }: EntryListProps) {
  return (
    <Card className="p-6 flex flex-col justify-between overflow-hidden relative min-h-[400px]">
      <div className="space-y-4">
        <h3 className="text-lg font-bold mb-6">Details</h3>
        <div className="space-y-6 max-h-[500px] overflow-auto pr-2 custom-scrollbar">
          {entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-zinc-500 italic">
              <p className="text-sm">No entries for this period</p>
              <p className="text-[10px] uppercase font-bold text-zinc-400 mt-1">Try a different timeframe</p>
            </div>
          ) : (
            entries.map((entry) => (
              <EntryItem key={entry.id} entry={entry} />
            ))
          )}
        </div>
      </div>
    </Card>
  );
}
