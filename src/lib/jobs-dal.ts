import { auth, clerkClient } from "@clerk/nextjs/server";
import { isValidTimeZone } from "./alerts";
import { fetchAllPages } from "./clerk-pagination";
import { parseFilterDate } from "./date-utils";
import {
  dbGetBreakSettings,
  dbGetOrgTimeEntries,
  dbGetTimeEntries,
} from "./db";
import {
  failedJob,
  type Job,
  type JobHours,
  type JobsHoursView,
  parseJobSelection,
  selectJobs,
  summarizeJob,
} from "./jobs";
import type { SerializableResult, TimeEntry } from "./types";
import { getProcessedMembers } from "./utils-clerk";

type Result<T> = SerializableResult<T, { reason: string }>;

/**
 * Every organization the signed-in user belongs to, with their role in each,
 * read from Clerk for this user. This is the only source of `isAdmin` on the
 * Jobs page: the active organization in the session plays no part.
 */
async function listMyJobs(userId: string): Promise<Job[]> {
  const client = await clerkClient();
  const memberships = await fetchAllPages(
    (params) =>
      client.users.getOrganizationMembershipList({ userId, ...params }),
    { label: `organizations of ${userId}` },
  );
  return memberships
    .map((m) => ({
      orgId: m.organization.id,
      name: m.organization.name,
      isAdmin: m.role === "org:admin",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Display names of an org's members, for an admin's view of that org. */
async function memberNamesFor(orgId: string): Promise<Map<string, string>> {
  const client = await clerkClient();
  const members = await fetchAllPages(
    (params) =>
      client.organizations.getOrganizationMembershipList({
        organizationId: orgId,
        ...params,
      }),
    { label: `members of ${orgId}` },
  );
  const processed = await getProcessedMembers(orgId, members);
  return new Map(processed.map((m) => [m.id, m.name]));
}

/**
 * One job's entries, scoped by the caller's role in that org: an admin sees
 * everyone's shifts, anyone else only their own.
 */
async function readJob(
  job: Job,
  userId: string,
  startDate: Date | undefined,
  endDate: Date | undefined,
  nowMs: number,
): Promise<JobHours> {
  try {
    const [entries, breakSettings, names] = await Promise.all([
      job.isAdmin
        ? dbGetOrgTimeEntries(job.orgId, startDate, endDate)
        : dbGetTimeEntries(userId, job.orgId, startDate, endDate),
      dbGetBreakSettings(job.orgId),
      job.isAdmin
        ? memberNamesFor(job.orgId).catch((error) => {
            console.error(`Error fetching members of ${job.orgId}:`, error);
            return new Map<string, string>();
          })
        : Promise.resolve(new Map<string, string>()),
    ]);

    // Belt and braces: whatever the query returned, a non-admin's view
    // never holds anyone else's shift, and every row belongs to this org.
    const visible = (entries as TimeEntry[]).filter(
      (e) => e.org_id === job.orgId && (job.isAdmin || e.user_id === userId),
    );

    const nameOf = (id: string) =>
      id === userId ? "You" : (names.get(id) ?? "Former member");

    return summarizeJob(job, visible, breakSettings, nameOf, nowMs);
  } catch (error) {
    console.error(`Error fetching entries for ${job.orgId}:`, error);
    return failedJob(job, "Could not load this job's hours");
  }
}

/**
 * Hours across several of the caller's jobs at once. `jobs` is the raw
 * `?jobs=` param (comma-separated org ids, or missing for all); ids the
 * caller doesn't belong to are dropped, never queried.
 */
export async function getJobsHours(
  jobsParam: string | undefined,
  filters?: { start?: string; end?: string; timezone?: string },
): Promise<Result<JobsHoursView>> {
  const { userId } = await auth.protect();
  if (!userId) {
    return { ok: false, error: { reason: "Unauthorized" } };
  }

  const tz = filters?.timezone || "UTC";
  if (!isValidTimeZone(tz)) {
    return { ok: false, error: { reason: "Invalid time zone" } };
  }
  const startDate = parseFilterDate(filters?.start, tz, false);
  const endDate = parseFilterDate(filters?.end, tz, true);
  if (
    (startDate && Number.isNaN(startDate.getTime())) ||
    (endDate && Number.isNaN(endDate.getTime()))
  ) {
    return { ok: false, error: { reason: "Invalid date range" } };
  }

  let jobs: Job[];
  try {
    jobs = await listMyJobs(userId);
  } catch (error) {
    console.error("Error fetching jobs:", error);
    return { ok: false, error: { reason: "Could not load your jobs" } };
  }

  const chosen = selectJobs(jobs, parseJobSelection(jobsParam));
  // Asked only for jobs they don't hold: show all of theirs instead.
  const shown = chosen.length > 0 ? chosen : jobs;

  const nowMs = Date.now();
  const results = await Promise.all(
    shown.map((job) => readJob(job, userId, startDate, endDate, nowMs)),
  );

  return {
    ok: true,
    value: {
      jobs,
      selected: shown.map((job) => job.orgId),
      results,
      totalHours:
        Math.round(results.reduce((sum, r) => sum + r.totalHours, 0) * 100) /
        100,
      shifts: results.reduce((sum, r) => sum + r.shifts, 0),
    },
  };
}
