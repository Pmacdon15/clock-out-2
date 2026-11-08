import { fromZonedTime } from "date-fns-tz";
import { z } from "zod";
import { normalizeAlertSettings } from "@/lib/alerts";
import { dbGetAlertSettings } from "@/lib/alerts-db";
import {
  AUDIT_CHECKS,
  type AuditFinding,
  auditTimesheets,
} from "@/lib/audit-timesheets";
import type { TimeEntry } from "@/lib/types";
import {
  dbGetBreakSettings,
  dbGetOrgTimeEntries,
  dbGetSites,
  dbGetTimeEntries,
} from "@/mcp/db";
import {
  fetchOrgMembers,
  type McpCaller,
  resolveMemberFromList,
  resolveOrg,
  type ToolResult,
  validTimezone,
} from "@/mcp/tools";

/*
 * audit_timesheets: flags timesheet problems for a date range (missed
 * clock-outs, long shifts, overlaps, skipped meal breaks, far-away punches,
 * after-the-fact edits). Detection lives in `@/lib/audit-timesheets`; this
 * file only loads the organization's data and shapes the response.
 */

/** Longest period one audit may cover, matching run_hours_report. */
export const MAX_AUDIT_DAYS = 366;

const threshold = (description: string, max: number) =>
  z.number().min(0).max(max).optional().describe(description);

export const auditTimesheetsInputSchema = z.object({
  org_id: z
    .string()
    .optional()
    .describe(
      "Organization ID (org_...), slug, or name. Optional if the user only belongs to one organization.",
    ),
  start_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .describe("First day to audit (YYYY-MM-DD, inclusive)."),
  end_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .describe("Last day to audit (YYYY-MM-DD, inclusive)."),
  member: z
    .string()
    .optional()
    .describe(
      "Only audit this member (name, first name, email, or user_id), or 'all' for everyone. Defaults to 'all'.",
    ),
  checks: z
    .array(z.enum(AUDIT_CHECKS))
    .optional()
    .describe(
      "Only run these checks: 'missed_clock_out', 'long_shift', 'overlapping_entries', 'missed_meal_break', 'punch_far_from_site', 'edited_after_the_fact'. Defaults to all of them.",
    ),
  long_shift_hours: threshold(
    "Flag completed shifts longer than this many hours. Default 12.",
    48,
  ),
  missed_clock_out_hours: threshold(
    "Flag shifts still open after this many hours as missed clock-outs. Default 12.",
    72,
  ),
  meal_break_after_hours: threshold(
    "Shifts at least this many hours long need a meal break. Defaults to the organization's lunch rule (lunch_min_shift_hours), else 5.",
    24,
  ),
  meal_break_min_minutes: threshold(
    "Shortest meal break that satisfies the rule, in minutes. Default 30.",
    240,
  ),
  max_distance_meters: threshold(
    "Flag punches more than this many metres outside the nearest work site's geofence (after GPS accuracy). Default 250.",
    100_000,
  ),
  edit_grace_minutes: threshold(
    "Minutes between a punch and when it was saved before the entry counts as entered or edited after the fact. Default 15.",
    1440,
  ),
  timezone: z
    .string()
    .optional()
    .describe(
      "IANA timezone name (e.g. 'America/Edmonton') used for dates and the suggested fixes. Defaults to 'America/Edmonton'.",
    ),
});

export type AuditTimesheetsInput = z.infer<typeof auditTimesheetsInputSchema>;

function summarize(findings: AuditFinding[], period: string, org: string) {
  if (findings.length === 0) {
    return `No timesheet problems found for ${org} from ${period}.`;
  }
  const fixable = findings.filter((f) => f.suggested_fix).length;
  const lines = findings.map(
    (f, i) =>
      `${i + 1}. [${f.severity}] ${f.type} — ${f.employee.name}, ${f.date} (entry ${f.entry_ids.map((id) => `#${id}`).join(", ")}): ${f.description}${f.suggested_fix ? ` Suggested fix (update_time_entry): ${JSON.stringify(f.suggested_fix)}.` : ""} ${f.fix_note}`,
  );
  return [
    `Found ${findings.length} timesheet issue${findings.length === 1 ? "" : "s"} for ${org} from ${period} (${fixable} with a suggested update_time_entry fix). Confirm with the admin before applying any fix.`,
    ...lines,
  ].join("\n");
}

export async function auditTimesheetsTool(
  caller: McpCaller,
  input: AuditTimesheetsInput,
): Promise<ToolResult> {
  const orgRes = await resolveOrg(caller.userId, input.org_id);
  if (!orgRes.ok) return orgRes.result;
  const { org } = orgRes;

  if (!org.isAdmin) {
    return {
      summary:
        "Only organization admins (org:admin) can audit timesheets. Members can review their own hours with get_weekly_timecard.",
      data: { status: "forbidden" },
      isError: true,
    };
  }

  const tz = validTimezone(input.timezone);
  const startStr = input.start_date.slice(0, 10);
  const endStr = input.end_date.slice(0, 10);
  const startDate = fromZonedTime(`${startStr}T00:00:00.000`, tz);
  const endDate = fromZonedTime(`${endStr}T23:59:59.999`, tz);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return {
      summary: "start_date and end_date must be valid dates (YYYY-MM-DD).",
      data: { status: "invalid_dates" },
      isError: true,
    };
  }
  if (startDate > endDate) {
    return {
      summary: `start_date (${startStr}) must be on or before end_date (${endStr}).`,
      data: { status: "invalid_dates" },
      isError: true,
    };
  }
  if (endDate.getTime() - startDate.getTime() > MAX_AUDIT_DAYS * 86_400_000) {
    return {
      summary: `An audit can cover at most ${MAX_AUDIT_DAYS} days. Split the period into smaller ranges.`,
      data: { status: "range_too_long" },
      isError: true,
    };
  }

  const members = await fetchOrgMembers(org.orgId);
  const requested = input.member?.trim();
  const wantsAll = !requested || requested.toLowerCase() === "all";

  let entries: TimeEntry[];
  let auditedMember: { user_id: string; name: string } | null = null;
  if (wantsAll) {
    entries = await dbGetOrgTimeEntries(org.orgId, startDate, endDate);
  } else {
    const memberRes = resolveMemberFromList(
      members,
      caller.userId,
      org.isAdmin,
      requested,
    );
    if (!memberRes.ok) return memberRes.result;
    auditedMember = {
      user_id: memberRes.member.userId,
      name: memberRes.member.name,
    };
    entries = await dbGetTimeEntries(
      memberRes.member.userId,
      org.orgId,
      startDate,
      endDate,
    );
  }
  // Never audit another organization's rows, whatever the query returned.
  entries = entries.filter((e) => e.org_id === org.orgId);

  const [breakSettings, sites, alertSettings] = await Promise.all([
    dbGetBreakSettings(org.orgId).catch(() => null),
    dbGetSites(org.orgId).catch(() => []),
    dbGetAlertSettings(org.orgId).catch(() => undefined),
  ]);

  const result = auditTimesheets({
    entries,
    employeeNames: new Map(members.map((m) => [m.userId, m.name])),
    timezone: tz,
    nowMs: Date.now(),
    thresholds: {
      long_shift_hours: input.long_shift_hours,
      missed_clock_out_hours: input.missed_clock_out_hours,
      meal_break_after_hours: input.meal_break_after_hours,
      meal_break_min_minutes: input.meal_break_min_minutes,
      max_distance_meters: input.max_distance_meters,
      edit_grace_minutes: input.edit_grace_minutes,
    },
    checks: input.checks,
    sites: sites ?? [],
    breakSettings: breakSettings ?? null,
    autoClockOutHours: alertSettings
      ? normalizeAlertSettings(alertSettings).auto_clock_out_hours
      : null,
  });

  const periodLabel = `${startStr} to ${endStr}`;
  return {
    summary: summarize(result.findings, periodLabel, org.orgName),
    data: {
      status: "ok",
      organization: { org_id: org.orgId, name: org.orgName },
      period: {
        label: periodLabel,
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        timezone: tz,
      },
      member: auditedMember,
      entries_audited: entries.length,
      thresholds: result.thresholds,
      checks: result.checks,
      counts: result.counts,
      findings: result.findings,
      how_to_fix:
        "Each finding's suggested_fix, when not null, is the exact input for update_time_entry. Show the findings to the admin and apply a fix only after they confirm it.",
    },
  };
}
