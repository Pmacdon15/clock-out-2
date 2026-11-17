"use client";

import { format } from "date-fns";
import { Briefcase, ShieldCheck, User } from "lucide-react";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { use, useState } from "react";
import { getSelectableYears } from "@/lib/date-utils";
import {
  type JobEntryRow,
  type JobsHoursView,
  jobSelectionParam,
} from "@/lib/jobs";
import type { SerializableResult } from "@/lib/types";
import JobsChart, { memberColor } from "./JobsChart";
import LocalTime from "./LocalTime";
import { Card } from "./ui";
import {
  TimeframeSelector,
  type TimeframeValue,
} from "./ViewHours/TimeframeSelector";

export type JobsPanelProps = {
  viewPromise: Promise<SerializableResult<JobsHoursView, { reason: string }>>;
  timeframePromise: Promise<string | undefined>;
  startDatePromise: Promise<string | undefined>;
  endDatePromise: Promise<string | undefined>;
};

const hoursLabel = (hours: number) => `${hours.toFixed(2)} h`;

/** Shifts listed per job before "Show more". */
export const ENTRY_PAGE_SIZE = 10;

const ColorDot = ({ color }: { color: string }) => (
  <span
    aria-hidden
    className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
    style={{ backgroundColor: color }}
  />
);

/**
 * Hours across several of the signed-in user's jobs (organizations) at once.
 * Admins of a job see every member's shifts in it; in any other job, only
 * their own. The server decides that; this only renders what it was sent.
 */
export default function JobsPanel({
  viewPromise,
  timeframePromise,
  startDatePromise,
  endDatePromise,
}: JobsPanelProps) {
  const result = use(viewPromise);
  const timeframe = ((use(timeframePromise) as TimeframeValue | undefined) ??
    "week") as TimeframeValue;
  const today = new Date().toLocaleDateString("en-CA");
  const startDate = use(startDatePromise) ?? today;
  const endDate = use(endDatePromise) ?? today;

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (!result.ok) {
    return (
      <Card className="p-8 text-center text-red-500">
        {"Error loading your jobs: "}
        {result.error.reason}
      </Card>
    );
  }

  const view = result.value;
  const selected = new Set(view.selected);

  const pushSelection = (ids: string[]) => {
    const params = new URLSearchParams(searchParams.toString());
    const value = jobSelectionParam(view.jobs, ids);
    if (value === null) params.delete("jobs");
    else params.set("jobs", value);
    const query = params.toString();
    router.push(`${pathname}${query ? `?${query}` : ""}` as Route);
  };

  const toggle = (orgId: string) => {
    const next = selected.has(orgId)
      ? view.selected.filter((id) => id !== orgId)
      : view.jobs
          .map((j) => j.orgId)
          .filter((id) => id === orgId || selected.has(id));
    // Keep at least one job picked; unticking the last one does nothing.
    if (next.length > 0) pushSelection(next);
  };

  const allSelected = view.selected.length === view.jobs.length;

  return (
    <div className="space-y-8">
      <TimeframeSelector
        availableYears={getSelectableYears()}
        endDate={endDate}
        startDate={startDate}
        timeframe={timeframe}
      />

      <Card className="p-4">
        <fieldset>
          <legend className="mb-3 font-semibold text-sm text-zinc-700 dark:text-zinc-300">
            Jobs to show
          </legend>
          {view.jobs.length === 0 ? (
            <p className="text-sm text-zinc-500">
              You aren't a member of any organization yet.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                aria-pressed={allSelected}
                className={`rounded-full border px-3 py-1 font-medium text-sm ${
                  allSelected
                    ? "border-blue-600 bg-blue-600 text-white"
                    : "border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
                }`}
                onClick={() => pushSelection(view.jobs.map((j) => j.orgId))}
                type="button"
              >
                All jobs
              </button>
              {view.jobs.map((job) => (
                <label
                  className="flex cursor-pointer items-center gap-2 rounded-full border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700"
                  key={job.orgId}
                >
                  <input
                    checked={selected.has(job.orgId)}
                    onChange={() => toggle(job.orgId)}
                    type="checkbox"
                  />
                  {job.name}
                </label>
              ))}
            </div>
          )}
        </fieldset>
      </Card>

      <Card className="flex flex-wrap items-center justify-between gap-4 p-4">
        <div>
          <p className="text-xs text-zinc-500 uppercase tracking-wide">
            Total across {view.results.length}{" "}
            {view.results.length === 1 ? "job" : "jobs"}
          </p>
          <p className="font-bold text-2xl">{hoursLabel(view.totalHours)}</p>
        </div>
        <p className="text-sm text-zinc-500">
          {view.shifts} {view.shifts === 1 ? "shift" : "shifts"}
        </p>
      </Card>

      {view.results.map((job) => (
        <section aria-label={job.name} className="space-y-3" key={job.orgId}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 font-semibold text-lg">
              <Briefcase className="h-5 w-5" />
              {job.name}
            </h3>
            <span className="flex items-center gap-1 text-xs text-zinc-500">
              {job.isAdmin ? (
                <>
                  <ShieldCheck className="h-4 w-4" /> Admin · all members
                </>
              ) : (
                <>
                  <User className="h-4 w-4" /> Your hours only
                </>
              )}
            </span>
          </div>

          {job.error ? (
            <Card className="p-4 text-red-500 text-sm">{job.error}</Card>
          ) : (
            <Card className="divide-y divide-zinc-200 dark:divide-zinc-800">
              <div className="flex items-center justify-between p-4">
                <span className="font-medium">Total</span>
                <span className="font-bold">
                  {hoursLabel(job.totalHours)} · {job.shifts}{" "}
                  {job.shifts === 1 ? "shift" : "shifts"}
                </span>
              </div>
              {job.isAdmin &&
                job.members.map((m, i) => (
                  <div
                    className="flex items-center justify-between px-4 py-2 text-sm"
                    key={m.userId}
                  >
                    <span className="flex items-center gap-2">
                      <ColorDot color={memberColor(i)} />
                      {m.name}
                    </span>
                    <span>
                      {hoursLabel(m.hours)} · {m.shifts}
                    </span>
                  </div>
                ))}
              <JobsChart job={job} />
              {job.entries.length === 0 ? (
                <p className="p-4 text-sm text-zinc-500">
                  No shifts in this range.
                </p>
              ) : (
                <JobEntries
                  colorOf={(userId) =>
                    memberColor(
                      Math.max(
                        0,
                        job.members.findIndex((m) => m.userId === userId),
                      ),
                    )
                  }
                  entries={job.entries}
                  showNames={job.isAdmin}
                />
              )}
            </Card>
          )}
        </section>
      ))}
    </div>
  );
}

/**
 * A job's shifts, a page at a time: a month of a busy team is hundreds of
 * rows, so only the newest few show until asked for more.
 */
function JobEntries({
  entries,
  showNames,
  colorOf,
}: {
  entries: JobEntryRow[];
  showNames: boolean;
  colorOf: (userId: string) => string;
}) {
  const [shown, setShown] = useState(ENTRY_PAGE_SIZE);
  const [open, setOpen] = useState(true);
  const visible = entries.slice(0, shown);
  const remaining = entries.length - visible.length;

  return (
    <div>
      <button
        aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-2 text-left font-medium text-sm text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-900"
        onClick={() => setOpen((o) => !o)}
        type="button"
      >
        <span>Shifts ({entries.length})</span>
        <span className="text-xs">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <>
          <ul className="text-sm">
            {visible.map((entry) => (
              <li
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-2"
                key={entry.id}
              >
                <span className="flex items-center gap-2">
                  {showNames && (
                    <>
                      <ColorDot color={colorOf(entry.userId)} />
                      <span className="font-medium">{entry.memberName}</span>
                    </>
                  )}
                  <LocalTime>
                    {() =>
                      `${format(new Date(entry.clockIn), "EEE MMM d, h:mm a")} – ${
                        entry.clockOut
                          ? format(new Date(entry.clockOut), "h:mm a")
                          : "now"
                      }`
                    }
                  </LocalTime>
                </span>
                <span className="tabular-nums">{hoursLabel(entry.hours)}</span>
              </li>
            ))}
          </ul>
          {(remaining > 0 || shown > ENTRY_PAGE_SIZE) && (
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
              <span className="text-xs text-zinc-500">
                Showing {visible.length} of {entries.length}
              </span>
              <div className="flex gap-3">
                {remaining > 0 && (
                  <>
                    <button
                      className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                      onClick={() => setShown((n) => n + ENTRY_PAGE_SIZE)}
                      type="button"
                    >
                      Show {Math.min(ENTRY_PAGE_SIZE, remaining)} more
                    </button>
                    <button
                      className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                      onClick={() => setShown(entries.length)}
                      type="button"
                    >
                      Show all
                    </button>
                  </>
                )}
                {shown > ENTRY_PAGE_SIZE && (
                  <button
                    className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                    onClick={() => setShown(ENTRY_PAGE_SIZE)}
                    type="button"
                  >
                    Show less
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
