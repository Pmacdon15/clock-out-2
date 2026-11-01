"use client";

import { format } from "date-fns";
import { AlertTriangle, CalendarClock } from "lucide-react";
import { use } from "react";
import { pickNextShift } from "@/lib/schedule-utils";
import type { ScheduledShiftWithStatus, SerializableResult } from "@/lib/types";

interface NextShiftCardProps {
  schedulePromise: Promise<
    SerializableResult<ScheduledShiftWithStatus[], { reason: string }>
  >;
  userIdPromise: Promise<string | null | undefined>;
}

const STYLES = {
  late: "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100",
  on_shift:
    "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
  next: "border-zinc-200 bg-zinc-50 text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100",
} as const;

const TITLES = {
  late: "You're late for your shift",
  on_shift: "On shift",
  next: "Next shift",
} as const;

/**
 * Shows the member's next scheduled shift on the time clock, so they don't
 * have to open the Schedule tab to find out when they work. Renders nothing
 * when they have no shift coming up (or the schedule failed to load).
 */
export default function NextShiftCard({
  schedulePromise,
  userIdPromise,
}: NextShiftCardProps) {
  const result = use(schedulePromise);
  const userId = use(userIdPromise);
  const next = result.ok ? pickNextShift(result.value, userId) : null;
  if (!next) return null;

  const { kind, shift } = next;
  const start = new Date(shift.shift_start);
  const end = new Date(shift.shift_end);
  const Icon = kind === "late" ? AlertTriangle : CalendarClock;

  return (
    <section
      aria-label={TITLES[kind]}
      className={`mb-6 flex items-start gap-3 rounded-xl border p-4 ${STYLES[kind]}`}
    >
      <Icon className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="min-w-0">
        <p className="font-bold">{TITLES[kind]}</p>
        <p className="text-sm" suppressHydrationWarning>
          {kind === "on_shift"
            ? `Until ${format(end, "h:mm a")}`
            : `${format(start, "EEE, MMM d")} · ${format(start, "h:mm a")} – ${format(end, "h:mm a")}`}
        </p>
        {kind === "late" && (
          <p className="text-sm" suppressHydrationWarning>
            It started at {format(start, "h:mm a")}. Clock in below.
          </p>
        )}
        {shift.note && (
          <p className="text-sm italic opacity-80">{shift.note}</p>
        )}
      </div>
    </section>
  );
}
