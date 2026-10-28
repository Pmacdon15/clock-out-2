import { clerkClient } from "@clerk/nextjs/server";
import {
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  startOfDay,
  startOfWeek,
  subDays,
} from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { z } from "zod";
import {
  dbClockInAt,
  dbClockOutAt,
  dbDeleteTimeEntry,
  dbFindOverlappingTimeEntries,
  dbGetActiveEntry,
  dbGetOrgActiveEntries,
  dbGetOrgTimeEntries,
  dbGetReportingSettings,
  dbGetTimeEntries,
  dbGetTimeEntryById,
  dbInsertTimeEntry,
  dbUpdateReportingSettings,
  dbUpdateTimeEntry,
  invalidateReportingSettingsCache,
  invalidateTimeEntryCache,
} from "@/mcp/db";
import { sendWeeklyReports } from "@/lib/reports";
import type { TimeEntry } from "@/lib/types";
import { isOverMemberShipLimit } from "@/lib/utils-clerk";

export type McpCaller = {
  userId: string;
  client: string | null;
};

export type ToolResult = {
  summary: string;
  data: Record<string, unknown>;
  isError?: boolean;
};

const DEFAULT_TIMEZONE = "America/Edmonton";

/*
 * ============================================================================
 * Zod Input Schemas (wrapped with `portable()` in `src/mcp/server.ts`)
 * ============================================================================
 */

const orgIdField = z
  .string()
  .optional()
  .describe(
    "Organization ID (org_...), slug, or name. Optional if the user only belongs to one organization.",
  );

const memberField = z
  .string()
  .optional()
  .describe(
    "Target member's user_id (user_...), full/first name, or email. Omit to act on yourself. Admins can specify any member in the organization.",
  );

const timezoneField = z
  .string()
  .optional()
  .describe(
    "IANA timezone name (e.g. 'America/Edmonton', 'America/Toronto', 'UTC'). Defaults to 'America/Edmonton'.",
  );

export const listOrganizationsInputSchema = z.object({});

export const listMembersInputSchema = z.object({
  org_id: orgIdField,
});

export const whoIsWorkingInputSchema = z.object({
  org_id: orgIdField,
  timezone: timezoneField,
});

export const getClockStatusInputSchema = z.object({
  org_id: orgIdField,
  member: memberField,
  timezone: timezoneField,
});

export const clockInInputSchema = z.object({
  org_id: orgIdField,
  member: memberField,
  clock_in: z
    .string()
    .optional()
    .describe(
      "Optional ISO 8601 or 'YYYY-MM-DD HH:mm' start time if clocking in as of a specific time. Defaults to right now.",
    ),
  timezone: timezoneField,
});

export const clockOutInputSchema = z.object({
  org_id: orgIdField,
  member: memberField,
  clock_out: z
    .string()
    .optional()
    .describe(
      "Optional ISO 8601 or 'YYYY-MM-DD HH:mm' end time if clocking out as of a specific time. Defaults to right now.",
    ),
  timezone: timezoneField,
});

const singleShiftInputSchema = z.object({
  member: z
    .string()
    .optional()
    .describe(
      "Member name, email, or user_id for this specific shift (overrides top-level member if provided).",
    ),
  date: z
    .string()
    .optional()
    .describe(
      "Shift date as YYYY-MM-DD (used when clock_in/clock_out are given as HH:mm or 9:00 AM, or when hours_worked is provided).",
    ),
  clock_in: z
    .string()
    .optional()
    .describe(
      "Clock-in time as ISO 8601 ('2026-10-26T09:00:00'), 'YYYY-MM-DD HH:mm', or time of day ('09:00' / '9:00 AM' when date is set).",
    ),
  clock_out: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Clock-out time as ISO 8601, 'YYYY-MM-DD HH:mm', or time of day ('17:00' / '5:00 PM' when date is set). Omit or null if only hours_worked is given or if starting an active shift.",
    ),
  hours_worked: z
    .number()
    .positive()
    .optional()
    .describe(
      "If a timecard image only lists total hours for a date (e.g. 8 or 7.5) without start/end times, provide date + hours_worked (starts at 09:00 local time unless clock_in is also given).",
    ),
});

export const addTimeEntryInputSchema = z.object({
  org_id: orgIdField,
  member: memberField,
  timezone: timezoneField,
  date: z
    .string()
    .optional()
    .describe("Shift date as YYYY-MM-DD (for a single shift)."),
  clock_in: z
    .string()
    .optional()
    .describe(
      "Clock-in time for a single shift (ISO 8601, 'YYYY-MM-DD HH:mm', or '09:00'/'9:00 AM' with date).",
    ),
  clock_out: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Clock-out time for a single shift (ISO 8601, 'YYYY-MM-DD HH:mm', or '17:00'/'5:00 PM' with date).",
    ),
  hours_worked: z
    .number()
    .positive()
    .optional()
    .describe(
      "Total hours worked for a single shift when only date + duration are known (e.g. from a weekly timecard photo).",
    ),
  entries: z
    .array(singleShiftInputSchema)
    .optional()
    .describe(
      "Batch of multiple shifts to add at once (e.g. extracted from a photo/image of a weekly timecard). Every shift is checked to prevent double or overlapping times.",
    ),
});

export const listTimeEntriesInputSchema = z.object({
  org_id: orgIdField,
  member: z
    .string()
    .optional()
    .describe(
      "Filter by a specific member (name, email, or user_id), or pass 'all' (admins only) to list entries for everyone in the organization. Defaults to yourself (or 'all' if you are an admin and ask for org entries).",
    ),
  start_date: z
    .string()
    .optional()
    .describe(
      "Start date (YYYY-MM-DD or ISO timestamp). Defaults to 7 days ago.",
    ),
  end_date: z
    .string()
    .optional()
    .describe("End date (YYYY-MM-DD or ISO timestamp). Defaults to today."),
  timezone: timezoneField,
});

export const getWeeklyTimecardInputSchema = z.object({
  org_id: orgIdField,
  member: z
    .string()
    .optional()
    .describe(
      "Target member (name, email, or user_id), or 'all' (admins only) to see the weekly timecard and hours for everyone in the organization. Admins default to 'all'; members default to themselves.",
    ),
  week_of: z
    .string()
    .optional()
    .describe(
      "Any YYYY-MM-DD date within the target 7-day Monday–Sunday week. Ignored if start_date/end_date or year/month/week are given.",
    ),
  start_date: z
    .string()
    .optional()
    .describe("Explicit period start date (YYYY-MM-DD)."),
  end_date: z
    .string()
    .optional()
    .describe("Explicit period inclusive end date (YYYY-MM-DD)."),
  year: z
    .number()
    .int()
    .optional()
    .describe(
      "Year (e.g. 2026) when using Clock Out's month-week 1–4 selector.",
    ),
  month: z
    .number()
    .int()
    .min(1)
    .max(12)
    .optional()
    .describe(
      "Month 1–12 (e.g. 10 for October) when using Clock Out's month-week 1–4 selector.",
    ),
  week: z
    .number()
    .int()
    .min(1)
    .max(4)
    .optional()
    .describe(
      "Clock Out month-week number (1 = days 1–7, 2 = days 8–14, 3 = days 15–21, 4 = day 22 to end of month).",
    ),
  timezone: timezoneField,
});

export const updateTimeEntryInputSchema = z.object({
  org_id: orgIdField,
  entry_id: z
    .number()
    .int()
    .optional()
    .describe(
      "The numeric ID of the time entry to update (from list_time_entries or get_weekly_timecard). Can be omitted if member/self + date uniquely identify a single entry on that day.",
    ),
  member: memberField,
  date: z
    .string()
    .optional()
    .describe(
      "Date of the shift as YYYY-MM-DD (used to locate the entry if entry_id is omitted, and to resolve time-of-day strings like '09:00').",
    ),
  clock_in: z
    .string()
    .optional()
    .describe(
      "New clock-in time (ISO 8601, 'YYYY-MM-DD HH:mm', or '09:00'/'9:00 AM' when date is known).",
    ),
  clock_out: z
    .string()
    .nullable()
    .optional()
    .describe(
      "New clock-out time (ISO 8601, 'YYYY-MM-DD HH:mm', '17:00'/'5:00 PM', or null to leave the shift open/active).",
    ),
  hours_worked: z
    .number()
    .positive()
    .optional()
    .describe(
      "Alternatively, set the shift's total hours worked (adjusts clock_out relative to clock_in).",
    ),
  timezone: timezoneField,
});

export const deleteTimeEntryInputSchema = z.object({
  org_id: orgIdField,
  entry_id: z
    .number()
    .int()
    .describe("The numeric ID of the time entry to delete."),
});

export const manageReportingSettingsInputSchema = z.object({
  org_id: orgIdField,
  action: z
    .enum(["get", "update", "send_test_report"])
    .optional()
    .describe(
      "Action to perform: 'get' (view current settings), 'update' (change reporting schedule), or 'send_test_report' (email the last 7 days report to org admins now). Defaults to 'get'.",
    ),
  report_frequency: z
    .enum(["weekly", "twice-monthly", "custom"])
    .optional()
    .describe("Report frequency when action is 'update'."),
  report_day: z
    .enum([
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ])
    .nullable()
    .optional()
    .describe("Day of the week when report_frequency is 'custom'."),
  report_interval: z
    .number()
    .int()
    .min(1)
    .max(2)
    .optional()
    .describe("Interval in weeks (1 or 2) when report_frequency is 'custom'."),
});

/*
 * ============================================================================
 * Helpers: Organization, Member, Time & Duration Resolution
 * ============================================================================
 */

export type OrgContext = {
  orgId: string;
  orgName: string;
  orgSlug: string | null;
  role: string;
  isAdmin: boolean;
};

export type OrgMemberInfo = {
  userId: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  role: string;
  isAdmin: boolean;
};

export function formatDurationMs(ms: number) {
  const safeMs = Math.max(0, ms);
  const totalMinutes = Math.floor(safeMs / (1000 * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const decimalHours = Number((safeMs / (1000 * 60 * 60)).toFixed(2));
  return {
    totalMinutes,
    hours,
    minutes,
    decimalHours,
    formatted: hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`,
  };
}

function formatTimestampInTz(date: Date | string | null, tz: string) {
  if (!date) return null;
  const d = typeof date === "string" ? new Date(date) : date;
  try {
    return formatInTimeZone(d, tz, "yyyy-MM-dd HH:mm:ss zzz");
  } catch {
    return d.toISOString();
  }
}

function validTimezone(tz?: string): string {
  if (!tz) return DEFAULT_TIMEZONE;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/**
 * Parses flexible date/time input in the given timezone:
 * - Full ISO with offset or Z: `2026-10-26T09:00:00Z` or `2026-10-26T09:00:00-06:00`
 * - Local ISO / datetime without offset: `2026-10-26T09:00` or `2026-10-26 09:00`
 * - Time-only (`09:00`, `9:30 AM`, `5:15 PM`) combined with `fallbackDate` (`YYYY-MM-DD`)
 */
export function parseFlexibleDateTime(
  input: string | undefined | null,
  tz: string,
  fallbackDate?: string,
): Date | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Time-only string such as "09:00", "9:00 AM", "17:30:00", "5:15pm"
  const timeOnlyMatch = trimmed.match(
    /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i,
  );
  if (timeOnlyMatch) {
    const baseDate =
      fallbackDate?.trim() || formatInTimeZone(new Date(), tz, "yyyy-MM-dd");
    let hours = Number.parseInt(timeOnlyMatch[1] ?? "0", 10);
    const minutes = Number.parseInt(timeOnlyMatch[2] ?? "0", 10);
    const seconds = Number.parseInt(timeOnlyMatch[3] ?? "0", 10);
    const meridiem = timeOnlyMatch[4]?.toLowerCase();
    if (meridiem === "pm" && hours < 12) hours += 12;
    if (meridiem === "am" && hours === 12) hours = 0;
    const hh = String(hours).padStart(2, "0");
    const mm = String(minutes).padStart(2, "0");
    const ss = String(seconds).padStart(2, "0");
    return fromZonedTime(`${baseDate}T${hh}:${mm}:${ss}`, tz);
  }

  // Date + 12-hour time e.g. "2026-10-26 9:00 AM"
  const date12hMatch = trimmed.match(
    /^(\d{4}-\d{2}-\d{2})[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)$/i,
  );
  if (date12hMatch) {
    const datePart = date12hMatch[1];
    let hours = Number.parseInt(date12hMatch[2] ?? "0", 10);
    const minutes = Number.parseInt(date12hMatch[3] ?? "0", 10);
    const seconds = Number.parseInt(date12hMatch[4] ?? "0", 10);
    const meridiem = date12hMatch[5]?.toLowerCase();
    if (meridiem === "pm" && hours < 12) hours += 12;
    if (meridiem === "am" && hours === 12) hours = 0;
    const hh = String(hours).padStart(2, "0");
    const mm = String(minutes).padStart(2, "0");
    const ss = String(seconds).padStart(2, "0");
    return fromZonedTime(`${datePart}T${hh}:${mm}:${ss}`, tz);
  }

  // If it already ends with Z or an explicit timezone offset (+HH:MM / -HH:MM), Date parses it directly
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed)) {
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // Otherwise interpret as a wall-clock time in `tz`
  try {
    const d = fromZonedTime(trimmed.replace(" ", "T"), tz);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? null : d;
  }
}

async function resolveOrg(
  userId: string,
  requestedOrg?: string,
): Promise<{ ok: true; org: OrgContext } | { ok: false; result: ToolResult }> {
  const client = await clerkClient();
  const memberships = await client.users.getOrganizationMembershipList({
    userId,
    limit: 100,
  });

  const list = memberships.data.map((m) => ({
    orgId: m.organization.id,
    orgName: m.organization.name,
    orgSlug: m.organization.slug ?? null,
    role: m.role,
    isAdmin: m.role === "org:admin",
    membersCount: m.organization.membersCount ?? undefined,
  }));

  if (list.length === 0) {
    return {
      ok: false,
      result: {
        summary:
          "You don't belong to any organization in Clock Out yet. Create or join an organization on https://clockout.patmac.ca first.",
        data: { status: "no_organizations", organizations: [] },
        isError: true,
      },
    };
  }

  if (requestedOrg?.trim()) {
    const needle = requestedOrg.trim().toLowerCase();
    const matched = list.find(
      (o) =>
        o.orgId.toLowerCase() === needle ||
        o.orgSlug?.toLowerCase() === needle ||
        o.orgName.toLowerCase() === needle ||
        o.orgName.toLowerCase().includes(needle),
    );
    if (!matched) {
      return {
        ok: false,
        result: {
          summary: `No organization matching "${requestedOrg}" was found for your account. Available organizations: ${list.map((o) => `${o.orgName} (${o.orgId})`).join(", ")}.`,
          data: {
            status: "organization_not_found",
            requested_org: requestedOrg,
            organizations: list,
          },
          isError: true,
        },
      };
    }
    return { ok: true, org: matched };
  }

  if (list.length === 1 && list[0]) {
    return { ok: true, org: list[0] };
  }

  return {
    ok: false,
    result: {
      summary: `You belong to ${list.length} organizations (${list.map((o) => `${o.orgName} [${o.role}]`).join(", ")}). Please specify which organization to use with org_id.`,
      data: {
        status: "multiple_organizations",
        organizations: list,
      },
    },
  };
}

async function fetchOrgMembers(orgId: string): Promise<OrgMemberInfo[]> {
  const client = await clerkClient();
  const { data } = await client.organizations.getOrganizationMembershipList({
    organizationId: orgId,
    limit: 100,
  });

  return data
    .map((m) => {
      const u = m.publicUserData;
      const userId = u?.userId || "";
      const firstName = u?.firstName ?? null;
      const lastName = u?.lastName ?? null;
      const email = u?.identifier ?? null;
      const fullName = firstName
        ? `${firstName} ${lastName || ""}`.trim()
        : email || userId || "Unknown Member";
      return {
        userId,
        name: fullName,
        firstName,
        lastName,
        email,
        role: m.role,
        isAdmin: m.role === "org:admin",
      };
    })
    .filter((m) => m.userId.length > 0);
}

function resolveMemberFromList(
  members: OrgMemberInfo[],
  callerUserId: string,
  callerIsAdmin: boolean,
  requestedMember?: string,
): { ok: true; member: OrgMemberInfo } | { ok: false; result: ToolResult } {
  const selfMember = members.find((m) => m.userId === callerUserId) ?? {
    userId: callerUserId,
    name: "You",
    firstName: null,
    lastName: null,
    email: null,
    role: callerIsAdmin ? "org:admin" : "org:member",
    isAdmin: callerIsAdmin,
  };

  if (!requestedMember?.trim()) {
    return { ok: true, member: selfMember };
  }

  const needle = requestedMember.trim().toLowerCase();
  if (
    needle === "me" ||
    needle === "self" ||
    needle === callerUserId.toLowerCase()
  ) {
    return { ok: true, member: selfMember };
  }

  // Exact match by userId, email, or full name
  const exact = members.filter(
    (m) =>
      m.userId.toLowerCase() === needle ||
      m.email?.toLowerCase() === needle ||
      m.name.toLowerCase() === needle,
  );
  if (exact.length === 1 && exact[0]) {
    if (exact[0].userId !== callerUserId && !callerIsAdmin) {
      return {
        ok: false,
        result: {
          summary:
            "Only organization admins (org:admin) can view or manage other members' hours.",
          data: { status: "forbidden" },
          isError: true,
        },
      };
    }
    return { ok: true, member: exact[0] };
  }

  // Partial / first-name match
  const partial = members.filter(
    (m) =>
      m.firstName?.toLowerCase() === needle ||
      m.lastName?.toLowerCase() === needle ||
      m.name.toLowerCase().includes(needle) ||
      m.email?.toLowerCase().includes(needle),
  );

  if (partial.length === 1 && partial[0]) {
    if (partial[0].userId !== callerUserId && !callerIsAdmin) {
      return {
        ok: false,
        result: {
          summary:
            "Only organization admins (org:admin) can view or manage other members' hours.",
          data: { status: "forbidden" },
          isError: true,
        },
      };
    }
    return { ok: true, member: partial[0] };
  }

  if (partial.length > 1) {
    return {
      ok: false,
      result: {
        summary: `Multiple members matched "${requestedMember}": ${partial.map((m) => `${m.name} (${m.email ?? m.userId})`).join(", ")}. Please specify their full name, email, or user_id.`,
        data: {
          status: "ambiguous_member",
          matches: partial,
        },
        isError: true,
      },
    };
  }

  return {
    ok: false,
    result: {
      summary: `No member matching "${requestedMember}" was found in this organization. Available members: ${members.map((m) => `${m.name} (${m.userId})`).join(", ")}.`,
      data: {
        status: "member_not_found",
        requested_member: requestedMember,
        members,
      },
      isError: true,
    },
  };
}

function formatEntryForResponse(
  entry: TimeEntry,
  memberMap: Map<string, OrgMemberInfo>,
  tz: string,
) {
  const clockInDate = new Date(entry.clock_in);
  const clockOutDate = entry.clock_out ? new Date(entry.clock_out) : null;
  const durationMs =
    (clockOutDate ? clockOutDate.getTime() : Date.now()) -
    clockInDate.getTime();
  const dur = formatDurationMs(durationMs);
  const member = memberMap.get(entry.user_id);

  return {
    id: entry.id,
    user_id: entry.user_id,
    member_name: member?.name ?? entry.user_id,
    member_email: member?.email ?? null,
    org_id: entry.org_id,
    date: formatInTimeZone(clockInDate, tz, "yyyy-MM-dd"),
    day_of_week: formatInTimeZone(clockInDate, tz, "EEEE"),
    clock_in: clockInDate.toISOString(),
    clock_in_local: formatTimestampInTz(clockInDate, tz),
    clock_out: clockOutDate ? clockOutDate.toISOString() : null,
    clock_out_local: clockOutDate
      ? formatTimestampInTz(clockOutDate, tz)
      : null,
    is_active: clockOutDate === null,
    duration_minutes: dur.totalMinutes,
    duration_hours: dur.decimalHours,
    formatted_duration: dur.formatted,
  };
}

/*
 * ============================================================================
 * Tool Implementations
 * ============================================================================
 */

export async function listOrganizations(
  caller: McpCaller,
): Promise<ToolResult> {
  const client = await clerkClient();
  const memberships = await client.users.getOrganizationMembershipList({
    userId: caller.userId,
    limit: 100,
  });

  const organizations = memberships.data.map((m) => ({
    org_id: m.organization.id,
    name: m.organization.name,
    slug: m.organization.slug ?? null,
    role: m.role,
    is_admin: m.role === "org:admin",
    members_count: m.organization.membersCount ?? null,
    max_allowed_memberships: m.organization.maxAllowedMemberships ?? null,
  }));

  if (organizations.length === 0) {
    return {
      summary: "You are not a member of any organization in Clock Out.",
      data: { organizations: [], default_org_id: null },
    };
  }

  const defaultOrg = organizations.length === 1 ? organizations[0] : null;
  return {
    summary:
      organizations.length === 1 && defaultOrg
        ? `You belong to 1 organization: ${defaultOrg.name} (${defaultOrg.org_id}) as ${defaultOrg.is_admin ? "an admin" : "a member"}. It will be used automatically.`
        : `You belong to ${organizations.length} organizations: ${organizations.map((o) => `${o.name} (${o.org_id}, ${o.is_admin ? "admin" : "member"})`).join("; ")}.`,
    data: {
      organizations,
      default_org_id: defaultOrg?.org_id ?? null,
    },
  };
}

export async function listMembers(
  caller: McpCaller,
  input: z.infer<typeof listMembersInputSchema>,
): Promise<ToolResult> {
  const orgRes = await resolveOrg(caller.userId, input.org_id);
  if (!orgRes.ok) return orgRes.result;
  const { org } = orgRes;

  const [members, activeEntries] = await Promise.all([
    fetchOrgMembers(org.orgId),
    dbGetOrgActiveEntries(org.orgId),
  ]);

  const activeByUser = new Map<string, TimeEntry>();
  for (const entry of activeEntries) {
    activeByUser.set(entry.user_id, entry);
  }

  const enriched = members.map((m) => {
    const active = activeByUser.get(m.userId);
    const activeDuration = active
      ? formatDurationMs(Date.now() - new Date(active.clock_in).getTime())
      : null;
    return {
      user_id: m.userId,
      name: m.name,
      email: org.isAdmin || m.userId === caller.userId ? m.email : null,
      role: m.role,
      is_admin: m.isAdmin,
      is_self: m.userId === caller.userId,
      is_working: Boolean(active),
      active_entry_id: active?.id ?? null,
      clocked_in_at: active ? new Date(active.clock_in).toISOString() : null,
      active_duration: activeDuration?.formatted ?? null,
    };
  });

  return {
    summary: `${org.orgName} has ${enriched.length} member${enriched.length === 1 ? "" : "s"} (${activeEntries.length} currently working).`,
    data: {
      organization: {
        org_id: org.orgId,
        name: org.orgName,
        caller_role: org.role,
        caller_is_admin: org.isAdmin,
      },
      members: enriched,
    },
  };
}

export async function whoIsWorking(
  caller: McpCaller,
  input: z.infer<typeof whoIsWorkingInputSchema>,
): Promise<ToolResult> {
  const orgRes = await resolveOrg(caller.userId, input.org_id);
  if (!orgRes.ok) return orgRes.result;
  const { org } = orgRes;
  const tz = validTimezone(input.timezone);

  const [members, activeEntries] = await Promise.all([
    fetchOrgMembers(org.orgId),
    dbGetOrgActiveEntries(org.orgId),
  ]);

  const memberMap = new Map(members.map((m) => [m.userId, m]));
  const workingUserIds = new Set<string>();

  const currentlyWorking = activeEntries.map((entry) => {
    workingUserIds.add(entry.user_id);
    const clockInDate = new Date(entry.clock_in);
    const dur = formatDurationMs(Date.now() - clockInDate.getTime());
    const member = memberMap.get(entry.user_id);
    return {
      entry_id: entry.id,
      user_id: entry.user_id,
      name: member?.name ?? entry.user_id,
      email:
        org.isAdmin || entry.user_id === caller.userId
          ? (member?.email ?? null)
          : null,
      role: member?.role ?? "org:member",
      clock_in: clockInDate.toISOString(),
      clock_in_local: formatTimestampInTz(clockInDate, tz),
      elapsed_minutes: dur.totalMinutes,
      elapsed_hours: dur.decimalHours,
      formatted_duration: dur.formatted,
    };
  });

  const clockedOutMembers = members
    .filter((m) => !workingUserIds.has(m.userId))
    .map((m) => ({
      user_id: m.userId,
      name: m.name,
      role: m.role,
    }));

  const summary =
    currentlyWorking.length === 0
      ? `Nobody is currently clocked in at ${org.orgName}.`
      : `${currentlyWorking.length} member${currentlyWorking.length === 1 ? " is" : "s are"} currently working at ${org.orgName}: ${currentlyWorking.map((w) => `${w.name} (${w.formatted_duration}, since ${w.clock_in_local})`).join(", ")}.`;

  return {
    summary,
    data: {
      organization: { org_id: org.orgId, name: org.orgName },
      timezone: tz,
      working_count: currentlyWorking.length,
      currently_working: currentlyWorking,
      clocked_out_members: clockedOutMembers,
    },
  };
}

export async function getClockStatus(
  caller: McpCaller,
  input: z.infer<typeof getClockStatusInputSchema>,
): Promise<ToolResult> {
  const orgRes = await resolveOrg(caller.userId, input.org_id);
  if (!orgRes.ok) return orgRes.result;
  const { org } = orgRes;
  const tz = validTimezone(input.timezone);

  const members = await fetchOrgMembers(org.orgId);
  const memberRes = resolveMemberFromList(
    members,
    caller.userId,
    org.isAdmin,
    input.member,
  );
  if (!memberRes.ok) return memberRes.result;
  const target = memberRes.member;

  const active = await dbGetActiveEntry(target.userId, org.orgId);
  if (!active) {
    return {
      summary: `${target.name} is currently clocked out in ${org.orgName}.`,
      data: {
        organization: { org_id: org.orgId, name: org.orgName },
        member: {
          user_id: target.userId,
          name: target.name,
          role: target.role,
        },
        is_clocked_in: false,
        active_entry: null,
      },
    };
  }

  const clockInDate = new Date(active.clock_in);
  const dur = formatDurationMs(Date.now() - clockInDate.getTime());

  return {
    summary: `${target.name} is clocked in at ${org.orgName} (for ${dur.formatted}, since ${formatTimestampInTz(clockInDate, tz)}).`,
    data: {
      organization: { org_id: org.orgId, name: org.orgName },
      member: { user_id: target.userId, name: target.name, role: target.role },
      is_clocked_in: true,
      active_entry: {
        entry_id: active.id,
        clock_in: clockInDate.toISOString(),
        clock_in_local: formatTimestampInTz(clockInDate, tz),
        elapsed_minutes: dur.totalMinutes,
        elapsed_hours: dur.decimalHours,
        formatted_duration: dur.formatted,
      },
    },
  };
}

export async function clockInTool(
  caller: McpCaller,
  input: z.infer<typeof clockInInputSchema>,
): Promise<ToolResult> {
  const orgRes = await resolveOrg(caller.userId, input.org_id);
  if (!orgRes.ok) return orgRes.result;
  const { org } = orgRes;
  const tz = validTimezone(input.timezone);

  const members = await fetchOrgMembers(org.orgId);
  const memberRes = resolveMemberFromList(
    members,
    caller.userId,
    org.isAdmin,
    input.member,
  );
  if (!memberRes.ok) return memberRes.result;
  const target = memberRes.member;

  const [overLimit, existingActive] = await Promise.all([
    isOverMemberShipLimit(org.orgId),
    dbGetActiveEntry(target.userId, org.orgId),
  ]);

  if (overLimit) {
    return {
      summary: `Cannot clock in: ${org.orgName} is over its organization membership limit.`,
      data: { status: "over_membership_limit", org_id: org.orgId },
      isError: true,
    };
  }

  if (existingActive) {
    const since = formatTimestampInTz(new Date(existingActive.clock_in), tz);
    const dur = formatDurationMs(
      Date.now() - new Date(existingActive.clock_in).getTime(),
    );
    return {
      summary: `${target.name} is already clocked in since ${since} (${dur.formatted}). Clock out first before starting a new shift.`,
      data: {
        status: "already_clocked_in",
        active_entry_id: existingActive.id,
        clock_in: new Date(existingActive.clock_in).toISOString(),
        clock_in_local: since,
      },
      isError: true,
    };
  }

  let customClockIn: Date | undefined;
  if (input.clock_in) {
    const parsed = parseFlexibleDateTime(input.clock_in, tz);
    if (!parsed) {
      return {
        summary: `Could not parse clock_in time "${input.clock_in}". Use ISO 8601 or 'YYYY-MM-DD HH:mm'.`,
        data: { status: "invalid_clock_in", clock_in: input.clock_in },
        isError: true,
      };
    }
    const overlaps = await dbFindOverlappingTimeEntries(
      target.userId,
      org.orgId,
      parsed,
      new Date(),
    );
    if (overlaps.length > 0) {
      return {
        summary: `Cannot clock in at ${formatTimestampInTz(parsed, tz)} because it overlaps with an existing shift (entry #${overlaps[0]?.id}).`,
        data: {
          status: "overlapping_shift",
          overlapping_entries: overlaps,
        },
        isError: true,
      };
    }
    customClockIn = parsed;
  }

  const entry = await dbClockInAt(target.userId, org.orgId, customClockIn);
  if (!entry) {
    return {
      summary: `${target.name} is already clocked in.`,
      data: { status: "already_clocked_in" },
      isError: true,
    };
  }
  invalidateTimeEntryCache(target.userId, org.orgId);

  const memberMap = new Map(members.map((m) => [m.userId, m]));
  const formatted = formatEntryForResponse(entry, memberMap, tz);

  return {
    summary: `Clocked in ${target.name} at ${org.orgName} (${formatted.clock_in_local}).`,
    data: {
      status: "clocked_in",
      organization: { org_id: org.orgId, name: org.orgName },
      entry: formatted,
    },
  };
}

export async function clockOutTool(
  caller: McpCaller,
  input: z.infer<typeof clockOutInputSchema>,
): Promise<ToolResult> {
  const orgRes = await resolveOrg(caller.userId, input.org_id);
  if (!orgRes.ok) return orgRes.result;
  const { org } = orgRes;
  const tz = validTimezone(input.timezone);

  const members = await fetchOrgMembers(org.orgId);
  const memberRes = resolveMemberFromList(
    members,
    caller.userId,
    org.isAdmin,
    input.member,
  );
  if (!memberRes.ok) return memberRes.result;
  const target = memberRes.member;

  const active = await dbGetActiveEntry(target.userId, org.orgId);
  if (!active) {
    return {
      summary: `${target.name} does not have an active clock-in shift to clock out from in ${org.orgName}.`,
      data: {
        status: "not_clocked_in",
        member: { user_id: target.userId, name: target.name },
      },
      isError: true,
    };
  }

  let customClockOut: Date | undefined;
  if (input.clock_out) {
    const activeDateStr = formatInTimeZone(
      new Date(active.clock_in),
      tz,
      "yyyy-MM-dd",
    );
    const parsed = parseFlexibleDateTime(input.clock_out, tz, activeDateStr);
    if (!parsed) {
      return {
        summary: `Could not parse clock_out time "${input.clock_out}". Use ISO 8601 or 'YYYY-MM-DD HH:mm'.`,
        data: { status: "invalid_clock_out", clock_out: input.clock_out },
        isError: true,
      };
    }
    if (parsed.getTime() <= new Date(active.clock_in).getTime()) {
      return {
        summary: `Clock-out time (${formatTimestampInTz(parsed, tz)}) must be after the shift's clock-in time (${formatTimestampInTz(new Date(active.clock_in), tz)}).`,
        data: { status: "invalid_time_range" },
        isError: true,
      };
    }
    const overlaps = await dbFindOverlappingTimeEntries(
      target.userId,
      org.orgId,
      new Date(active.clock_in),
      parsed,
      active.id,
    );
    if (overlaps.length > 0) {
      return {
        summary: `Cannot clock out at ${formatTimestampInTz(parsed, tz)} because it overlaps with another shift (entry #${overlaps[0]?.id}).`,
        data: {
          status: "overlapping_shift",
          overlapping_entries: overlaps,
        },
        isError: true,
      };
    }
    customClockOut = parsed;
  }

  const updated = await dbClockOutAt(target.userId, org.orgId, customClockOut);
  if (!updated) {
    return {
      summary: `Could not clock out ${target.name}.`,
      data: { status: "clock_out_failed" },
      isError: true,
    };
  }

  invalidateTimeEntryCache(target.userId, org.orgId);

  const memberMap = new Map(members.map((m) => [m.userId, m]));
  const formatted = formatEntryForResponse(updated, memberMap, tz);

  return {
    summary: `Clocked out ${target.name} at ${org.orgName} (${formatted.formatted_duration} worked: ${formatted.clock_in_local} → ${formatted.clock_out_local}).`,
    data: {
      status: "clocked_out",
      organization: { org_id: org.orgId, name: org.orgName },
      entry: formatted,
    },
  };
}

export async function addTimeEntryTool(
  caller: McpCaller,
  input: z.infer<typeof addTimeEntryInputSchema>,
): Promise<ToolResult> {
  const orgRes = await resolveOrg(caller.userId, input.org_id);
  if (!orgRes.ok) return orgRes.result;
  const { org } = orgRes;
  const tz = validTimezone(input.timezone);

  const rawItems =
    input.entries && input.entries.length > 0
      ? input.entries
      : [
          {
            member: input.member,
            date: input.date,
            clock_in: input.clock_in,
            clock_out: input.clock_out,
            hours_worked: input.hours_worked,
          },
        ];

  const members = await fetchOrgMembers(org.orgId);
  const memberMap = new Map(members.map((m) => [m.userId, m]));

  type ResolvedShift = {
    target: OrgMemberInfo;
    clockIn: Date;
    clockOut: Date | null;
  };

  const resolvedShifts: ResolvedShift[] = [];

  for (let i = 0; i < rawItems.length; i++) {
    const item = rawItems[i];
    if (!item) continue;

    const memberRes = resolveMemberFromList(
      members,
      caller.userId,
      org.isAdmin,
      item.member ?? input.member,
    );
    if (!memberRes.ok) return memberRes.result;
    const target = memberRes.member;

    let clockIn: Date | null = null;
    let clockOut: Date | null = null;

    if (item.clock_in) {
      clockIn = parseFlexibleDateTime(item.clock_in, tz, item.date);
      if (!clockIn) {
        return {
          summary: `Shift #${i + 1}: could not parse clock_in "${item.clock_in}".`,
          data: { status: "invalid_clock_in", index: i, item },
          isError: true,
        };
      }
    } else if (item.date && item.hours_worked) {
      // Default start at 09:00 local time on `item.date` when a paper timecard only lists date + hours
      clockIn = parseFlexibleDateTime("09:00", tz, item.date);
    }

    if (!clockIn) {
      return {
        summary: `Shift #${i + 1}: provide clock_in (or date + hours_worked).`,
        data: { status: "missing_clock_in", index: i, item },
        isError: true,
      };
    }

    const baseDateForOut =
      item.date || formatInTimeZone(clockIn, tz, "yyyy-MM-dd");

    if (item.clock_out !== undefined && item.clock_out !== null) {
      clockOut = parseFlexibleDateTime(item.clock_out, tz, baseDateForOut);
      if (!clockOut) {
        return {
          summary: `Shift #${i + 1}: could not parse clock_out "${item.clock_out}".`,
          data: { status: "invalid_clock_out", index: i, item },
          isError: true,
        };
      }
    } else if (item.hours_worked !== undefined) {
      clockOut = new Date(
        clockIn.getTime() + Math.round(item.hours_worked * 60 * 60 * 1000),
      );
    }

    if (clockOut && clockOut.getTime() <= clockIn.getTime()) {
      return {
        summary: `Shift #${i + 1} (${target.name}): clock_out (${formatTimestampInTz(clockOut, tz)}) must be after clock_in (${formatTimestampInTz(clockIn, tz)}).`,
        data: { status: "invalid_time_range", index: i, item },
        isError: true,
      };
    }

    resolvedShifts.push({ target, clockIn, clockOut });
  }

  // 1. Check for double / overlapping times within the submitted batch itself
  for (let i = 0; i < resolvedShifts.length; i++) {
    const a = resolvedShifts[i];
    if (!a) continue;
    const aEnd = a.clockOut ?? new Date();
    for (let j = i + 1; j < resolvedShifts.length; j++) {
      const b = resolvedShifts[j];
      if (!b || a.target.userId !== b.target.userId) continue;
      const bEnd = b.clockOut ?? new Date();
      if (a.clockIn < bEnd && aEnd > b.clockIn) {
        return {
          summary: `Cannot add double/overlapping shifts in the same request for ${a.target.name}: Shift #${i + 1} (${formatTimestampInTz(a.clockIn, tz)} → ${formatTimestampInTz(a.clockOut, tz) ?? "active"}) overlaps with Shift #${j + 1} (${formatTimestampInTz(b.clockIn, tz)} → ${formatTimestampInTz(b.clockOut, tz) ?? "active"}).`,
          data: {
            status: "duplicate_or_overlapping_in_batch",
            first_index: i,
            second_index: j,
          },
          isError: true,
        };
      }
    }
  }

  // 2. Check every shift against the database so we NEVER insert double or overlapping times
  const conflicts: {
    shift_index: number;
    member_name: string;
    proposed_clock_in: string | null;
    proposed_clock_out: string | null;
    existing_entries: ReturnType<typeof formatEntryForResponse>[];
  }[] = [];

  for (let i = 0; i < resolvedShifts.length; i++) {
    const s = resolvedShifts[i];
    if (!s) continue;
    const overlapping = await dbFindOverlappingTimeEntries(
      s.target.userId,
      org.orgId,
      s.clockIn,
      s.clockOut,
    );
    if (overlapping.length > 0) {
      conflicts.push({
        shift_index: i,
        member_name: s.target.name,
        proposed_clock_in: formatTimestampInTz(s.clockIn, tz),
        proposed_clock_out: formatTimestampInTz(s.clockOut, tz),
        existing_entries: overlapping.map((e) =>
          formatEntryForResponse(e, memberMap, tz),
        ),
      });
    }
  }

  if (conflicts.length > 0) {
    const first = conflicts[0];
    const existingIds = conflicts
      .flatMap((c) =>
        c.existing_entries.map(
          (e) =>
            `#${e.id} (${e.clock_in_local} → ${e.clock_out_local ?? "active"})`,
        ),
      )
      .join(", ");
    return {
      summary: `Rejected to prevent double/overlapping times: ${conflicts.length} proposed shift${conflicts.length === 1 ? "" : "s"} for ${first?.member_name} overlap${conflicts.length === 1 ? "s" : ""} with existing entry ${existingIds}. Nothing was saved. Use update_time_entry if you want to change the existing shift's hours.`,
      data: {
        status: "overlapping_existing_entries",
        conflicts,
      },
      isError: true,
    };
  }

  // 3. Insert all shifts and invalidate caches
  const createdEntries = [];
  const touchedUsers = new Set<string>();

  for (const s of resolvedShifts) {
    const inserted = await dbInsertTimeEntry(
      s.target.userId,
      org.orgId,
      s.clockIn,
      s.clockOut,
    );
    touchedUsers.add(s.target.userId);
    createdEntries.push(formatEntryForResponse(inserted, memberMap, tz));
  }

  for (const uid of touchedUsers) {
    invalidateTimeEntryCache(uid, org.orgId);
  }

  const totalMinutes = createdEntries.reduce(
    (sum, e) => sum + e.duration_minutes,
    0,
  );
  const totalDur = formatDurationMs(totalMinutes * 60 * 1000);

  return {
    summary:
      createdEntries.length === 1 && createdEntries[0]
        ? `Added shift #${createdEntries[0].id} for ${createdEntries[0].member_name} on ${createdEntries[0].date} (${createdEntries[0].formatted_duration}: ${createdEntries[0].clock_in_local} → ${createdEntries[0].clock_out_local ?? "active"}).`
        : `Added ${createdEntries.length} shifts (${totalDur.formatted} total) in ${org.orgName}.`,
    data: {
      status: "added",
      organization: { org_id: org.orgId, name: org.orgName },
      count: createdEntries.length,
      total_hours: totalDur.decimalHours,
      formatted_total: totalDur.formatted,
      entries: createdEntries,
    },
  };
}

export async function listTimeEntriesTool(
  caller: McpCaller,
  input: z.infer<typeof listTimeEntriesInputSchema>,
): Promise<ToolResult> {
  const orgRes = await resolveOrg(caller.userId, input.org_id);
  if (!orgRes.ok) return orgRes.result;
  const { org } = orgRes;
  const tz = validTimezone(input.timezone);

  const members = await fetchOrgMembers(org.orgId);
  const memberMap = new Map(members.map((m) => [m.userId, m]));

  const nowZoned = toZonedTime(new Date(), tz);
  const defaultStartStr = format(subDays(nowZoned, 7), "yyyy-MM-dd");
  const defaultEndStr = format(nowZoned, "yyyy-MM-dd");

  const startStr = input.start_date?.trim() || defaultStartStr;
  const endStr = input.end_date?.trim() || defaultEndStr;

  const startDate =
    startStr.length === 10
      ? fromZonedTime(`${startStr}T00:00:00.000`, tz)
      : (parseFlexibleDateTime(startStr, tz) ??
        fromZonedTime(`${defaultStartStr}T00:00:00.000`, tz));
  const endDate =
    endStr.length === 10
      ? fromZonedTime(`${endStr}T23:59:59.999`, tz)
      : (parseFlexibleDateTime(endStr, tz) ??
        fromZonedTime(`${defaultEndStr}T23:59:59.999`, tz));

  const wantsAll = input.member?.trim().toLowerCase() === "all";
  let entries: TimeEntry[];
  let targetLabel: string;

  if (wantsAll) {
    if (!org.isAdmin) {
      return {
        summary:
          "Only organization admins (org:admin) can list time entries for all members.",
        data: { status: "forbidden" },
        isError: true,
      };
    }
    entries = await dbGetOrgTimeEntries(org.orgId, startDate, endDate);
    targetLabel = `all members in ${org.orgName}`;
  } else {
    const memberRes = resolveMemberFromList(
      members,
      caller.userId,
      org.isAdmin,
      input.member,
    );
    if (!memberRes.ok) return memberRes.result;
    entries = await dbGetTimeEntries(
      memberRes.member.userId,
      org.orgId,
      startDate,
      endDate,
    );
    targetLabel = memberRes.member.name;
  }

  const formatted = entries.map((e) =>
    formatEntryForResponse(e, memberMap, tz),
  );
  const totalMinutes = formatted.reduce(
    (sum, e) => sum + e.duration_minutes,
    0,
  );
  const totalDur = formatDurationMs(totalMinutes * 60 * 1000);

  return {
    summary: `Found ${formatted.length} time entr${formatted.length === 1 ? "y" : "ies"} (${totalDur.formatted} total) for ${targetLabel} from ${startStr} to ${endStr}.`,
    data: {
      organization: { org_id: org.orgId, name: org.orgName },
      period: { start: startStr, end: endStr, timezone: tz },
      count: formatted.length,
      total_hours: totalDur.decimalHours,
      formatted_total: totalDur.formatted,
      entries: formatted,
    },
  };
}

export async function getWeeklyTimecardTool(
  caller: McpCaller,
  input: z.infer<typeof getWeeklyTimecardInputSchema>,
): Promise<ToolResult> {
  const orgRes = await resolveOrg(caller.userId, input.org_id);
  if (!orgRes.ok) return orgRes.result;
  const { org } = orgRes;
  const tz = validTimezone(input.timezone);

  const members = await fetchOrgMembers(org.orgId);
  const memberMap = new Map(members.map((m) => [m.userId, m]));

  // Determine period startDate and endDate
  let startDate: Date;
  let endDate: Date;
  let periodLabel: string;

  if (input.start_date && input.end_date) {
    startDate = fromZonedTime(
      `${input.start_date.slice(0, 10)}T00:00:00.000`,
      tz,
    );
    endDate = fromZonedTime(`${input.end_date.slice(0, 10)}T23:59:59.999`, tz);
    periodLabel = `${input.start_date.slice(0, 10)} to ${input.end_date.slice(0, 10)}`;
  } else if (input.year && input.month && input.week) {
    const monthIndex = input.month - 1;
    const baseDate = new Date(input.year, monthIndex, 1);
    const startDay = (input.week - 1) * 7 + 1;
    const endDayDate =
      input.week === 4
        ? endOfMonth(baseDate)
        : endOfDay(new Date(input.year, monthIndex, input.week * 7));
    const startStr = format(
      new Date(input.year, monthIndex, startDay),
      "yyyy-MM-dd",
    );
    const endStr = format(endDayDate, "yyyy-MM-dd");
    startDate = fromZonedTime(`${startStr}T00:00:00.000`, tz);
    endDate = fromZonedTime(`${endStr}T23:59:59.999`, tz);
    periodLabel = `Week ${input.week} of ${format(baseDate, "MMMM yyyy")} (${startStr} to ${endStr})`;
  } else {
    const refDate = input.week_of
      ? fromZonedTime(`${input.week_of.slice(0, 10)}T12:00:00`, tz)
      : new Date();
    const zonedRef = toZonedTime(refDate, tz);
    const weekStartZoned = startOfWeek(zonedRef, { weekStartsOn: 1 });
    const weekEndZoned = endOfWeek(zonedRef, { weekStartsOn: 1 });
    const startStr = format(weekStartZoned, "yyyy-MM-dd");
    const endStr = format(weekEndZoned, "yyyy-MM-dd");
    startDate = fromZonedTime(`${startStr}T00:00:00.000`, tz);
    endDate = fromZonedTime(`${endStr}T23:59:59.999`, tz);
    periodLabel = `${startStr} to ${endStr}`;
  }

  const requestedMember = input.member?.trim();
  const wantsAll =
    requestedMember?.toLowerCase() === "all" ||
    (!requestedMember && org.isAdmin);

  let targetMembers: OrgMemberInfo[];
  let entries: TimeEntry[];

  if (wantsAll) {
    if (!org.isAdmin) {
      return {
        summary:
          "Only organization admins (org:admin) can view the weekly timecard for all members.",
        data: { status: "forbidden" },
        isError: true,
      };
    }
    targetMembers = members;
    entries = await dbGetOrgTimeEntries(org.orgId, startDate, endDate);
  } else {
    const memberRes = resolveMemberFromList(
      members,
      caller.userId,
      org.isAdmin,
      requestedMember,
    );
    if (!memberRes.ok) return memberRes.result;
    targetMembers = [memberRes.member];
    entries = await dbGetTimeEntries(
      memberRes.member.userId,
      org.orgId,
      startDate,
      endDate,
    );
  }

  // Group entries by member -> by day (YYYY-MM-DD in tz)
  const entriesByUser = new Map<string, TimeEntry[]>();
  for (const entry of entries) {
    const list = entriesByUser.get(entry.user_id) ?? [];
    list.push(entry);
    entriesByUser.set(entry.user_id, list);
  }

  let orgTotalMs = 0;
  const timecards = targetMembers.map((m) => {
    const userEntries = (entriesByUser.get(m.userId) ?? []).sort(
      (a, b) => new Date(a.clock_in).getTime() - new Date(b.clock_in).getTime(),
    );

    let memberTotalMs = 0;
    let activeShifts = 0;
    const daysMap = new Map<
      string,
      {
        date: string;
        day_of_week: string;
        rawMs: number;
        shifts: ReturnType<typeof formatEntryForResponse>[];
      }
    >();

    for (const entry of userEntries) {
      const formatted = formatEntryForResponse(entry, memberMap, tz);
      const inMs = new Date(entry.clock_in).getTime();
      const outMs = entry.clock_out
        ? new Date(entry.clock_out).getTime()
        : Date.now();
      const shiftMs = Math.max(0, outMs - inMs);
      memberTotalMs += shiftMs;
      if (!entry.clock_out) activeShifts += 1;

      const dayEntry = daysMap.get(formatted.date) ?? {
        date: formatted.date,
        day_of_week: formatted.day_of_week,
        rawMs: 0,
        shifts: [],
      };
      dayEntry.rawMs += shiftMs;
      dayEntry.shifts.push(formatted);
      daysMap.set(formatted.date, dayEntry);
    }

    orgTotalMs += memberTotalMs;
    const memberDur = formatDurationMs(memberTotalMs);

    const dailyBreakdown = Array.from(daysMap.values()).map((d) => {
      const dayDur = formatDurationMs(d.rawMs);
      return {
        date: d.date,
        day_of_week: d.day_of_week,
        total_hours: dayDur.decimalHours,
        formatted_total: dayDur.formatted,
        shifts: d.shifts,
      };
    });

    return {
      user_id: m.userId,
      name: m.name,
      email: org.isAdmin || m.userId === caller.userId ? m.email : null,
      role: m.role,
      total_hours: memberDur.decimalHours,
      total_minutes: memberDur.totalMinutes,
      formatted_total: memberDur.formatted,
      days_worked: dailyBreakdown.length,
      shifts_count: userEntries.length,
      active_shifts: activeShifts,
      daily_breakdown: dailyBreakdown,
    };
  });

  const orgTotalDur = formatDurationMs(orgTotalMs);

  const summary =
    timecards.length === 1 && timecards[0]
      ? `Weekly timecard for ${timecards[0].name} (${periodLabel}): ${timecards[0].formatted_total} across ${timecards[0].days_worked} day${timecards[0].days_worked === 1 ? "" : "s"} (${timecards[0].shifts_count} shift${timecards[0].shifts_count === 1 ? "" : "s"}).`
      : `Weekly timecard for ${org.orgName} (${periodLabel}): ${orgTotalDur.formatted} total across ${timecards.length} members (${timecards.map((t) => `${t.name}: ${t.formatted_total}`).join(", ")}).`;

  return {
    summary,
    data: {
      organization: { org_id: org.orgId, name: org.orgName },
      period: {
        label: periodLabel,
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        timezone: tz,
      },
      organization_total_hours: orgTotalDur.decimalHours,
      organization_formatted_total: orgTotalDur.formatted,
      timecards,
    },
  };
}

export async function updateTimeEntryTool(
  caller: McpCaller,
  input: z.infer<typeof updateTimeEntryInputSchema>,
): Promise<ToolResult> {
  const orgRes = await resolveOrg(caller.userId, input.org_id);
  if (!orgRes.ok) return orgRes.result;
  const { org } = orgRes;
  const tz = validTimezone(input.timezone);

  if (!org.isAdmin) {
    return {
      summary:
        "Only organization admins (org:admin) can modify existing time entries.",
      data: { status: "forbidden" },
      isError: true,
    };
  }

  const members = await fetchOrgMembers(org.orgId);
  const memberMap = new Map(members.map((m) => [m.userId, m]));

  let targetEntry: TimeEntry | null = null;

  if (input.entry_id !== undefined) {
    targetEntry = await dbGetTimeEntryById(input.entry_id, org.orgId);
    if (!targetEntry) {
      return {
        summary: `Time entry #${input.entry_id} was not found in ${org.orgName}.`,
        data: { status: "entry_not_found", entry_id: input.entry_id },
        isError: true,
      };
    }
  } else if (input.date) {
    const memberRes = resolveMemberFromList(
      members,
      caller.userId,
      org.isAdmin,
      input.member,
    );
    if (!memberRes.ok) return memberRes.result;
    const dayStart = fromZonedTime(
      `${input.date.slice(0, 10)}T00:00:00.000`,
      tz,
    );
    const dayEnd = fromZonedTime(`${input.date.slice(0, 10)}T23:59:59.999`, tz);
    const dayEntries = await dbGetTimeEntries(
      memberRes.member.userId,
      org.orgId,
      dayStart,
      dayEnd,
    );
    if (dayEntries.length === 0) {
      return {
        summary: `No time entry found for ${memberRes.member.name} on ${input.date}. Use add_time_entry to create one.`,
        data: { status: "entry_not_found", date: input.date },
        isError: true,
      };
    }
    if (dayEntries.length > 1) {
      return {
        summary: `${memberRes.member.name} has ${dayEntries.length} time entries on ${input.date} (${dayEntries.map((e) => `#${e.id}`).join(", ")}). Please specify entry_id.`,
        data: {
          status: "multiple_entries_on_date",
          entries: dayEntries.map((e) =>
            formatEntryForResponse(e, memberMap, tz),
          ),
        },
        isError: true,
      };
    }
    targetEntry = dayEntries[0] ?? null;
  } else {
    return {
      summary:
        "Provide entry_id (or member + date) to identify which time entry to update.",
      data: { status: "missing_identifier" },
      isError: true,
    };
  }

  if (!targetEntry) {
    return {
      summary: "Time entry not found.",
      data: { status: "entry_not_found" },
      isError: true,
    };
  }

  const baseDateStr =
    input.date?.slice(0, 10) ||
    formatInTimeZone(new Date(targetEntry.clock_in), tz, "yyyy-MM-dd");

  const newClockIn = input.clock_in
    ? parseFlexibleDateTime(input.clock_in, tz, baseDateStr)
    : new Date(targetEntry.clock_in);

  if (!newClockIn) {
    return {
      summary: `Could not parse clock_in "${input.clock_in}".`,
      data: { status: "invalid_clock_in" },
      isError: true,
    };
  }

  let newClockOut: Date | null;
  if (input.clock_out === null) {
    newClockOut = null;
  } else if (input.clock_out !== undefined) {
    newClockOut = parseFlexibleDateTime(input.clock_out, tz, baseDateStr);
    if (!newClockOut) {
      return {
        summary: `Could not parse clock_out "${input.clock_out}".`,
        data: { status: "invalid_clock_out" },
        isError: true,
      };
    }
  } else if (input.hours_worked !== undefined) {
    newClockOut = new Date(
      newClockIn.getTime() + Math.round(input.hours_worked * 60 * 60 * 1000),
    );
  } else {
    newClockOut = targetEntry.clock_out
      ? new Date(targetEntry.clock_out)
      : null;
  }

  if (newClockOut && newClockOut.getTime() <= newClockIn.getTime()) {
    return {
      summary: `Clock-out time (${formatTimestampInTz(newClockOut, tz)}) must be after clock-in time (${formatTimestampInTz(newClockIn, tz)}).`,
      data: { status: "invalid_time_range" },
      isError: true,
    };
  }

  // Prevent double / overlapping times when editing an existing entry
  const overlapping = await dbFindOverlappingTimeEntries(
    targetEntry.user_id,
    org.orgId,
    newClockIn,
    newClockOut,
    targetEntry.id,
  );
  if (overlapping.length > 0) {
    return {
      summary: `Rejected to prevent double/overlapping times: updated hours overlap with entry #${overlapping[0]?.id} (${formatTimestampInTz(new Date(overlapping[0]?.clock_in ?? Date.now()), tz)}).`,
      data: {
        status: "overlapping_existing_entries",
        overlapping_entries: overlapping.map((e) =>
          formatEntryForResponse(e, memberMap, tz),
        ),
      },
      isError: true,
    };
  }

  const updated = await dbUpdateTimeEntry(
    targetEntry.id,
    newClockIn,
    newClockOut,
    org.orgId,
    true,
  );

  if (!updated) {
    return {
      summary: `Failed to update time entry #${targetEntry.id}.`,
      data: { status: "update_failed" },
      isError: true,
    };
  }

  invalidateTimeEntryCache(updated.user_id, org.orgId);

  const beforeFormatted = formatEntryForResponse(targetEntry, memberMap, tz);
  const afterFormatted = formatEntryForResponse(updated, memberMap, tz);

  return {
    summary: `Updated time entry #${updated.id} for ${afterFormatted.member_name} on ${afterFormatted.date}: ${afterFormatted.clock_in_local} → ${afterFormatted.clock_out_local ?? "active"} (${afterFormatted.formatted_duration}).`,
    data: {
      status: "updated",
      organization: { org_id: org.orgId, name: org.orgName },
      before: beforeFormatted,
      entry: afterFormatted,
    },
  };
}

export async function deleteTimeEntryTool(
  caller: McpCaller,
  input: z.infer<typeof deleteTimeEntryInputSchema>,
): Promise<ToolResult> {
  const orgRes = await resolveOrg(caller.userId, input.org_id);
  if (!orgRes.ok) return orgRes.result;
  const { org } = orgRes;

  if (!org.isAdmin) {
    return {
      summary: "Only organization admins (org:admin) can delete time entries.",
      data: { status: "forbidden" },
      isError: true,
    };
  }

  const deleted = await dbDeleteTimeEntry(input.entry_id, org.orgId);
  if (!deleted) {
    return {
      summary: `Time entry #${input.entry_id} was not found in ${org.orgName}.`,
      data: { status: "entry_not_found", entry_id: input.entry_id },
      isError: true,
    };
  }

  invalidateTimeEntryCache(deleted.user_id, org.orgId);

  const members = await fetchOrgMembers(org.orgId);
  const memberMap = new Map(members.map((m) => [m.userId, m]));
  const formatted = formatEntryForResponse(
    deleted,
    memberMap,
    DEFAULT_TIMEZONE,
  );

  return {
    summary: `Deleted time entry #${deleted.id} for ${formatted.member_name} (${formatted.date}, ${formatted.formatted_duration}).`,
    data: {
      status: "deleted",
      organization: { org_id: org.orgId, name: org.orgName },
      deleted_entry: formatted,
    },
  };
}

export async function manageReportingSettingsTool(
  caller: McpCaller,
  input: z.infer<typeof manageReportingSettingsInputSchema>,
): Promise<ToolResult> {
  const orgRes = await resolveOrg(caller.userId, input.org_id);
  if (!orgRes.ok) return orgRes.result;
  const { org } = orgRes;

  const action = input.action ?? "get";

  if (action === "get") {
    const settings = await dbGetReportingSettings(org.orgId);
    return {
      summary: settings
        ? `Reporting settings for ${org.orgName}: frequency=${settings.report_frequency}, day=${settings.report_day ?? "default"}, interval=${settings.report_interval}.`
        : `No custom reporting settings saved yet for ${org.orgName} (defaults to weekly).`,
      data: {
        organization: { org_id: org.orgId, name: org.orgName },
        settings: settings ?? {
          org_id: org.orgId,
          report_frequency: "weekly",
          report_day: null,
          report_interval: 1,
        },
      },
    };
  }

  if (!org.isAdmin) {
    return {
      summary:
        "Only organization admins (org:admin) can update reporting settings or trigger weekly report emails.",
      data: { status: "forbidden" },
      isError: true,
    };
  }

  if (action === "send_test_report") {
    const endDate = new Date();
    const startDate = startOfDay(subDays(endDate, 7));
    const sent = await sendWeeklyReports(startDate, endDate, org.orgId);
    return {
      summary: sent
        ? `Sent the weekly hours report email for ${org.orgName} to organization admins.`
        : `Could not send the weekly report email (verify AWS SES credentials and reporting subscription feature).`,
      data: {
        status: sent ? "report_sent" : "report_skipped",
        organization: { org_id: org.orgId, name: org.orgName },
      },
    };
  }

  const frequency = input.report_frequency ?? "weekly";
  const day = frequency === "custom" ? (input.report_day ?? "Monday") : null;
  const interval = frequency === "custom" ? (input.report_interval ?? 1) : 1;

  const updated = await dbUpdateReportingSettings(
    org.orgId,
    frequency,
    day,
    interval,
  );
  invalidateReportingSettingsCache(org.orgId);

  return {
    summary: `Updated reporting settings for ${org.orgName}: frequency=${updated.report_frequency}${updated.report_day ? `, day=${updated.report_day}, interval=${updated.report_interval}w` : ""}.`,
    data: {
      status: "updated",
      organization: { org_id: org.orgId, name: org.orgName },
      settings: updated,
    },
  };
}
