import type { AuthInfo, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  getCalendarShiftsInputSchema,
  getCalendarShiftsTool,
  manageAlertSettingsInputSchema,
  manageAlertSettingsTool,
  manageLocationSettingsInputSchema,
  manageLocationSettingsTool,
  manageMemberInputSchema,
  manageMemberTool,
  manageOvertimeSettingsInputSchema,
  manageOvertimeSettingsTool,
  managePayPeriodSettingsInputSchema,
  managePayPeriodSettingsTool,
  manageScheduleInputSchema,
  manageScheduleTool,
  manageTimeOffInputSchema,
  manageTimeOffTool,
} from "@/mcp/admin-tools";
import {
  ANOMALIES_APP,
  appToolMeta,
  HOURS_REPORT_APP,
  registerClockOutApps,
  TIMECARD_APP,
} from "@/mcp/apps";
import {
  auditTimesheetsInputSchema,
  auditTimesheetsTool,
} from "@/mcp/audit-tools";
import { MCP_INSTRUCTIONS } from "@/mcp/instructions";
import {
  manageNotificationPreferencesInputSchema,
  manageNotificationPreferencesTool,
} from "@/mcp/notification-tools";
import { portable } from "@/mcp/portable-schema";
import {
  approveShiftRequestTool,
  cancelShiftRequestInputSchema,
  cancelShiftRequestTool,
  claimShiftInputSchema,
  claimShiftTool,
  denyShiftRequestTool,
  listOpenShiftsInputSchema,
  listOpenShiftsTool,
  listPendingShiftRequestsInputSchema,
  listPendingShiftRequestsTool,
  postShiftForPickupInputSchema,
  postShiftForPickupTool,
  requestShiftPickupInputSchema,
  requestShiftPickupTool,
  requestShiftSwapInputSchema,
  requestShiftSwapTool,
  reviewShiftRequestInputSchema,
} from "@/mcp/shift-request-tools";
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
  getLocationSettingsInputSchema,
  getLocationSettingsTool,
  getTimesheetTablesInputSchema,
  getTimesheetTablesTool,
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
  // The tool and prompt lists never change while a client is connected. Saying so keeps
  // clients from holding a `subscriptions/listen` stream open for change
  // notifications on serverless functions.
  capabilities: {
    tools: { listChanged: false },
    prompts: { listChanged: false },
    resources: { listChanged: false },
  },
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
  // The in-chat timecard and hours report apps (`ui://` resources) that
  // get_weekly_timecard and run_hours_report link to through `_meta`.
  registerClockOutApps(server);

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
        "Starts a live shift for yourself, or (when called by an org admin) clocks in any organization member by name, email, or user_id. If the organization requires location capture, location (site name, street address, or latitude/longitude) must be provided. Rejects the request if the person is already clocked in, if location is required but omitted, if outside an approved site when geofencing is restricted (restricted organizations require the device's real latitude/longitude; a site name or address is not accepted as proof of location), or if a custom clock_in time overlaps with an existing shift, and invalidates the cache immediately.",
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
        "Ends the active shift for yourself, or (when called by an org admin) clocks out any organization member by name, email, or user_id. Optionally accepts a custom clock_out time, records clock-out location (site name, street address, or coordinates), verifies there are no overlapping shifts, and invalidates the cache immediately.",
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
    "get_location_settings",
    {
      title: "Get organization location settings and sites",
      description:
        "Returns the organization's location settings (whether location capture is 'off', 'optional', or 'required', and whether clock-in is restricted to approved sites) and the list of configured work sites. Call this to check if location is required before clocking in, or to see available work sites.",
      inputSchema: portable(getLocationSettingsInputSchema),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args, ctx) =>
      run(server, ctx.http?.authInfo, (caller) =>
        getLocationSettingsTool(caller, args),
      ),
  );

  server.registerTool(
    "add_time_entry",
    {
      title: "Add time entry or import timecard shifts",
      description:
        "Admin-only ('org:admin'): adds one shift or a batch of shifts (entries array) for any member (by name, email, or user_id). Non-admins cannot add time entries; they record their own shifts with clock_in and clock_out. Shifts in the future are rejected. Ideal when a user uploads a photo or screenshot of a weekly timecard or schedule: extract the employee name and each day's date + clock_in/clock_out (or date + hours_worked) and pass them in entries. Strictly rejects double or overlapping shifts (both within the batch and against existing database entries) so double times can never be created, and invalidates the cache.",
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
        "Returns a structured weekly timecard showing who worked, how many hours they worked in total, days worked, and a day-by-day breakdown of every shift. Admins see all organization members by default (or can filter by a member); regular members see their own timecard. Supports week_of (YYYY-MM-DD), start_date/end_date, or Clock Out's month-week selector (year, month, week 1–4). In chat apps that support MCP Apps, the result is also shown as an interactive timecard grid.",
      inputSchema: portable(getWeeklyTimecardInputSchema),
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: appToolMeta(TIMECARD_APP),
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
    "get_timesheet_tables",
    {
      title: "Get timesheet tables for Google Sheets",
      description:
        "Returns a timesheet as two ready-to-write tables for a spreadsheet app such as Google Sheets: 'Shifts' (one row per shift: employee, date, day, clock in/out, unpaid and paid break hours, hours, plus overtime, pay and location when the org has them) and 'Summary' (one row per employee with a column per day, or per week for periods over 31 days, their totals, and an organization Total row). Each table has a title (the tab name), headers and rows; hours are numbers and empty cells are null. Takes the same period and member options as export_timesheet. Use it when the user wants their hours in a spreadsheet through another connector (e.g. Google Sheets): write each table to its own tab with headers in row 1, as raw values. For PDF, Excel or CSV files use export_timesheet instead.",
      inputSchema: portable(getTimesheetTablesInputSchema),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args, ctx) =>
      run(server, ctx.http?.authInfo, (caller) =>
        getTimesheetTablesTool(caller, args),
      ),
  );

  server.registerTool(
    "toggle_break",
    {
      title: "Start, end, or toggle a live break",
      description:
        "Starts, ends, or toggles a live break on an active shift for yourself, or (when called by an org admin) for any organization member by name, email, or user_id. Supports all 4 break kinds: 'unpaid_meal' (Meal period — unpaid lunch, deducted from hours), 'paid_meal' (Paid meal period — paid lunch, not deducted), 'unpaid_rest' (Unpaid rest break — unpaid, deducted from hours), and 'paid_rest' (Paid rest break — paid, recorded for compliance and not deducted). Lunch defaults to the organization's meal kind, and only that meal kind can be started live. Pass action: 'toggle' (default), 'start', or 'end'.",
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
        "Manages recorded breaks of the 4 kinds — 'unpaid_meal' (Meal period, unpaid), 'paid_meal' (Paid meal period, paid), 'unpaid_rest' (Unpaid rest break, unpaid), and 'paid_rest' (Paid rest break, paid) — on a time entry. Organization admins ('org:admin') can add a break to any shift (action: 'add', with break_type and break_start/break_end or duration_minutes), edit an existing break's times or change it to a different kind (action: 'update' with the new break_type, by break_id or shift), or delete a break (action: 'delete', by break_id or shift). Anyone can list breaks on their shift (action: 'list') or start/end/toggle a live break on an active shift (action: 'start' | 'end' | 'toggle').",
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
        "Views or updates the organization's automated email report schedule ('off', 'pay-period' at the end of each pay period, 'weekly', 'bi-weekly', 'twice-monthly', or 'custom' weekday every 1 or 2 weeks) or sends a test weekly report email to organization admins. Anyone can view the settings; updating or sending reports is admin-only ('org:admin') and requires a plan that includes Reporting.",
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
        "Views or updates the organization's automatic lunch/break deduction: whether unpaid break time is docked (dock_lunch), how many minutes are deducted (lunch_duration_minutes), the minimum shift length in hours before it applies (lunch_min_shift_hours), and whether lunch is paid or unpaid (paid_lunch; a paid lunch is a 'paid_meal' break and is never deducted). Unspecified fields keep their current values. Anyone can view the settings; updating is admin-only ('org:admin'). Available on every plan.",
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
        "Admin-only ('org:admin') tool for organizations whose plan includes Reporting. Gets net hours worked (after lunch/break deductions) for one member or everyone between start_date and end_date, with daily breakdowns and shifts. Works with or without a reporting schedule. Returns the report to you by default; deliver: 'email_admins' or 'both' also emails it to the organization's admins. In chat apps that support MCP Apps, the result is also shown as an interactive hours chart and table.",
      inputSchema: portable(runHoursReportInputSchema),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      _meta: appToolMeta(HOURS_REPORT_APP),
    },
    (args, ctx) =>
      run(server, ctx.http?.authInfo, (caller) =>
        runHoursReportTool(caller, args),
      ),
  );

  server.registerTool(
    "audit_timesheets",
    {
      title: "Audit timesheets for problems",
      description:
        "Admin-only ('org:admin') read-only audit of the organization's time entries between start_date and end_date (one member or everyone). Flags missed clock-outs (including shifts closed by the automatic clock-out), unusually long shifts, overlapping entries, missed or short meal breaks, punches far outside every work site's geofence, entries entered or edited after the fact, late arrivals (clocked in after a scheduled shift's start) and no-shows (a scheduled shift that ended with no clock-in; skipped without the Scheduling plan feature, and never flagged on a day of approved time off). Each finding has a type, severity, employee, entry_ids, scheduled_shift_id, date, description, and a suggested_fix that, when not null, is the exact input object for update_time_entry. Thresholds are optional parameters. Never applies fixes itself: show the findings and only call update_time_entry with a suggested_fix after the admin confirms it.",
      inputSchema: portable(auditTimesheetsInputSchema),
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: appToolMeta(ANOMALIES_APP),
    },
    (args, ctx) =>
      run(server, ctx.http?.authInfo, (caller) =>
        auditTimesheetsTool(caller, args),
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

  server.registerTool(
    "manage_schedule",
    {
      title: "View, schedule, change, or cancel shifts",
      description:
        "Lists scheduled shifts with how each went (on time, late, not clocked in, no-show), or, for admins ('org:admin'), schedules a shift for any member (action: 'create' with member, date, start_time, end_time, optional note), moves a shift or changes its note (action: 'update' with shift_id), or cancels a shift (action: 'cancel' with shift_id, or member and date). Shifts can't be scheduled on a member's approved time off, and the member is notified of changes when schedule notices are on. Members can list only their own shifts. Only change or cancel a shift when the user explicitly asks.",
      inputSchema: portable(manageScheduleInputSchema),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    (args, ctx) =>
      run(server, ctx.http?.authInfo, (caller) =>
        manageScheduleTool(caller, args),
      ),
  );

  server.registerTool(
    "get_calendar_shifts",
    {
      title: "Get scheduled shifts for a calendar sync",
      description:
        "Returns scheduled shifts as calendar-ready events for syncing into the user's own calendar (e.g. Google Calendar through another connector): title, start and end with timezone offset, description, and a sync_tag per shift. Defaults to your own shifts for today plus 14 days (at most 93 days); admins can pass a member or 'all'. Store each event's sync_tag on the calendar event (in its description, and as a private extended property when the calendar tool supports it). To sync, create events for new shifts, update tagged events that differ, and delete events in the window whose tag starts with sync_scope_prefix but isn't in the result (cancelled shifts). Never touch other events. Needs a plan with Scheduling.",
      inputSchema: portable(getCalendarShiftsInputSchema),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args, ctx) =>
      run(server, ctx.http?.authInfo, (caller) =>
        getCalendarShiftsTool(caller, args),
      ),
  );

  server.registerTool(
    "manage_time_off",
    {
      title: "Request, approve, deny, or cancel time off",
      description:
        "Lists vacation and sick time off, files a request (action: 'request'), approves or denies a pending request (actions 'approve'/'deny', admin-only), or cancels one (action: 'cancel': members withdraw their own pending requests; admins can also revoke approved time off). Admins ('org:admin') can file time off for any member by passing member, and it is approved right away unless approve: false. Approved time off shows in hours views and reports. When importing time off from a calendar, pass external_ref (the event's ID) so the same event is never filed twice.",
      inputSchema: portable(manageTimeOffInputSchema),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    (args, ctx) =>
      run(server, ctx.http?.authInfo, (caller) =>
        manageTimeOffTool(caller, args),
      ),
  );

  server.registerTool(
    "manage_overtime_settings",
    {
      title: "View or update overtime rules",
      description:
        "Views or updates the organization's overtime thresholds: hours per day (daily_threshold_hours) and/or per week (weekly_threshold_hours) after which time counts as overtime in timecards, exports and reports. Pass null to turn a threshold off; omitted fields keep their values. Anyone can view; updating is admin-only ('org:admin').",
      inputSchema: portable(manageOvertimeSettingsInputSchema),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (args, ctx) =>
      run(server, ctx.http?.authInfo, (caller) =>
        manageOvertimeSettingsTool(caller, args),
      ),
  );

  server.registerTool(
    "manage_pay_period_settings",
    {
      title: "View or update pay periods",
      description:
        "Views or updates the organization's pay periods: how often members are paid ('weekly' or 'bi-weekly'), one payday the rest repeat from, and the hold-back (days between a period's last day and its payday, e.g. 7 for one week). 'get' also returns the pay period that includes a date (today by default) with its start/end dates, payday and report date, plus the previous and next periods — pass those dates to run_hours_report or get_weekly_timecard to see hours for a pay period. Anyone can view; updating is admin-only ('org:admin').",
      inputSchema: portable(managePayPeriodSettingsInputSchema),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (args, ctx) =>
      run(server, ctx.http?.authInfo, (caller) =>
        managePayPeriodSettingsTool(caller, args),
      ),
  );

  server.registerTool(
    "manage_alert_settings",
    {
      title: "View or update shift alert rules",
      description:
        "Views or updates the organization's alert rules: forgot-to-clock-out reminders, automatic clock-out, still-on-break reminders, whether admins are copied, and schedule notices to members. Only the fields passed change. Anyone can view; updating is admin-only ('org:admin').",
      inputSchema: portable(manageAlertSettingsInputSchema),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (args, ctx) =>
      run(server, ctx.http?.authInfo, (caller) =>
        manageAlertSettingsTool(caller, args),
      ),
  );

  server.registerTool(
    "manage_location_settings",
    {
      title: "View or update location capture, geofencing and work sites",
      description:
        "Views the organization's location capture mode ('off', 'optional', 'required'), geofence restriction and work sites, or, for admins ('org:admin') on a plan with Geofencing, changes them (action: 'update' with capture_mode / restrict_clock_in) and adds, edits or deletes work sites (actions 'add_site', 'update_site', 'delete_site'; a site can be given by address or latitude/longitude, with radius_meters).",
      inputSchema: portable(manageLocationSettingsInputSchema),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    (args, ctx) =>
      run(server, ctx.http?.authInfo, (caller) =>
        manageLocationSettingsTool(caller, args),
      ),
  );

  server.registerTool(
    "manage_notification_preferences",
    {
      title: "View or update your own notification settings",
      description:
        "Views or updates your personal notification settings: email and push on/off, which alerts you get (shift alerts, break reminders, admin alerts, schedule notices and shift reminders), and your timezone for alert wording. Also sends you a test notification (action: 'send_test'). These settings are personal and shared across your organizations; nobody can change someone else's.",
      inputSchema: portable(manageNotificationPreferencesInputSchema),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    (args, ctx) =>
      run(server, ctx.http?.authInfo, (caller) =>
        manageNotificationPreferencesTool(caller, args),
      ),
  );

  server.registerTool(
    "manage_member",
    {
      title: "Change a member's role or remove them",
      description:
        "Admin tool ('org:admin') to make a member an admin or a regular member (action: 'set_role' with role) or remove them from the organization (action: 'remove'; their recorded hours are kept). You can't change or remove yourself. Only call this when the admin explicitly asks.",
      inputSchema: portable(manageMemberInputSchema),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (args, ctx) =>
      run(server, ctx.http?.authInfo, (caller) =>
        manageMemberTool(caller, args),
      ),
  );

  /* ------------------------------------- shift swap & pickup requests -- */

  const writeHints = {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  };

  server.registerTool(
    "post_shift_for_pickup",
    {
      title: "Offer up one of your shifts",
      description:
        'Posts one of your own upcoming scheduled shifts for coworkers to pick up (e.g. "post my Saturday shift"). Pass shift_id, or date when you have one shift that day. Pass offer_to to offer it to one coworker only. Nothing changes on the schedule yet: a coworker claims it (claim_shift), then a manager approves it (approve_shift_request). Needs the Scheduling plan feature.',
      inputSchema: portable(postShiftForPickupInputSchema),
      annotations: writeHints,
    },
    (args, ctx) =>
      run(server, ctx.http?.authInfo, (caller) =>
        postShiftForPickupTool(caller, args),
      ),
  );

  server.registerTool(
    "request_shift_swap",
    {
      title: "Ask a coworker to swap shifts",
      description:
        "Asks a coworker to trade one of your upcoming shifts for one of theirs. Pass your shift (shift_id or date), the coworker, and their shift (their_shift_id or their_date). The coworker accepts with claim_shift (or declines with cancel_shift_request), then a manager approves it and both shifts change hands. Rejected if either of you would end up double-booked or on approved time off.",
      inputSchema: portable(requestShiftSwapInputSchema),
      annotations: writeHints,
    },
    (args, ctx) =>
      run(server, ctx.http?.authInfo, (caller) =>
        requestShiftSwapTool(caller, args),
      ),
  );

  server.registerTool(
    "request_shift_pickup",
    {
      title: "Ask to take a coworker's shift",
      description:
        "Asks a coworker to hand you one of their upcoming shifts (one they haven't posted). Pass the coworker and their shift (shift_id or date). They accept with claim_shift (or decline with cancel_shift_request), then a manager approves it. To take a shift someone already posted, use claim_shift instead.",
      inputSchema: portable(requestShiftPickupInputSchema),
      annotations: writeHints,
    },
    (args, ctx) =>
      run(server, ctx.http?.authInfo, (caller) =>
        requestShiftPickupTool(caller, args),
      ),
  );

  server.registerTool(
    "list_open_shifts",
    {
      title: "List shifts up for grabs and your shift requests",
      description:
        "Lists upcoming shifts coworkers have posted that you can claim (available_to_claim), swap or pickup requests waiting for your answer (awaiting_your_answer), and your own requests in progress (your_requests), each with its request_id and status. Call this before claim_shift or cancel_shift_request.",
      inputSchema: portable(listOpenShiftsInputSchema),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args, ctx) =>
      run(server, ctx.http?.authInfo, (caller) =>
        listOpenShiftsTool(caller, args),
      ),
  );

  server.registerTool(
    "claim_shift",
    {
      title: "Claim an offered shift or accept a swap",
      description:
        "Claims a shift a coworker posted, or accepts a swap or pickup request sent to you, by request_id (from list_open_shifts). You can't claim your own shift, a shift offered to someone else, or one you'd be double-booked for. The request then waits for a manager's approval; the schedule only changes once it's approved. Only call this when the user explicitly asks.",
      inputSchema: portable(claimShiftInputSchema),
      annotations: writeHints,
    },
    (args, ctx) =>
      run(server, ctx.http?.authInfo, (caller) => claimShiftTool(caller, args)),
  );

  server.registerTool(
    "cancel_shift_request",
    {
      title: "Cancel or decline a shift request",
      description:
        "Withdraws a shift offer, swap or pickup request you made, or declines one sent to you, by request_id. Admins can cancel any open or pending request. Approved, denied and cancelled requests can't be changed. The schedule is never changed by cancelling.",
      inputSchema: portable(cancelShiftRequestInputSchema),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (args, ctx) =>
      run(server, ctx.http?.authInfo, (caller) =>
        cancelShiftRequestTool(caller, args),
      ),
  );

  server.registerTool(
    "list_pending_shift_requests",
    {
      title: "List shift changes waiting for approval",
      description:
        "Admin tool ('org:admin'): lists shift swaps and pickups that coworkers have agreed to and that wait for a manager's approval, with both shifts, who gives and who takes each, and the request_id. Pass include_open: true to also see requests still waiting for a coworker.",
      inputSchema: portable(listPendingShiftRequestsInputSchema),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args, ctx) =>
      run(server, ctx.http?.authInfo, (caller) =>
        listPendingShiftRequestsTool(caller, args),
      ),
  );

  server.registerTool(
    "approve_shift_request",
    {
      title: "Approve a shift swap or pickup",
      description:
        "Admin tool ('org:admin'): approves a shift request waiting for approval (request_id from list_pending_shift_requests) and reassigns the shift(s) on the schedule: the claimed shift moves to the coworker taking it and, for a swap, their shift moves back. Refused if anyone would be double-booked or on approved time off, or if the shift already started or changed hands. Only call this when the admin explicitly asks.",
      inputSchema: portable(reviewShiftRequestInputSchema),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    (args, ctx) =>
      run(server, ctx.http?.authInfo, (caller) =>
        approveShiftRequestTool(caller, args),
      ),
  );

  server.registerTool(
    "deny_shift_request",
    {
      title: "Deny a shift swap or pickup",
      description:
        "Admin tool ('org:admin'): denies a shift request waiting for approval (request_id from list_pending_shift_requests). The schedule stays as it is and the members involved are told. Only call this when the admin explicitly asks.",
      inputSchema: portable(reviewShiftRequestInputSchema),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (args, ctx) =>
      run(server, ctx.http?.authInfo, (caller) =>
        denyShiftRequestTool(caller, args),
      ),
  );
}
