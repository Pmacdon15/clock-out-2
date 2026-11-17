import { getEffectiveHours } from "./break-utils";
import type { BreakSettingsData, TimeEntry } from "./types";

/**
 * A "job" is one organization the signed-in user belongs to. The role comes
 * from Clerk's membership list for that user, never from the URL or client.
 */
export type Job = {
  orgId: string;
  name: string;
  isAdmin: boolean;
};

/** One shift as the Jobs page shows it: no coordinates or addresses. */
export type JobEntryRow = {
  id: number;
  userId: string;
  memberName: string;
  clockIn: string;
  clockOut: string | null;
  hours: number;
};

export type JobMemberTotal = {
  userId: string;
  name: string;
  hours: number;
  shifts: number;
};

export type JobHours = Job & {
  totalHours: number;
  shifts: number;
  /** Per-member totals, most hours first. Only the caller's own unless admin. */
  members: JobMemberTotal[];
  /** Newest first. */
  entries: JobEntryRow[];
  /** Set when this job's entries could not be read. */
  error?: string;
};

export type JobsHoursView = {
  /** Every job the caller holds, for the picker. */
  jobs: Job[];
  /** Org ids shown, in the order of `jobs`. */
  selected: string[];
  results: JobHours[];
  totalHours: number;
  shifts: number;
};

/** Upper bound on job ids read from the URL, so a huge list is cut short. */
export const MAX_JOB_SELECTION = 100;

/**
 * Reads the `jobs` search param: a comma-separated list of org ids. Missing,
 * empty or "all" means every job. Ids are only a request: the DAL keeps the
 * ones the caller actually belongs to.
 */
export function parseJobSelection(raw: string | undefined): string[] | "all" {
  if (!raw || raw === "all") return "all";
  const ids = [
    ...new Set(
      raw
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ].slice(0, MAX_JOB_SELECTION);
  return ids.length > 0 ? ids : "all";
}

/** The caller's jobs that the selection names, keeping the jobs' order. */
export function selectJobs(jobs: Job[], selection: string[] | "all"): Job[] {
  if (selection === "all") return jobs;
  const wanted = new Set(selection);
  return jobs.filter((job) => wanted.has(job.orgId));
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const iso = (d: Date | string) => new Date(d).toISOString();

/**
 * Totals one job's entries. `entries` must already be scoped to what the
 * caller may see; this never widens it.
 */
export function summarizeJob(
  job: Job,
  entries: TimeEntry[],
  breakSettings: BreakSettingsData | null | undefined,
  memberName: (userId: string) => string,
  nowMs: number = Date.now(),
): JobHours {
  const rows: JobEntryRow[] = entries.map((entry) => ({
    id: entry.id,
    userId: entry.user_id,
    memberName: memberName(entry.user_id),
    clockIn: iso(entry.clock_in),
    clockOut: entry.clock_out ? iso(entry.clock_out) : null,
    hours: getEffectiveHours(entry, breakSettings, nowMs),
  }));

  const byMember = new Map<string, JobMemberTotal>();
  for (const row of rows) {
    const total = byMember.get(row.userId) ?? {
      userId: row.userId,
      name: row.memberName,
      hours: 0,
      shifts: 0,
    };
    total.hours += row.hours;
    total.shifts += 1;
    byMember.set(row.userId, total);
  }

  const members = [...byMember.values()]
    .map((m) => ({ ...m, hours: round2(m.hours) }))
    .sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name));

  return {
    ...job,
    totalHours: round2(rows.reduce((sum, row) => sum + row.hours, 0)),
    shifts: rows.length,
    members,
    entries: rows
      .map((row) => ({ ...row, hours: round2(row.hours) }))
      .sort((a, b) => b.clockIn.localeCompare(a.clockIn)),
  };
}

/** An empty result for a job whose entries could not be read. */
export function failedJob(job: Job, error: string): JobHours {
  return { ...job, totalHours: 0, shifts: 0, members: [], entries: [], error };
}

/** Builds `?jobs=` for a selection; null means "all jobs" (no param). */
export function jobSelectionParam(
  allJobs: Job[],
  selected: string[],
): string | null {
  if (selected.length === 0 || selected.length === allJobs.length) return null;
  return selected.join(",");
}
