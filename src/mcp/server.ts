import type { AuthInfo, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { MCP_INSTRUCTIONS } from "@/mcp/instructions";
import { portable } from "@/mcp/portable-schema";
import {
  addTimeEntryInputSchema,
  addTimeEntryTool,
  clockInInputSchema,
  clockInTool,
  clockOutInputSchema,
  clockOutTool,
  deleteTimeEntryInputSchema,
  deleteTimeEntryTool,
  exportTimesheetInputSchema,
  exportTimesheetTool,
  getClockStatus,
  getClockStatusInputSchema,
  getWeeklyTimecardInputSchema,
  getWeeklyTimecardTool,
  inviteMemberInputSchema,
  inviteMemberTool,
  listMembers,
  listMembersInputSchema,
  listOrganizations,
  listOrganizationsInputSchema,
  listTimeEntriesInputSchema,
  listTimeEntriesTool,
  type McpCaller,
  manageBreakSettingsInputSchema,
  manageBreakSettingsTool,
  manageBreaksInputSchema,
  manageBreaksTool,
  manageReportingSettingsInputSchema,
  manageReportingSettingsTool,
  runHoursReportInputSchema,
  runHoursReportTool,
  type ToolResult,
  toggleBreakInputSchema,
  toggleBreakTool,
  updateTimeEntryInputSchema,
  updateTimeEntryTool,
  whoIsWorking,
  whoIsWorkingInputSchema,
} from "@/mcp/tools";

/*
 * The Clock Out MCP server: its name, icons, instructions and tools. Standard
 * MCP only, with nothing specific to one AI app, so any MCP client (Claude,
 * Muse, Gemini, ChatGPT, ...) can use it.
 */

const APP_ORIGIN =
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") ||
  "https://clockout.patmac.ca";

export const SERVER_INFO = {
  name: "clock-out",
  title: "Clock Out",
  version: "1.0.0",
  websiteUrl: APP_ORIGIN,
  icons: [
    {
      src: `${APP_ORIGIN}/icon.svg`,
      mimeType: "image/svg+xml",
      sizes: ["any"],
    },
    {
      src: `${APP_ORIGIN}/favicon.ico`,
      mimeType: "image/x-icon",
      sizes: ["48x48"],
    },
  ],
};

export const SERVER_OPTIONS = {
  serverInfo: SERVER_INFO,
  instructions: MCP_INSTRUCTIONS,
  // The tool list never changes while a client is connected. Saying so keeps
  // clients from holding a `subscriptions/listen` stream open for change
  // notifications on serverless functions.
  capabilities: { tools: { listChanged: false } },
};

/** The verified caller from the request's auth, or null when there isn't one. */
export function callerFrom(
  authInfo: AuthInfo | undefined,
  clientName?: string | null,
): McpCaller | null {
  const userId = authInfo?.extra?.userId;
  if (typeof userId !== "string" || !userId) return null;
  const fromAuth = authInfo?.extra?.client;
  return {
    userId,
    client:
      clientName || (typeof fromAuth === "string" ? fromAuth : null) || null,
  };
}

const text = (value: string) => ({ type: "text" as const, text: value });

/** A tool's result as MCP content: the sentence first, then the data as JSON. */
function respond(result: ToolResult) {
  const attachedResources =
    result.resources ?? (result.resource ? [result.resource] : []);
  return {
    content: [
      text(result.summary),
      text(JSON.stringify(result.data, null, 2)),
      ...attachedResources.map((r) => ({
        type: "resource" as const,
        resource: r,
      })),
    ],
    structuredContent: result.data,
    ...(result.isError ? { isError: true } : {}),
  };
}

/** Runs a tool for the verified caller; bad input becomes a readable tool error. */
async function run(
  server: McpServer,
  authInfo: AuthInfo | undefined,
  tool: (caller: McpCaller) => ToolResult | Promise<ToolResult>,
) {
  const caller = callerFrom(
    authInfo,
    server.server.getClientVersion()?.name ?? null,
  );
  if (!caller) {
    return respond({
      summary:
        "Not signed in to Clock Out. Reconnect the connector and sign in.",
      data: {},
      isError: true,
    });
  }
  try {
    return respond(await tool(caller));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return respond({
        summary: `Invalid input: ${error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")}`,
        data: {},
        isError: true,
      });
    }
    console.error(error);
    return respond({
      summary: "Something went wrong in Clock Out. Try again shortly.",
      data: {},
      isError: true,
    });
  }
}

export function registerClockOutTools(server: McpServer) {
  server.registerTool(
    "list_organizations",
    {
      title: "List organizations",
      description:
        "Lists all organizations the signed-in user belongs to in Clock Out, with their org_id, name, slug, and role ('org:admin' or 'org:member'). If the user belongs to only one organization, all other tools use it automatically. If the user belongs to multiple organizations, call this to see them and pass org_id to target the right one.",
      inputSchema: portable(listOrganizationsInputSchema),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (_args, ctx) =>
      run(server, ctx.http?.authInfo, (caller) => listOrganizations(caller)),
  );

  server.registerTool(
    "list_members",
    {
      title: "List organization members",
      description:
        "Lists every member of the organization with their user_id, name, email (visible to admins), role ('org:admin' or 'org:member'), and whether they are currently clocked in. Call this when an admin wants to see their team or match a name from a timecard image.",
      inputSchema: portable(listMembersInputSchema),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args, ctx) =>
      run(server, ctx.http?.authInfo, (caller) => listMembers(caller, args)),
  );

  server.registerTool(
    "who_is_working",
    {
      title: "See who is currently working",
      description:
        "Shows everyone currently clocked in at the organization right now, when they started their shift, and how long they have been working (hours and minutes), plus the list of members who are currently clocked out.",
      inputSchema: portable(whoIsWorkingInputSchema),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args, ctx) =>
      run(server, ctx.http?.authInfo, (caller) => whoIsWorking(caller, args)),
  );

  server.registerTool(
    "get_clock_status",
    {
      title: "Check clock-in status",
      description:
        "Checks whether you (or a specific organization member by name, email, or user_id if you are an admin) are currently clocked in, when the active shift started, and how long it has been running.",
      inputSchema: portable(getClockStatusInputSchema),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args, ctx) =>
      run(server, ctx.http?.authInfo, (caller) => getClockStatus(caller, args)),
  );

  server.registerTool(
    "clock_in",
    {
      title: "Clock in",
      description:
        "Starts a live shift for yourself, or (when called by an org admin) clocks in any organization member by name, email, or user_id. Rejects the request if the person is already clocked in or if a custom clock_in time overlaps with an existing shift, and invalidates the cache immediately.",
      inputSchema: portable(clockInInputSchema),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    (args, ctx) =>
      run(server, ctx.http?.authInfo, (caller) => clockInTool(caller, args)),
  );

  server.registerTool(
    "clock_out",
    {
      title: "Clock out",
      description:
        "Ends the active shift for yourself, or (when called by an org admin) clocks out any organization member by name, email, or user_id. Optionally accepts a custom clock_out time, verifies there are no overlapping shifts, and invalidates the cache immediately.",
      inputSchema: portable(clockOutInputSchema),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    (args, ctx) =>
      run(server, ctx.http?.authInfo, (caller) => clockOutTool(caller, args)),
  );

  server.registerTool(
    "add_time_entry",
    {
      title: "Add time entry or import timecard shifts",
      description:
        "Adds one shift or a batch of shifts (entries array) for yourself or, if you are an org admin, for any member (by name, email, or user_id). Ideal when a user uploads a photo or screenshot of a weekly timecard or schedule: extract the employee name and each day's date + clock_in/clock_out (or date + hours_worked) and pass them in entries. Strictly rejects double or overlapping shifts (both within the batch and against existing database entries) so double times can never be created, and invalidates the cache.",
      inputSchema: portable(addTimeEntryInputSchema),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    (args, ctx) =>
      run(server, ctx.http?.authInfo, (caller) =>
        addTimeEntryTool(caller, args),
      ),
  );

  server.registerTool(
    "list_time_entries",
    {
      title: "List time entries",
      description:
        "Lists individual shifts with their entry id, member name, date, clock_in, clock_out, and duration between start_date and end_date (default: last 7 days). Admins can pass member: 'all' or a specific member's name/email/user_id. Call this before adding shifts from an image or before editing/deleting an entry.",
      inputSchema: portable(listTimeEntriesInputSchema),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args, ctx) =>
      run(server, ctx.http?.authInfo, (caller) =>
        listTimeEntriesTool(caller, args),
      ),
  );

  server.registerTool(
    "get_weekly_timecard",
    {
      title: "Get weekly timecard",
      description:
        "Returns a structured weekly timecard showing who worked, how many hours they worked in total, days worked, and a day-by-day breakdown of every shift. Admins see all organization members by default (or can filter by a member); regular members see their own timecard. Supports week_of (YYYY-MM-DD), start_date/end_date, or Clock Out's month-week selector (year, month, week 1–4).",
      inputSchema: portable(getWeeklyTimecardInputSchema),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args, ctx) =>
      run(server, ctx.http?.authInfo, (caller) =>
        getWeeklyTimecardTool(caller, args),
      ),
  );

  server.registerTool(
    "export_timesheet",
    {
      title: "Export timesheet as PDF and Excel spreadsheet",
      description:
        "Generates downloadable PDF, Excel (.xlsx) spreadsheet and flat CSV timesheets for any selected time period (start_date/end_date, week_of, full month via year+month, or Clock Out month-week 1–4 via year+month+week), with Day of Week, Daily Totals, Employee Summaries, and Weekly/Monthly section breakdowns (group_by: 'week' | 'month' | 'none' | 'auto'). Returns embedded PDF and Spreadsheet file resources plus Clerk-authenticated download links for the PDF, the Spreadsheet and the CSV (one flat row per shift, for payroll imports).",
      inputSchema: portable(exportTimesheetInputSchema),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args, ctx) =>
      run(server, ctx.http?.authInfo, (caller) =>
        exportTimesheetTool(caller, args),
      ),
  );

  server.registerTool(
    "toggle_break",
    {
      title: "Start, end, or toggle a live break",
      description:
        "Starts, ends, or toggles a live break on an active shift for yourself, or (when called by an org admin) for any organization member by name, email, or user_id. Supports all 3 break kinds: 'unpaid_meal' (Meal period — unpaid, deducted from hours; default), 'unpaid_rest' (Unpaid rest break — unpaid, deducted from hours), and 'paid_rest' (Paid rest break — paid, recorded for compliance and not deducted). Pass action: 'toggle' (default), 'start', or 'end'.",
      inputSchema: portable(toggleBreakInputSchema),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    (args, ctx) =>
      run(server, ctx.http?.authInfo, (caller) =>
        toggleBreakTool(caller, args),
      ),
  );

  server.registerTool(
    "manage_breaks",
    {
      title: "Add, edit, delete, or list breaks on a shift",
      description:
        "Manages recorded breaks of the 3 kinds — 'unpaid_meal' (Meal period, unpaid), 'unpaid_rest' (Unpaid rest break, unpaid), and 'paid_rest' (Paid rest break, paid) — on a time entry. Organization admins ('org:admin') can add a break to any shift (action: 'add', with break_type and break_start/break_end or duration_minutes), edit an existing break's type or times (action: 'update', by break_id or shift), or delete a break (action: 'delete', by break_id or shift). Anyone can list breaks on their shift (action: 'list') or start/end/toggle a live break on an active shift (action: 'start' | 'end' | 'toggle').",
      inputSchema: portable(manageBreaksInputSchema),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    (args, ctx) =>
      run(server, ctx.http?.authInfo, (caller) =>
        manageBreaksTool(caller, args),
      ),
  );

  server.registerTool(
    "update_time_entry",
    {
      title: "Change hours on an existing time entry",
      description:
        "Admin tool to change the clock_in, clock_out, hours_worked, or skip_lunch ('do not dock' break flag) of a shift that is already logged (for yourself or any member in the organization), identified by entry_id or by member + date. Strictly checks that the updated hours do not overlap with any other shift so double times cannot happen, and invalidates the cache. Only call when the user explicitly asks to change existing hours.",
      inputSchema: portable(updateTimeEntryInputSchema),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (args, ctx) =>
      run(server, ctx.http?.authInfo, (caller) =>
        updateTimeEntryTool(caller, args),
      ),
  );

  server.registerTool(
    "delete_time_entry",
    {
      title: "Delete a time entry",
      description:
        "Admin tool to permanently delete a time entry by entry_id for yourself or any member in the organization, invalidating the cache immediately. Only call when the user explicitly asks to delete a specific shift.",
      inputSchema: portable(deleteTimeEntryInputSchema),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (args, ctx) =>
      run(server, ctx.http?.authInfo, (caller) =>
        deleteTimeEntryTool(caller, args),
      ),
  );

  server.registerTool(
    "manage_reporting_settings",
    {
      title: "View or update organization reporting settings",
      description:
        "Views or updates the organization's automated email report schedule ('off', 'weekly', 'twice-monthly', or 'custom' weekday every 1 or 2 weeks) or sends a test weekly report email to organization admins. Anyone can view the settings; updating or sending reports is admin-only ('org:admin') and requires a plan that includes Reporting.",
      inputSchema: portable(manageReportingSettingsInputSchema),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (args, ctx) =>
      run(server, ctx.http?.authInfo, (caller) =>
        manageReportingSettingsTool(caller, args),
      ),
  );

  server.registerTool(
    "manage_break_settings",
    {
      title: "View or update lunch/break deduction settings",
      description:
        "Views or updates the organization's automatic lunch/break deduction: whether unpaid break time is docked (dock_lunch), how many minutes are deducted (lunch_duration_minutes), and the minimum shift length in hours before it applies (lunch_min_shift_hours). Unspecified fields keep their current values. Anyone can view the settings; updating is admin-only ('org:admin'). Available on every plan.",
      inputSchema: portable(manageBreakSettingsInputSchema),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (args, ctx) =>
      run(server, ctx.http?.authInfo, (caller) =>
        manageBreakSettingsTool(caller, args),
      ),
  );

  server.registerTool(
    "run_hours_report",
    {
      title: "Run an hours report for a date range",
      description:
        "Admin-only ('org:admin') tool for organizations whose plan includes Reporting. Gets net hours worked (after lunch/break deductions) for one member or everyone between start_date and end_date, with daily breakdowns and shifts. Works with or without a reporting schedule. Returns the report to you by default; deliver: 'email_admins' or 'both' also emails it to the organization's admins.",
      inputSchema: portable(runHoursReportInputSchema),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    (args, ctx) =>
      run(server, ctx.http?.authInfo, (caller) =>
        runHoursReportTool(caller, args),
      ),
  );

  server.registerTool(
    "invite_member",
    {
      title: "Invite users to the organization or manage pending invitations",
      description:
        "Admin tool ('org:admin') to invite one or more users by email to join the Clock Out organization (action: 'send', with role 'org:member' or 'org:admin'), list pending organization invitations (action: 'list'), or revoke a pending invitation by email or invitation_id (action: 'revoke').",
      inputSchema: portable(inviteMemberInputSchema),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    (args, ctx) =>
      run(server, ctx.http?.authInfo, (caller) =>
        inviteMemberTool(caller, args),
      ),
  );
}
