"use client";

import { useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { CalendarClock, Loader2, Trash2 } from "lucide-react";
import { use, useState } from "react";
import { toast } from "sonner";
import {
  createScheduledShiftAction,
  deleteScheduledShiftAction,
} from "@/lib/actions";
import {
  countShiftStatuses,
  isFlaggedStatus,
  LATE_GRACE_MINUTES,
  SHIFT_STATUS_LABELS,
} from "@/lib/schedule-utils";
import {
  approvedTimeOffOverlapping,
  formatTimeOffDates,
  TIME_OFF_TYPE_LABELS,
} from "@/lib/time-off-utils";
import type {
  ScheduledShiftWithStatus,
  SerializableResult,
  ShiftStatus,
  TimeOffRequest,
} from "@/lib/types";
import { Button, Card } from "./ui";

type Member = { id: string; name: string };

interface ScheduleProps {
  schedulePromise: Promise<
    SerializableResult<ScheduledShiftWithStatus[], { reason: string }>
  >;
  membersPromise?: Promise<Member[]>;
  timeOffPromise?: Promise<
    SerializableResult<TimeOffRequest[], { reason: string }>
  >;
  isAdmin: boolean;
}

const STATUS_STYLES: Record<ShiftStatus, string> = {
  scheduled: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  on_time:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  late: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  not_clocked_in:
    "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  no_show: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
};

const inputClass =
  "h-11 w-full rounded-xl border-2 border-zinc-200 bg-white px-3 dark:border-zinc-800 dark:bg-zinc-950";

/** Still to come or under way: shown before the shifts that are over. */
/** This browser's IANA zone, so the member's notice can word times locally. */
const browserTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

function isCurrentOrUpcoming(shift: ScheduledShiftWithStatus) {
  if (shift.status === "scheduled" || shift.status === "not_clocked_in") {
    return true;
  }
  return (
    (shift.status === "on_time" || shift.status === "late") &&
    shift.actual_clock_out === null
  );
}

/**
 * Builds the shift's start and end from the form's local date and times. An
 * end time at or before the start time means the shift runs past midnight.
 */
export function buildShiftTimes(date: string, start: string, end: string) {
  const shiftStart = new Date(`${date}T${start}`);
  const shiftEnd = new Date(`${date}T${end}`);
  if (shiftEnd.getTime() <= shiftStart.getTime()) {
    shiftEnd.setDate(shiftEnd.getDate() + 1);
  }
  return { shiftStart, shiftEnd };
}

/**
 * The local calendar days a shift covers, for checking it against time off.
 * A shift ending exactly at midnight doesn't touch the next day.
 */
export function shiftLocalDays(shiftStart: Date, shiftEnd: Date) {
  return {
    start: format(shiftStart, "yyyy-MM-dd"),
    end: format(new Date(shiftEnd.getTime() - 1), "yyyy-MM-dd"),
  };
}

/**
 * The member's approved time off that a shift on the form's local date and
 * times would land on, if any.
 */
export function findTimeOffConflict(
  timeOff: TimeOffRequest[],
  memberId: string,
  date: string,
  start: string,
  end: string,
): TimeOffRequest | undefined {
  const { shiftStart, shiftEnd } = buildShiftTimes(date, start, end);
  if (Number.isNaN(shiftStart.getTime())) return undefined;
  const days = shiftLocalDays(shiftStart, shiftEnd);
  return approvedTimeOffOverlapping(
    timeOff.filter((request) => request.user_id === memberId),
    days.start,
    days.end,
  )[0];
}

function ShiftRow({
  shift,
  memberName,
  isAdmin,
}: {
  shift: ScheduledShiftWithStatus;
  memberName?: string;
  isAdmin: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const { mutate, isPending } = useMutation({
    mutationFn: (id: number) =>
      deleteScheduledShiftAction(id, browserTimezone()),
    onSuccess: (res) => {
      if (res.success) {
        toast.success("Shift removed");
      } else {
        toast.error(res.error);
        setConfirming(false);
      }
    },
  });

  const start = new Date(shift.shift_start);
  const end = new Date(shift.shift_end);

  return (
    <li className="flex flex-col gap-1.5 border-zinc-100 border-b py-4 last:border-0 dark:border-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {memberName && <span className="font-bold">{memberName}</span>}
          <span className="font-medium text-sm" suppressHydrationWarning>
            {format(start, "EEE, MMM d")} · {format(start, "h:mm a")} –{" "}
            {format(end, "h:mm a")}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-0.5 font-semibold text-xs ${STATUS_STYLES[shift.status]}`}
          >
            {SHIFT_STATUS_LABELS[shift.status]}
          </span>
          {isAdmin &&
            (confirming ? (
              <span className="flex items-center gap-1 text-xs">
                <button
                  className="rounded px-2 py-1 font-semibold text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                  disabled={isPending}
                  onClick={() => mutate(shift.id)}
                  type="button"
                >
                  {isPending ? "Removing…" : "Remove"}
                </button>
                <button
                  className="rounded px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  disabled={isPending}
                  onClick={() => setConfirming(false)}
                  type="button"
                >
                  Keep
                </button>
              </span>
            ) : (
              <button
                aria-label="Remove shift"
                className="p-1 text-muted-foreground transition-colors hover:text-red-500"
                onClick={() => setConfirming(true)}
                type="button"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            ))}
        </div>
      </div>
      {shift.actual_clock_in && (
        <p className="text-muted-foreground text-xs" suppressHydrationWarning>
          Clocked in {format(new Date(shift.actual_clock_in), "h:mm a")}
          {shift.minutes_late ? ` (${shift.minutes_late} min late)` : ""}
          {shift.actual_clock_out
            ? ` · out ${format(new Date(shift.actual_clock_out), "h:mm a")}`
            : " · still on the clock"}
        </p>
      )}
      {shift.note && (
        <p className="text-muted-foreground text-xs italic">{shift.note}</p>
      )}
    </li>
  );
}

function ShiftForm({
  members,
  timeOff,
}: {
  members: Member[];
  timeOff: TimeOffRequest[];
}) {
  const [memberId, setMemberId] = useState("");
  const [date, setDate] = useState("");
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("17:00");
  const [note, setNote] = useState("");

  const { mutate, isPending } = useMutation({
    mutationFn: () => {
      const { shiftStart, shiftEnd } = buildShiftTimes(date, start, end);
      return createScheduledShiftAction(
        memberId,
        shiftStart.toISOString(),
        shiftEnd.toISOString(),
        note,
        browserTimezone(),
        shiftLocalDays(shiftStart, shiftEnd),
      );
    },
    onSuccess: (res) => {
      if (res.success) {
        toast.success("Shift published");
        setNote("");
      } else {
        toast.error(res.error);
      }
    },
  });

  const filled = Boolean(memberId && date && start && end);
  const conflict = filled
    ? findTimeOffConflict(timeOff, memberId, date, start, end)
    : undefined;
  const canSubmit = filled && !conflict && !isPending;

  return (
    <form
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        mutate();
      }}
    >
      <div className="space-y-1.5 sm:col-span-2 lg:col-span-4">
        <label className="font-medium text-sm" htmlFor="shiftMember">
          Member
        </label>
        <select
          className={inputClass}
          id="shiftMember"
          onChange={(e) => setMemberId(e.target.value)}
          value={memberId}
        >
          <option value="">Choose a member…</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <label className="font-medium text-sm" htmlFor="shiftDate">
          Date
        </label>
        <input
          className={inputClass}
          id="shiftDate"
          onChange={(e) => setDate(e.target.value)}
          type="date"
          value={date}
        />
      </div>
      <div className="space-y-1.5">
        <label className="font-medium text-sm" htmlFor="shiftStart">
          Start
        </label>
        <input
          className={inputClass}
          id="shiftStart"
          onChange={(e) => setStart(e.target.value)}
          type="time"
          value={start}
        />
      </div>
      <div className="space-y-1.5">
        <label className="font-medium text-sm" htmlFor="shiftEnd">
          End
        </label>
        <input
          className={inputClass}
          id="shiftEnd"
          onChange={(e) => setEnd(e.target.value)}
          type="time"
          value={end}
        />
      </div>
      <div className="space-y-1.5">
        <label className="font-medium text-sm" htmlFor="shiftNote">
          Note (optional)
        </label>
        <input
          className={inputClass}
          id="shiftNote"
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Front desk"
          value={note}
        />
      </div>
      <div className="sm:col-span-2 lg:col-span-4">
        {conflict && (
          <p
            className="mb-3 rounded-xl bg-amber-100 p-3 font-medium text-amber-800 text-sm dark:bg-amber-950 dark:text-amber-200"
            role="alert"
          >
            {new Map(members.map((m) => [m.id, m.name])).get(memberId)} has
            approved{" "}
            {TIME_OFF_TYPE_LABELS[conflict.request_type]
              .charAt(0)
              .toLowerCase()}
            {TIME_OFF_TYPE_LABELS[conflict.request_type].slice(1)} on{" "}
            {formatTimeOffDates(conflict)}. Pick another day — they can still
            clock in if they choose to work.
          </p>
        )}
        <Button
          className="w-full sm:w-auto"
          disabled={!canSubmit}
          type="submit"
        >
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Publish shift
        </Button>
        <p className="mt-2 text-muted-foreground text-xs">
          An end time earlier than the start runs past midnight. Members are
          flagged late when they clock in more than {LATE_GRACE_MINUTES} minutes
          after the start.
        </p>
      </div>
    </form>
  );
}

export default function Schedule({
  schedulePromise,
  membersPromise,
  timeOffPromise,
  isAdmin,
}: ScheduleProps) {
  const result = use(schedulePromise);
  const members = membersPromise ? use(membersPromise) : [];
  const timeOffResult = timeOffPromise ? use(timeOffPromise) : null;
  const timeOff = timeOffResult?.ok ? timeOffResult.value : [];
  const [flaggedOnly, setFlaggedOnly] = useState(false);

  if (!result.ok) {
    return (
      <Card className="p-8 text-center text-red-500">
        {"Error fetching schedule: "}
        {result.error.reason}
      </Card>
    );
  }

  const memberNames = new Map(members.map((m) => [m.id, m.name]));
  const counts = countShiftStatuses(result.value);
  const shifts = flaggedOnly
    ? result.value.filter((shift) => isFlaggedStatus(shift.status))
    : result.value;
  const upcoming = shifts.filter(isCurrentOrUpcoming);
  const past = shifts.filter((shift) => !isCurrentOrUpcoming(shift)).reverse();

  const renderList = (list: ScheduledShiftWithStatus[], empty: string) =>
    list.length === 0 ? (
      <p className="py-4 text-muted-foreground text-sm">{empty}</p>
    ) : (
      <ul>
        {list.map((shift) => (
          <ShiftRow
            isAdmin={isAdmin}
            key={shift.id}
            memberName={
              isAdmin
                ? (memberNames.get(shift.user_id) ?? "Unknown member")
                : undefined
            }
            shift={shift}
          />
        ))}
      </ul>
    );

  return (
    <div className="space-y-6 pb-20">
      <Card className="p-6 sm:p-8">
        <div className="mb-6 flex items-start gap-3">
          <div className="rounded-xl bg-zinc-900 p-2 text-white dark:bg-zinc-100 dark:text-black">
            <CalendarClock className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-bold text-2xl tracking-tight">
              {isAdmin ? "Schedule" : "My schedule"}
            </h3>
            <p className="text-muted-foreground text-sm">
              {isAdmin
                ? "Publish shifts and compare them with actual clock-ins over the last two weeks and the next four."
                : "Your shifts for the next four weeks, and how the last two went."}
            </p>
          </div>
        </div>

        {isAdmin && (
          <div className="mb-6 grid grid-cols-3 gap-3">
            {(["late", "not_clocked_in", "no_show"] as const).map((status) => (
              <div
                className={`rounded-xl p-3 text-center ${STATUS_STYLES[status]}`}
                key={status}
              >
                <div className="font-black text-2xl tabular-nums">
                  {counts[status]}
                </div>
                <div className="font-semibold text-xs">
                  {SHIFT_STATUS_LABELS[status]}
                </div>
              </div>
            ))}
          </div>
        )}

        {isAdmin && <ShiftForm members={members} timeOff={timeOff} />}
      </Card>

      <Card className="p-6 sm:p-8">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h4 className="font-bold text-lg">Upcoming &amp; in progress</h4>
          {isAdmin && (
            <label className="flex items-center gap-2 text-sm">
              <input
                checked={flaggedOnly}
                onChange={(e) => setFlaggedOnly(e.target.checked)}
                type="checkbox"
              />
              Flagged only
            </label>
          )}
        </div>
        {renderList(upcoming, "No upcoming shifts.")}
      </Card>

      <Card className="p-6 sm:p-8">
        <h4 className="mb-2 font-bold text-lg">Past two weeks</h4>
        {renderList(past, "No shifts in the past two weeks.")}
      </Card>
    </div>
  );
}
