"use client";

import { useMutation } from "@tanstack/react-query";
import { addWeeks, format } from "date-fns";
import {
  CalendarClock,
  Loader2,
  MapPin,
  Pencil,
  Repeat,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { use, useState } from "react";
import { toast } from "sonner";
import {
  createRepeatingShiftAction,
  createScheduledShiftAction,
  createWeeklyScheduledShiftsAction,
  deleteScheduledShiftAction,
  type RepeatingShiftResult,
  repeatShiftWeeklyAction,
  stopRepeatingShiftAction,
  updateScheduledShiftAction,
} from "@/lib/actions";
import {
  type AvailabilityConflict,
  availabilityConflictMessage,
  findAvailabilityConflict,
  windowsFor,
} from "@/lib/availability";
import {
  activeFilterCount,
  countShiftStatuses,
  DEFAULT_REPEAT_WEEKS,
  EMPTY_SHIFT_FILTERS,
  filterShifts,
  findOverlappingShift,
  LATE_GRACE_MINUTES,
  MAX_REPEAT_WEEKS,
  SHIFT_STATUS_LABELS,
  type ShiftFilters,
  TIME_OF_DAY_LABELS,
  type TimeOfDay,
  weeklyOccurrences,
} from "@/lib/schedule-utils";
import {
  MAX_SHIFT_LOCATION_LENGTH,
  type ShiftLocationInput,
  shiftLocationMapUrl,
} from "@/lib/shift-location";
import {
  approvedTimeOffOverlapping,
  formatTimeOffDates,
  TIME_OFF_TYPE_LABELS,
} from "@/lib/time-off-utils";
import type {
  AvailabilityWindow,
  ScheduledShiftWithStatus,
  SerializableResult,
  ShiftStatus,
  SiteData,
  TimeOffRequest,
} from "@/lib/types";
import { GoogleCalendarResume } from "./AddToGoogleCalendar";
import LocalTime from "./LocalTime";
import ScheduleCalendar from "./ScheduleCalendar";
import { Button, Card } from "./ui";

type Member = { id: string; name: string };
type Site = Pick<SiteData, "id" | "name" | "address">;

interface ScheduleProps {
  schedulePromise: Promise<
    SerializableResult<ScheduledShiftWithStatus[], { reason: string }>
  >;
  membersPromise?: Promise<Member[]>;
  timeOffPromise?: Promise<
    SerializableResult<TimeOffRequest[], { reason: string }>
  >;
  /** Path of the member's private calendar feed, for subscribing. */
  calendarFeedPromise?: Promise<string | null>;
  /** Whether the viewer allowed Google Calendar access (for disconnecting). */
  googleConnectedPromise?: Promise<boolean>;
  /** The org's saved work sites, offered as shift locations (admins). */
  sitesPromise?: Promise<SerializableResult<SiteData[], { reason: string }>>;
  /** Everyone's weekly availability, so admins are warned about clashes. */
  availabilityPromise?: Promise<AvailabilityWindow[]>;
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

/** What the weekly repeat action is sent for each week's copy of a shift. */
export function weeklyShiftOccurrences(
  shiftStart: Date,
  shiftEnd: Date,
  weeks: number,
  fromWeek = 0,
) {
  return weeklyOccurrences(shiftStart, shiftEnd, weeks, fromWeek).map(
    (week) => ({
      shiftStart: week.shiftStart.toISOString(),
      shiftEnd: week.shiftEnd.toISOString(),
      localDays: shiftLocalDays(week.shiftStart, week.shiftEnd),
    }),
  );
}

/** "Shifts published" plus the weeks skipped (time off, another shift). */
function toastWeeklyResult(
  created: number,
  skipped: { shiftStart: string; reason: string }[],
) {
  const published = `${created} weekly shift${created === 1 ? "" : "s"} published`;
  if (skipped.length === 0) {
    toast.success(published);
    return;
  }
  const days = skipped
    .map((week) => format(new Date(week.shiftStart), "MMM d"))
    .join(", ");
  toast.warning(`${published}. Skipped ${days}: ${skipped[0].reason}.`);
}

/** "Repeats every Monday": shifts made now, and that more keep coming. */
function toastRepeatingResult(
  weekday: string,
  res: Extract<RepeatingShiftResult, { success: true }>,
) {
  const last = res.data.at(-1);
  const more = last
    ? ` Scheduled through ${format(new Date(last.shift_start), "MMM d")}; new weeks are added automatically.`
    : " New weeks are added automatically.";
  const message = `Repeats every ${weekday}.${more}`;
  if (res.skipped.length === 0) {
    toast.success(message);
    return;
  }
  const days = res.skipped
    .map((week) => format(new Date(week.shiftStart), "MMM d"))
    .join(", ");
  toast.warning(`${message} Skipped ${days}: ${res.skipped[0].reason}.`);
}

/** Amber notice that a shift clashes with the member's availability. */
function AvailabilityWarning({
  name,
  conflict,
}: {
  name: string | undefined;
  conflict: AvailabilityConflict;
}) {
  return (
    <p
      className="mb-3 rounded-xl bg-amber-100 p-3 font-medium text-amber-800 text-sm dark:bg-amber-950 dark:text-amber-200"
      role="status"
    >
      {availabilityConflictMessage(name, conflict)} You can still publish it.
    </p>
  );
}

/** How a shift repeats: until stopped, or for a set number of weeks. */
type RepeatMode = "ongoing" | "weeks";

/** Radio choice between repeating until stopped and a set number of weeks. */
function RepeatModeField({
  id,
  weekday,
  mode,
  onModeChange,
  weeks,
  onWeeksChange,
  weeksLabel,
}: {
  id: string;
  weekday: string;
  mode: RepeatMode;
  onModeChange: (mode: RepeatMode) => void;
  weeks: number;
  onWeeksChange: (weeks: number) => void;
  /** What the week count makes, e.g. "4 shifts" or "4 more shifts". */
  weeksLabel: string;
}) {
  return (
    <fieldset className="space-y-2 text-sm">
      <legend className="sr-only">How it repeats</legend>
      <label className="flex items-center gap-2" htmlFor={`${id}Ongoing`}>
        <input
          checked={mode === "ongoing"}
          id={`${id}Ongoing`}
          name={`${id}Mode`}
          onChange={() => onModeChange("ongoing")}
          type="radio"
        />
        Every {weekday}, until I stop it
      </label>
      <span className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2" htmlFor={`${id}Count`}>
          <input
            checked={mode === "weeks"}
            id={`${id}Count`}
            name={`${id}Mode`}
            onChange={() => onModeChange("weeks")}
            type="radio"
          />
          For the next
        </label>
        <input
          aria-label="Number of weeks"
          className={`${inputClass} h-9 w-20`}
          disabled={mode !== "weeks"}
          id={`${id}Weeks`}
          max={MAX_REPEAT_WEEKS}
          min={1}
          onChange={(e) => onWeeksChange(clampWeeks(e.target.value))}
          type="number"
          value={weeks}
        />
        <span>weeks ({weeksLabel})</span>
      </span>
    </fieldset>
  );
}

/** Keeps a typed week count within what the repeat action accepts. */
const clampWeeks = (value: string) =>
  Math.max(1, Math.min(MAX_REPEAT_WEEKS, Math.floor(Number(value)) || 1));

/** The location picker's value for "a location typed in". */
const OTHER_LOCATION = "other";

/** What the location picker holds: "" (none), a site id, or OTHER_LOCATION. */
type LocationChoice = { choice: string; typed: string };

/** The picker's starting value for a shift that is already published. */
export function locationChoiceFor(
  shift: Pick<ScheduledShiftWithStatus, "site_id" | "location">,
  sites: Site[],
): LocationChoice {
  if (shift.site_id != null && sites.some((s) => s.id === shift.site_id)) {
    return { choice: String(shift.site_id), typed: "" };
  }
  if (shift.location) {
    return { choice: OTHER_LOCATION, typed: shift.location };
  }
  return { choice: "", typed: "" };
}

/** What to send the server for the picker's value. */
export function locationInputFor({
  choice,
  typed,
}: LocationChoice): ShiftLocationInput {
  if (choice === OTHER_LOCATION) return { location: typed };
  if (choice) return { siteId: Number(choice) };
  return {};
}

/**
 * Where the shift is: one of the org's saved sites (from Settings), or a
 * location typed in for a one-off. With no saved sites it's just a text box.
 */
function LocationField({
  id,
  sites,
  value,
  onChange,
  labelClassName,
}: {
  id: string;
  sites: Site[];
  value: LocationChoice;
  onChange: (value: LocationChoice) => void;
  labelClassName: string;
}) {
  const typing = sites.length === 0 || value.choice === OTHER_LOCATION;
  return (
    <div className="space-y-1">
      <label className={labelClassName} htmlFor={id}>
        Location (optional)
      </label>
      {sites.length > 0 && (
        <select
          className={inputClass}
          id={id}
          onChange={(e) => onChange({ ...value, choice: e.target.value })}
          value={value.choice}
        >
          <option value="">No location</option>
          {sites.map((site) => (
            <option key={site.id} value={site.id}>
              {site.name}
            </option>
          ))}
          <option value={OTHER_LOCATION}>Other location…</option>
        </select>
      )}
      {typing && (
        <input
          aria-label={sites.length > 0 ? "Other location" : undefined}
          className={inputClass}
          id={sites.length > 0 ? `${id}Other` : id}
          maxLength={MAX_SHIFT_LOCATION_LENGTH}
          onChange={(e) =>
            onChange({ choice: OTHER_LOCATION, typed: e.target.value })
          }
          placeholder="e.g. 12 King St W, or Client site"
          value={value.typed}
        />
      )}
    </div>
  );
}

/** Admin form to move a published shift or change its note. */
function EditShiftForm({
  shift,
  sites,
  onDone,
  availability = [],
  memberName,
}: {
  shift: ScheduledShiftWithStatus;
  sites: Site[];
  onDone: () => void;
  /** The shift's member's weekly availability. */
  availability?: AvailabilityWindow[];
  memberName?: string;
}) {
  const start = new Date(shift.shift_start);
  const end = new Date(shift.shift_end);
  const [date, setDate] = useState(format(start, "yyyy-MM-dd"));
  const [startTime, setStartTime] = useState(format(start, "HH:mm"));
  const [endTime, setEndTime] = useState(format(end, "HH:mm"));
  const [note, setNote] = useState(shift.note ?? "");
  const [location, setLocation] = useState(() =>
    locationChoiceFor(shift, sites),
  );

  const { mutate, isPending } = useMutation({
    mutationFn: () => {
      const { shiftStart, shiftEnd } = buildShiftTimes(
        date,
        startTime,
        endTime,
      );
      return updateScheduledShiftAction(
        shift.id,
        shiftStart.toISOString(),
        shiftEnd.toISOString(),
        note,
        browserTimezone(),
        shiftLocalDays(shiftStart, shiftEnd),
        locationInputFor(location),
      );
    },
    onSuccess: (res) => {
      if (res.success) {
        toast.success("Shift updated");
        onDone();
      } else {
        toast.error(res.error);
      }
    },
  });

  const id = `editShift${shift.id}`;
  const times =
    date && startTime && endTime
      ? buildShiftTimes(date, startTime, endTime)
      : undefined;
  const clash =
    times && !Number.isNaN(times.shiftStart.getTime())
      ? findAvailabilityConflict(availability, times.shiftStart, times.shiftEnd)
      : null;
  return (
    <form
      className="grid grid-cols-1 gap-3 pt-2 sm:grid-cols-2 lg:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        mutate();
      }}
    >
      <div className="space-y-1">
        <label className="font-medium text-xs" htmlFor={`${id}Date`}>
          Date
        </label>
        <input
          className={inputClass}
          id={`${id}Date`}
          onChange={(e) => setDate(e.target.value)}
          type="date"
          value={date}
        />
      </div>
      <div className="space-y-1">
        <label className="font-medium text-xs" htmlFor={`${id}Start`}>
          Start
        </label>
        <input
          className={inputClass}
          id={`${id}Start`}
          onChange={(e) => setStartTime(e.target.value)}
          type="time"
          value={startTime}
        />
      </div>
      <div className="space-y-1">
        <label className="font-medium text-xs" htmlFor={`${id}End`}>
          End
        </label>
        <input
          className={inputClass}
          id={`${id}End`}
          onChange={(e) => setEndTime(e.target.value)}
          type="time"
          value={endTime}
        />
      </div>
      <div className="space-y-1">
        <label className="font-medium text-xs" htmlFor={`${id}Note`}>
          Note
        </label>
        <input
          className={inputClass}
          id={`${id}Note`}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
          value={note}
        />
      </div>
      <div className="sm:col-span-2 lg:col-span-4">
        <LocationField
          id={`${id}Location`}
          labelClassName="font-medium text-xs"
          onChange={setLocation}
          sites={sites}
          value={location}
        />
      </div>
      {clash && (
        <div className="sm:col-span-2 lg:col-span-4">
          <AvailabilityWarning conflict={clash} name={memberName} />
        </div>
      )}
      <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
        <Button
          disabled={!date || !startTime || !endTime || isPending}
          size="sm"
          type="submit"
        >
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save shift
        </Button>
        <Button
          disabled={isPending}
          onClick={onDone}
          size="sm"
          type="button"
          variant="ghost"
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * Admin form to make a published shift repeat weekly: until stopped, or for
 * a set number of weeks. On a shift that already repeats, it stops it.
 */
function RepeatShiftForm({
  shift,
  sites,
  onDone,
}: {
  shift: ScheduledShiftWithStatus;
  sites: Site[];
  onDone: () => void;
}) {
  const [mode, setMode] = useState<RepeatMode>("ongoing");
  const [weeks, setWeeks] = useState(DEFAULT_REPEAT_WEEKS);
  const start = new Date(shift.shift_start);
  const end = new Date(shift.shift_end);
  const weekday = format(start, "EEEE");
  // The last copy, `weeks` weeks on (local calendar, like the copies).
  const lastStart = addWeeks(start, weeks);

  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      if (mode === "ongoing") {
        const res = await repeatShiftWeeklyAction(shift.id, browserTimezone());
        if (res.success) toastRepeatingResult(weekday, res);
        return res;
      }
      const res = await createWeeklyScheduledShiftsAction(
        shift.user_id,
        weeklyShiftOccurrences(start, end, weeks, 1),
        shift.note,
        browserTimezone(),
        locationInputFor(locationChoiceFor(shift, sites)),
      );
      if (res.success) toastWeeklyResult(res.data.length, res.skipped);
      return res;
    },
    onSuccess: (res) => {
      if (res.success) onDone();
      else toast.error(res.error);
    },
  });

  const { mutate: stop, isPending: stopping } = useMutation({
    mutationFn: () => stopRepeatingShiftAction(shift.id),
    onSuccess: (res) => {
      if (res.success) {
        toast.success(
          res.removed > 0
            ? `Stopped repeating. Removed ${res.removed} later shift${res.removed === 1 ? "" : "s"}.`
            : "Stopped repeating",
        );
        onDone();
      } else {
        toast.error(res.error);
      }
    },
  });

  if (shift.series_id != null) {
    return (
      <div className="flex flex-wrap items-center gap-3 pt-2">
        <p className="w-full text-muted-foreground text-xs">
          This shift repeats every {weekday}. New weeks are added automatically,
          about five weeks ahead. Stopping removes the weeks after this one;
          this shift and earlier ones stay.
        </p>
        <Button
          disabled={stopping}
          onClick={() => stop()}
          size="sm"
          type="button"
          variant="outline"
        >
          {stopping && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Stop repeating after this shift
        </Button>
        <Button
          disabled={stopping}
          onClick={onDone}
          size="sm"
          type="button"
          variant="ghost"
        >
          Cancel
        </Button>
      </div>
    );
  }

  const id = `repeatShift${shift.id}`;
  return (
    <form
      className="flex flex-wrap items-end gap-3 pt-2"
      onSubmit={(e) => {
        e.preventDefault();
        mutate();
      }}
    >
      <RepeatModeField
        id={id}
        mode={mode}
        onModeChange={setMode}
        onWeeksChange={setWeeks}
        weekday={weekday}
        weeks={weeks}
        weeksLabel={`${weeks} more shift${weeks === 1 ? "" : "s"}`}
      />
      <div className="flex gap-2">
        <Button disabled={isPending} size="sm" type="submit">
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Repeat weekly
        </Button>
        <Button
          disabled={isPending}
          onClick={onDone}
          size="sm"
          type="button"
          variant="ghost"
        >
          Cancel
        </Button>
      </div>
      <p className="w-full text-muted-foreground text-xs">
        Same time and location
        {mode === "ongoing"
          ? ". New weeks are added automatically, about five weeks ahead."
          : `, through ${format(lastStart, "EEE, MMM d")}.`}{" "}
        Weeks with time off or another shift are skipped.
      </p>
    </form>
  );
}

function ShiftRow({
  shift,
  memberName,
  isAdmin,
  sites,
  availability = [],
}: {
  shift: ScheduledShiftWithStatus;
  memberName?: string;
  isAdmin: boolean;
  sites: Site[];
  /** The shift's member's weekly availability (admins). */
  availability?: AvailabilityWindow[];
}) {
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [repeating, setRepeating] = useState(false);
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
  const actualIn = shift.actual_clock_in;
  const actualOut = shift.actual_clock_out;
  const mapUrl = shiftLocationMapUrl(shift);
  const clash =
    isAdmin && isCurrentOrUpcoming(shift)
      ? findAvailabilityConflict(availability, start, end)
      : null;

  return (
    <li className="flex flex-col gap-1.5 border-zinc-100 border-b py-4 last:border-0 dark:border-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {memberName && <span className="font-bold">{memberName}</span>}
          <span className="font-medium text-sm">
            <LocalTime>
              {() =>
                `${format(start, "EEE, MMM d")} · ${format(start, "h:mm a")} – ${format(end, "h:mm a")}`
              }
            </LocalTime>
          </span>
        </div>
        <div className="flex items-center gap-2">
          {clash && (
            <span
              className="rounded-full bg-amber-100 px-2.5 py-0.5 font-semibold text-amber-700 text-xs dark:bg-amber-950 dark:text-amber-300"
              title={availabilityConflictMessage(memberName, clash)}
            >
              {clash.type === "unavailable"
                ? "Unavailable"
                : "Outside availability"}
            </span>
          )}
          {shift.series_id != null && (
            <span className="flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 font-semibold text-blue-700 text-xs dark:bg-blue-950 dark:text-blue-300">
              <Repeat aria-hidden="true" className="h-3 w-3" />
              Repeats weekly
            </span>
          )}
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
              <>
                <button
                  aria-label="Edit shift"
                  className="p-1 text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => {
                    setRepeating(false);
                    setEditing((open) => !open);
                  }}
                  type="button"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                {isCurrentOrUpcoming(shift) && (
                  <button
                    aria-expanded={repeating}
                    className="flex items-center gap-1 rounded px-1.5 py-1 font-medium text-muted-foreground text-xs transition-colors hover:text-foreground"
                    onClick={() => {
                      setEditing(false);
                      setRepeating((open) => !open);
                    }}
                    type="button"
                  >
                    <Repeat aria-hidden="true" className="h-3.5 w-3.5" />
                    {shift.series_id != null ? "Repeating…" : "Repeat…"}
                  </button>
                )}
                <button
                  aria-label="Remove shift"
                  className="p-1 text-muted-foreground transition-colors hover:text-red-500"
                  onClick={() => setConfirming(true)}
                  type="button"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </>
            ))}
        </div>
      </div>
      {actualIn && (
        <p className="text-muted-foreground text-xs">
          Clocked in{" "}
          <LocalTime>{() => format(new Date(actualIn), "h:mm a")}</LocalTime>
          {shift.minutes_late ? ` (${shift.minutes_late} min late)` : ""}
          {actualOut ? " · out " : " · still on the clock"}
          {actualOut && (
            <LocalTime>{() => format(new Date(actualOut), "h:mm a")}</LocalTime>
          )}
        </p>
      )}
      {shift.location && (
        <p className="flex items-start gap-1 text-muted-foreground text-xs">
          <MapPin aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>
            <a
              className="font-medium text-foreground underline-offset-2 hover:underline"
              href={mapUrl as string}
              rel="noopener noreferrer"
              target="_blank"
            >
              {shift.location}
            </a>
            {shift.location_address &&
              shift.location_address !== shift.location &&
              ` · ${shift.location_address}`}
          </span>
        </p>
      )}
      {shift.note && (
        <p className="text-muted-foreground text-xs italic">{shift.note}</p>
      )}
      {isAdmin && editing && (
        <EditShiftForm
          availability={availability}
          memberName={memberName}
          onDone={() => setEditing(false)}
          shift={shift}
          sites={sites}
        />
      )}
      {isAdmin && repeating && (
        <RepeatShiftForm
          onDone={() => setRepeating(false)}
          shift={shift}
          sites={sites}
        />
      )}
    </li>
  );
}

function ShiftForm({
  members,
  sites,
  timeOff,
  shifts,
  availability,
}: {
  members: Member[];
  sites: Site[];
  timeOff: TimeOffRequest[];
  /** Everyone's weekly availability, for warning (never blocking). */
  availability: AvailabilityWindow[];
  /** Shifts already published, so the same slot isn't booked twice. */
  shifts: ScheduledShiftWithStatus[];
}) {
  const [memberId, setMemberId] = useState("");
  const [date, setDate] = useState("");
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("17:00");
  const [note, setNote] = useState("");
  const [location, setLocation] = useState<LocationChoice>({
    choice: "",
    typed: "",
  });
  const [weekly, setWeekly] = useState(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>("ongoing");
  const [weeks, setWeeks] = useState(DEFAULT_REPEAT_WEEKS);

  const { mutate: publishRepeating, isPending: repeatingPending } = useMutation(
    {
      mutationFn: () => {
        const { shiftStart, shiftEnd } = buildShiftTimes(date, start, end);
        return createRepeatingShiftAction(
          memberId,
          shiftStart.toISOString(),
          shiftEnd.toISOString(),
          note,
          browserTimezone(),
          shiftLocalDays(shiftStart, shiftEnd),
          locationInputFor(location),
        );
      },
      onSuccess: (res) => {
        if (res.success) {
          // The first shift is always in a successful result.
          toastRepeatingResult(
            format(new Date(res.data[0].shift_start), "EEEE"),
            res,
          );
          setDate("");
          setNote("");
        } else {
          toast.error(res.error);
        }
      },
    },
  );

  const { mutate: publishWeekly, isPending: weeklyPending } = useMutation({
    mutationFn: () => {
      const { shiftStart, shiftEnd } = buildShiftTimes(date, start, end);
      return createWeeklyScheduledShiftsAction(
        memberId,
        weeklyShiftOccurrences(shiftStart, shiftEnd, weeks),
        note,
        browserTimezone(),
        locationInputFor(location),
      );
    },
    onSuccess: (res) => {
      if (res.success) {
        toastWeeklyResult(res.data.length, res.skipped);
        setDate("");
        setNote("");
      } else {
        toast.error(res.error);
      }
    },
  });

  const { mutate: publishOnce, isPending: oncePending } = useMutation({
    mutationFn: () => {
      const { shiftStart, shiftEnd } = buildShiftTimes(date, start, end);
      return createScheduledShiftAction(
        memberId,
        shiftStart.toISOString(),
        shiftEnd.toISOString(),
        note,
        browserTimezone(),
        shiftLocalDays(shiftStart, shiftEnd),
        locationInputFor(location),
      );
    },
    onSuccess: (res) => {
      if (res.success) {
        toast.success("Shift published");
        // Clear the date so the form doesn't flag the shift it just
        // published as an overlap with itself.
        setDate("");
        setNote("");
      } else {
        toast.error(res.error);
      }
    },
  });

  const isPending = oncePending || weeklyPending || repeatingPending;
  const filled = Boolean(memberId && date && start && end);
  const conflict = filled
    ? findTimeOffConflict(timeOff, memberId, date, start, end)
    : undefined;
  const times = filled ? buildShiftTimes(date, start, end) : undefined;
  const overlap = times
    ? findOverlappingShift(shifts, memberId, times.shiftStart, times.shiftEnd)
    : undefined;
  const clash = times
    ? findAvailabilityConflict(
        windowsFor(availability, memberId),
        times.shiftStart,
        times.shiftEnd,
      )
    : null;
  const canSubmit = filled && !conflict && !overlap && !isPending;
  const lastWeek =
    weekly && repeatMode === "weeks" && times
      ? weeklyOccurrences(times.shiftStart, times.shiftEnd, weeks).at(-1)
      : undefined;

  return (
    <form
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!weekly) publishOnce();
        else if (repeatMode === "ongoing") publishRepeating();
        else publishWeekly();
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
        <LocationField
          id="shiftLocation"
          labelClassName="font-medium text-sm"
          onChange={setLocation}
          sites={sites}
          value={location}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-4">
        <button
          aria-pressed={weekly}
          className={`flex h-11 items-center gap-2 rounded-xl border-2 px-4 font-semibold text-sm transition-colors ${
            weekly
              ? "border-blue-600 bg-blue-50 text-blue-700 dark:border-zinc-100 dark:bg-zinc-800 dark:text-zinc-100"
              : "border-zinc-200 text-muted-foreground hover:text-foreground dark:border-zinc-800"
          }`}
          onClick={() => setWeekly((on) => !on)}
          type="button"
        >
          <Repeat className="h-4 w-4" />
          Weekly
        </button>
        {weekly && (
          <RepeatModeField
            id="shiftRepeat"
            mode={repeatMode}
            onModeChange={setRepeatMode}
            onWeeksChange={setWeeks}
            weekday={times ? format(times.shiftStart, "EEEE") : "week"}
            weeks={weeks}
            weeksLabel={`${weeks} shift${weeks === 1 ? "" : "s"} in total`}
          />
        )}
        {weekly && repeatMode === "ongoing" && (
          <span className="text-muted-foreground text-xs">
            New weeks are added automatically, about five weeks ahead. Weeks
            with time off or another shift are skipped.
          </span>
        )}
        {lastWeek && (
          <span className="text-muted-foreground text-xs">
            Through {format(lastWeek.shiftStart, "EEE, MMM d")}. Weeks with time
            off or another shift are skipped.
          </span>
        )}
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
        {!conflict && overlap && (
          <p
            className="mb-3 rounded-xl bg-amber-100 p-3 font-medium text-amber-800 text-sm dark:bg-amber-950 dark:text-amber-200"
            role="alert"
          >
            {new Map(members.map((m) => [m.id, m.name])).get(memberId)} is
            already scheduled{" "}
            {format(new Date(overlap.shift_start), "EEE, MMM d, h:mm a")} –{" "}
            {format(new Date(overlap.shift_end), "h:mm a")}. Edit that shift or
            pick a time that doesn't overlap it.
          </p>
        )}
        {!conflict && !overlap && clash && (
          <AvailabilityWarning
            conflict={clash}
            name={new Map(members.map((m) => [m.id, m.name])).get(memberId)}
          />
        )}
        <Button
          className="w-full sm:w-auto"
          disabled={!canSubmit}
          type="submit"
        >
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {!weekly
            ? "Publish shift"
            : repeatMode === "ongoing"
              ? "Publish repeating shift"
              : `Publish ${weeks} weekly shift${weeks === 1 ? "" : "s"}`}
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

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/**
 * Admin filter bar for a busy schedule: search by name, note or location, and
 * narrow by member, day, weekday, time of day or status.
 */
function ShiftFilterBar({
  filters,
  onChange,
  members,
  shown,
  total,
}: {
  filters: ShiftFilters;
  onChange: (filters: ShiftFilters) => void;
  members: Member[];
  shown: number;
  total: number;
}) {
  const set = <K extends keyof ShiftFilters>(key: K, value: ShiftFilters[K]) =>
    onChange({ ...filters, [key]: value });
  const active = activeFilterCount(filters);
  const labelClass = "block font-medium text-xs";
  const selectClass = `${inputClass} h-10`;

  return (
    <search
      aria-label="Filter shifts"
      className="space-y-3 rounded-2xl border-2 border-zinc-100 p-4 dark:border-zinc-800"
    >
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          aria-label="Search shifts"
          className={`${inputClass} pl-9`}
          onChange={(e) => set("query", e.target.value)}
          placeholder="Search by name, note or location"
          type="search"
          value={filters.query}
        />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <div className="space-y-1">
          <span aria-hidden="true" className={labelClass}>
            Member
          </span>
          <select
            className={selectClass}
            aria-label="Filter by member"
            id="filterMember"
            onChange={(e) => set("memberId", e.target.value)}
            value={filters.memberId}
          >
            <option value="">Everyone</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <span aria-hidden="true" className={labelClass}>
            Day
          </span>
          <input
            className={selectClass}
            aria-label="Filter by day"
            id="filterDate"
            onChange={(e) => set("date", e.target.value)}
            type="date"
            value={filters.date}
          />
        </div>
        <div className="space-y-1">
          <span aria-hidden="true" className={labelClass}>
            Weekday
          </span>
          <select
            className={selectClass}
            aria-label="Filter by weekday"
            id="filterWeekday"
            onChange={(e) => set("weekday", e.target.value)}
            value={filters.weekday}
          >
            <option value="">Any weekday</option>
            {WEEKDAYS.map((name, day) => (
              <option key={name} value={String(day)}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <span aria-hidden="true" className={labelClass}>
            Time of day
          </span>
          <select
            className={selectClass}
            aria-label="Filter by time of day"
            id="filterTime"
            onChange={(e) => set("timeOfDay", e.target.value as TimeOfDay | "")}
            value={filters.timeOfDay}
          >
            <option value="">Any time</option>
            {(Object.keys(TIME_OF_DAY_LABELS) as TimeOfDay[]).map((key) => (
              <option key={key} value={key}>
                {TIME_OF_DAY_LABELS[key]}
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-2 space-y-1 lg:col-span-1">
          <span aria-hidden="true" className={labelClass}>
            Status
          </span>
          <select
            className={selectClass}
            aria-label="Filter by status"
            id="filterStatus"
            onChange={(e) =>
              set("status", e.target.value as ShiftFilters["status"])
            }
            value={filters.status}
          >
            <option value="">Any status</option>
            <option value="flagged">Flagged only</option>
            {(Object.keys(SHIFT_STATUS_LABELS) as ShiftStatus[]).map((key) => (
              <option key={key} value={key}>
                {SHIFT_STATUS_LABELS[key]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p aria-live="polite" className="text-muted-foreground">
          {active > 0
            ? `Showing ${shown} of ${total} shift${total === 1 ? "" : "s"}`
            : `${total} shift${total === 1 ? "" : "s"}`}
        </p>
        {active > 0 && (
          <Button
            onClick={() => onChange(EMPTY_SHIFT_FILTERS)}
            size="sm"
            type="button"
            variant="ghost"
          >
            <X className="mr-1 h-4 w-4" />
            Clear filters ({active})
          </Button>
        )}
      </div>
    </search>
  );
}

export default function Schedule({
  schedulePromise,
  membersPromise,
  timeOffPromise,
  calendarFeedPromise,
  googleConnectedPromise,
  sitesPromise,
  availabilityPromise,
  isAdmin,
}: ScheduleProps) {
  const result = use(schedulePromise);
  const sitesResult = sitesPromise ? use(sitesPromise) : null;
  const sites = sitesResult?.ok ? sitesResult.value : [];
  const members = membersPromise ? use(membersPromise) : [];
  const timeOffResult = timeOffPromise ? use(timeOffPromise) : null;
  const timeOff = timeOffResult?.ok ? timeOffResult.value : [];
  const availability = availabilityPromise ? use(availabilityPromise) : [];
  const [filters, setFilters] = useState<ShiftFilters>(EMPTY_SHIFT_FILTERS);

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
  const shifts = isAdmin
    ? filterShifts(result.value, filters, memberNames)
    : result.value;
  const filtering = isAdmin && activeFilterCount(filters) > 0;
  const upcoming = shifts.filter(isCurrentOrUpcoming);
  const past = shifts.filter((shift) => !isCurrentOrUpcoming(shift)).reverse();

  const nameFor = (shift: ScheduledShiftWithStatus) =>
    isAdmin ? (memberNames.get(shift.user_id) ?? "Unknown member") : undefined;

  const renderList = (list: ScheduledShiftWithStatus[], empty: string) =>
    list.length === 0 ? (
      <p className="py-4 text-muted-foreground text-sm">{empty}</p>
    ) : (
      <ul>
        {list.map((shift) => (
          <ShiftRow
            availability={windowsFor(availability, shift.user_id)}
            isAdmin={isAdmin}
            key={shift.id}
            memberName={nameFor(shift)}
            shift={shift}
            sites={sites}
          />
        ))}
      </ul>
    );

  return (
    <div className="space-y-6 pb-20">
      <GoogleCalendarResume />
      <Card className="p-6 sm:p-8">
        <div className="mb-6 flex items-start gap-3">
          <div className="rounded-xl bg-blue-600 p-2 text-white dark:bg-zinc-100 dark:text-black">
            <CalendarClock className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-bold text-2xl tracking-tight">
              {isAdmin ? "Schedule" : "My schedule"}
            </h3>
            <p className="text-muted-foreground text-sm">
              {isAdmin
                ? "Publish, edit or cancel shifts and compare them with actual clock-ins over the last two weeks and the next four."
                : "Your shifts for the next four weeks, and how the last two went."}
            </p>
          </div>
        </div>

        {isAdmin && (
          <div className="mb-6 grid grid-cols-3 gap-3">
            {(["late", "not_clocked_in", "no_show"] as const).map((status) => (
              <button
                aria-pressed={filters.status === status}
                className={`rounded-xl p-3 text-center transition-shadow hover:opacity-90 ${STATUS_STYLES[status]} ${
                  filters.status === status ? "ring-2 ring-current" : ""
                }`}
                key={status}
                onClick={() =>
                  setFilters({
                    ...filters,
                    status: filters.status === status ? "" : status,
                  })
                }
                title={`Show only ${SHIFT_STATUS_LABELS[status].toLowerCase()} shifts`}
                type="button"
              >
                <div className="font-black text-2xl tabular-nums">
                  {counts[status]}
                </div>
                <div className="font-semibold text-xs">
                  {SHIFT_STATUS_LABELS[status]}
                </div>
              </button>
            ))}
          </div>
        )}

        {isAdmin && (
          <ShiftForm
            availability={availability}
            members={members}
            shifts={result.value}
            sites={sites}
            timeOff={timeOff}
          />
        )}
      </Card>

      {isAdmin && (
        <ShiftFilterBar
          filters={filters}
          members={members}
          onChange={setFilters}
          shown={shifts.length}
          total={result.value.length}
        />
      )}

      <Card className="p-6 sm:p-8">
        <div className="mb-2 flex items-baseline gap-2">
          <h4 className="font-bold text-lg">Upcoming &amp; in progress</h4>
          {filtering && (
            <span className="font-medium text-muted-foreground text-sm">
              {upcoming.length} matching
            </span>
          )}
        </div>
        {renderList(
          upcoming,
          filtering
            ? "No upcoming shifts match these filters."
            : "No upcoming shifts.",
        )}
      </Card>

      <ScheduleCalendar
        calendarFeedPromise={calendarFeedPromise}
        googleConnectedPromise={googleConnectedPromise}
        upcoming={result.value.filter(isCurrentOrUpcoming)}
      />

      <Card className="p-6 sm:p-8">
        <div className="mb-2 flex items-baseline gap-2">
          <h4 className="font-bold text-lg">Past two weeks</h4>
          {filtering && (
            <span className="font-medium text-muted-foreground text-sm">
              {past.length} matching
            </span>
          )}
        </div>
        {renderList(
          past,
          filtering
            ? "No past shifts match these filters."
            : "No shifts in the past two weeks.",
        )}
      </Card>
    </div>
  );
}
