"use client";

import { useMutation } from "@tanstack/react-query";
import { CalendarCheck, Loader2, Trash2 } from "lucide-react";
import { use, useState } from "react";
import { toast } from "sonner";
import {
  AVAILABILITY_KIND_LABELS,
  endMinuteFor,
  formatWindowTimes,
  MAX_AVAILABILITY_NOTE_LENGTH,
  parseTimeOfDay,
  sortWindows,
  WEEKDAY_NAMES,
} from "@/lib/availability";
import {
  addAvailabilityAction,
  deleteAvailabilityAction,
} from "@/lib/availability-actions";
import type { AvailabilityView } from "@/lib/availability-dal";
import type {
  AvailabilityKind,
  AvailabilityWindow,
  SerializableResult,
} from "@/lib/types";
import { Button, Card } from "./ui";

type Member = { id: string; name: string };

interface AvailabilityProps {
  viewPromise: Promise<
    SerializableResult<AvailabilityView, { reason: string }>
  >;
  /** Org members, for naming whose windows an admin is looking at. */
  membersPromise?: Promise<Member[]>;
}

const inputClass =
  "h-11 w-full rounded-xl border-2 border-zinc-200 bg-white px-3 dark:border-zinc-800 dark:bg-zinc-950";

const KIND_STYLES: Record<AvailabilityKind, string> = {
  available:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  unavailable: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
};

const browserTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

function WindowRow({
  window,
  canRemove,
}: {
  window: AvailabilityWindow;
  canRemove: boolean;
}) {
  const { mutate, isPending } = useMutation({
    mutationFn: () => deleteAvailabilityAction(window.id),
    onSuccess: (res) => {
      if (res.success) toast.success("Availability removed");
      else toast.error(res.error);
    },
  });
  const differentZone = window.timezone !== browserTimezone();
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span
          className={`rounded-full px-2.5 py-0.5 font-semibold text-xs ${KIND_STYLES[window.kind]}`}
        >
          {AVAILABILITY_KIND_LABELS[window.kind]}
        </span>
        <span className="font-medium">{WEEKDAY_NAMES[window.weekday]}</span>
        <span>{formatWindowTimes(window)}</span>
        {differentZone && (
          <span className="text-muted-foreground text-xs">
            ({window.timezone})
          </span>
        )}
        {window.note && (
          <span className="text-muted-foreground text-xs italic">
            {window.note}
          </span>
        )}
      </div>
      {canRemove && (
        <button
          aria-label={`Remove ${WEEKDAY_NAMES[window.weekday]} ${formatWindowTimes(window)}`}
          className="p-1 text-muted-foreground transition-colors hover:text-red-500"
          disabled={isPending}
          onClick={() => mutate()}
          type="button"
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
        </button>
      )}
    </li>
  );
}

export function AvailabilityForm() {
  const [kind, setKind] = useState<AvailabilityKind>("unavailable");
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [allDay, setAllDay] = useState(false);
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("17:00");
  const [note, setNote] = useState("");

  const startMinute = allDay ? 0 : parseTimeOfDay(start);
  const endMinute = allDay ? 1440 : endMinuteFor(end);
  const sameTime = startMinute !== null && startMinute === endMinute;

  const { mutate, isPending } = useMutation({
    mutationFn: () =>
      addAvailabilityAction({
        kind,
        weekdays,
        startMinute: startMinute as number,
        endMinute: endMinute as number,
        timezone: browserTimezone(),
        note,
      }),
    onSuccess: (res) => {
      if (res.success) {
        toast.success("Availability saved");
        setWeekdays([]);
        setNote("");
      } else {
        toast.error(res.error);
      }
    },
  });

  const canSubmit =
    weekdays.length > 0 &&
    startMinute !== null &&
    endMinute !== null &&
    !sameTime &&
    !isPending;

  const toggleDay = (day: number) =>
    setWeekdays((days) =>
      days.includes(day) ? days.filter((d) => d !== day) : [...days, day],
    );

  return (
    <form
      aria-label="Add availability"
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        mutate();
      }}
    >
      <fieldset className="flex flex-wrap gap-4 text-sm">
        <legend className="mb-1.5 font-medium text-sm">I'm…</legend>
        {(["available", "unavailable"] as const).map((value) => (
          <label className="flex items-center gap-2" key={value}>
            <input
              checked={kind === value}
              name="availabilityKind"
              onChange={() => setKind(value)}
              type="radio"
            />
            {AVAILABILITY_KIND_LABELS[value]}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend className="mb-1.5 font-medium text-sm">Every</legend>
        <div className="flex flex-wrap gap-2">
          {WEEKDAY_NAMES.map((name, day) => (
            <button
              aria-pressed={weekdays.includes(day)}
              className={`h-9 rounded-xl border-2 px-3 font-semibold text-sm transition-colors ${
                weekdays.includes(day)
                  ? "border-blue-600 bg-blue-50 text-blue-700 dark:border-zinc-100 dark:bg-zinc-800 dark:text-zinc-100"
                  : "border-zinc-200 text-muted-foreground hover:text-foreground dark:border-zinc-800"
              }`}
              key={name}
              onClick={() => toggleDay(day)}
              type="button"
            >
              <span aria-hidden="true">{name.slice(0, 3)}</span>
              <span className="sr-only">{name}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <label className="flex items-center gap-2 text-sm sm:col-span-3">
          <input
            checked={allDay}
            onChange={(e) => setAllDay(e.target.checked)}
            type="checkbox"
          />
          All day
        </label>
        {!allDay && (
          <>
            <div className="space-y-1.5">
              <label
                className="font-medium text-sm"
                htmlFor="availabilityStart"
              >
                From
              </label>
              <input
                className={inputClass}
                id="availabilityStart"
                onChange={(e) => setStart(e.target.value)}
                type="time"
                value={start}
              />
            </div>
            <div className="space-y-1.5">
              <label className="font-medium text-sm" htmlFor="availabilityEnd">
                Until
              </label>
              <input
                className={inputClass}
                id="availabilityEnd"
                onChange={(e) => setEnd(e.target.value)}
                type="time"
                value={end}
              />
            </div>
          </>
        )}
        <div className={`space-y-1.5 ${allDay ? "sm:col-span-3" : ""}`}>
          <label className="font-medium text-sm" htmlFor="availabilityNote">
            Note (optional)
          </label>
          <input
            className={inputClass}
            id="availabilityNote"
            maxLength={MAX_AVAILABILITY_NOTE_LENGTH}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Classes"
            value={note}
          />
        </div>
      </div>
      {sameTime && (
        <p className="text-red-600 text-sm" role="alert">
          Start and end can't be the same time.
        </p>
      )}
      <Button disabled={!canSubmit} type="submit">
        {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Save availability
      </Button>
      <p className="text-muted-foreground text-xs">
        Repeats every week. An end earlier than the start runs past midnight.
        Once you add times you're available, shifts outside them are flagged for
        your admin.
      </p>
    </form>
  );
}

export default function Availability({
  viewPromise,
  membersPromise,
}: AvailabilityProps) {
  const result = use(viewPromise);
  const members = membersPromise ? use(membersPromise) : [];

  if (!result.ok) {
    return (
      <Card className="p-8 text-center text-red-500">
        {"Error fetching availability: "}
        {result.error.reason}
      </Card>
    );
  }

  const { windows, userId, isAdmin } = result.value;
  const mine = sortWindows(windows.filter((w) => w.user_id === userId));
  const others = new Map<string, AvailabilityWindow[]>();
  for (const window of sortWindows(windows)) {
    if (window.user_id === userId) continue;
    others.set(window.user_id, [...(others.get(window.user_id) ?? []), window]);
  }
  const names = new Map(members.map((m) => [m.id, m.name]));

  return (
    <Card className="p-6 sm:p-8">
      <div className="mb-6 flex items-start gap-3">
        <div className="rounded-xl bg-blue-600 p-2 text-white dark:bg-zinc-100 dark:text-black">
          <CalendarCheck className="h-5 w-5" />
        </div>
        <div>
          <h3 className="font-bold text-2xl tracking-tight">Availability</h3>
          <p className="text-muted-foreground text-sm">
            {isAdmin
              ? "When your team can and can't work each week. You're warned when a shift clashes with it."
              : "Let your admin know when you can and can't work each week."}
          </p>
        </div>
      </div>

      <AvailabilityForm />

      <div className="mt-6">
        <h4 className="font-bold text-lg">Your availability</h4>
        {mine.length === 0 ? (
          <p className="py-2 text-muted-foreground text-sm">
            No availability set. You can be scheduled any time.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {mine.map((window) => (
              <WindowRow canRemove key={window.id} window={window} />
            ))}
          </ul>
        )}
      </div>

      {isAdmin && (
        <div className="mt-6">
          <h4 className="font-bold text-lg">Team availability</h4>
          {others.size === 0 ? (
            <p className="py-2 text-muted-foreground text-sm">
              No one else has set their availability yet.
            </p>
          ) : (
            [...others].map(([memberId, list]) => (
              <section
                aria-label={names.get(memberId) ?? "Unknown member"}
                className="mt-3"
                key={memberId}
              >
                <p className="font-semibold text-sm">
                  {names.get(memberId) ?? "Unknown member"}
                </p>
                <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {list.map((window) => (
                    <WindowRow canRemove key={window.id} window={window} />
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      )}
    </Card>
  );
}
