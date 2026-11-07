import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

/*
 * MCP prompts: ready-made flows that show up in AI clients as slash commands
 * or a prompt picker. Clock Out has no Google access of its own; each prompt
 * tells the AI which Clock Out tools to call and how to hand the result to the
 * user's own connectors (Google Sheets, Google Calendar, ...).
 *
 * Prompt arguments are always strings, and all of them are optional: the AI
 * asks for, or works out, anything the user leaves out.
 */

export const exportToSheetsArgsSchema = z.object({
  period: z
    .string()
    .optional()
    .describe(
      "Which hours to export, in the user's words, e.g. 'this week', 'last pay period', 'October 2026' or '2026-11-01 to 2026-11-15'. Defaults to the current week.",
    ),
  member: z
    .string()
    .optional()
    .describe(
      "Whose hours: a name or email, or 'all' (admins). Defaults to everyone for admins and to yourself for members.",
    ),
  spreadsheet: z
    .string()
    .optional()
    .describe(
      "An existing Google Sheets link or name to write into. Leave empty to create a new spreadsheet.",
    ),
});

export type ExportToSheetsArgs = z.infer<typeof exportToSheetsArgsSchema>;

export function exportToSheetsPromptText(args: ExportToSheetsArgs): string {
  const period = args.period?.trim() || "the current week";
  const member = args.member?.trim();
  const spreadsheet = args.spreadsheet?.trim();
  return [
    `Put my Clock Out timesheet for ${period}${member ? ` for ${member}` : ""} into Google Sheets.`,
    "",
    "Steps:",
    `1. Work out the dates for "${period}" (ask me if it's ambiguous; for a pay period, check manage_pay_period_settings). Then call the Clock Out tool get_timesheet_tables with start_date and end_date${member ? ` and member "${member}"` : ""}. If I belong to more than one organization, ask which one or use list_organizations.`,
    spreadsheet
      ? `2. Open the existing spreadsheet "${spreadsheet}" with my Google Sheets tools. If tabs named "Shifts" or "Summary" already exist and hold data, ask me before overwriting them; otherwise add the missing tabs.`
      : "2. Create a new spreadsheet with my Google Sheets tools, named with the suggested_spreadsheet_title from the result.",
    "3. Write each table in the result's \"tables\" to its own tab named after the table's title: the headers in row 1, then every row in order. Write cells as raw values (not user-entered or formulas), and leave null cells empty.",
    "4. Tell me the totals from the result (shifts, hours, and overtime or estimated pay if present), mention any open shifts that have no hours yet, and give me the spreadsheet link.",
    "",
    "If I don't have a Google Sheets connector, say so and call export_timesheet instead, so I can download the Excel or CSV file.",
  ].join("\n");
}

export const importTimeOffArgsSchema = z.object({
  period: z
    .string()
    .optional()
    .describe(
      "Which dates to look through, in the user's words, e.g. 'next 3 months', 'December' or '2026-12-01 to 2027-01-15'. Defaults to the next 3 months.",
    ),
  calendar: z
    .string()
    .optional()
    .describe(
      "Which Google calendar to read, by name. Defaults to the user's primary calendar.",
    ),
});

export type ImportTimeOffArgs = z.infer<typeof importTimeOffArgsSchema>;

export function importTimeOffPromptText(args: ImportTimeOffArgs): string {
  const period = args.period?.trim() || "the next 3 months";
  const calendar = args.calendar?.trim();
  const source = calendar
    ? `my "${calendar}" Google calendar`
    : "my primary Google calendar";
  return [
    `Look through ${source} for ${period} and help me turn time off into Clock Out time-off requests.`,
    "",
    "Steps:",
    `1. With my Google Calendar tools, list the events on ${source} for ${period}. If I belong to more than one Clock Out organization, ask which one (list_organizations).`,
    "2. Pick out events that look like time off: out-of-office events, all-day events such as vacation, holiday, trip or day off, and sick days or appointments that take me away from work. Skip ordinary meetings, other people's events I'm only invited to, and anything I declined.",
    "3. Show me the candidates as a short table (date or dates, event title, suggested type 'vacation' or 'sick', hours per day) and ask which ones to file. File nothing until I confirm, and let me change the type or hours first.",
    "4. For each one I confirm, call the Clock Out tool manage_time_off with action 'request', type, start_date, end_date (the last day off, inclusive: an all-day event's end date in Google Calendar is the day after), and hours_per_day (leave it out for full days; for a part-day event use its length in hours). Pass external_ref as 'google-calendar:<calendar id>:<event id>', using each occurrence's own event id for recurring events, and use the event title as the note.",
    "5. Tell me what happened to each: requested (waiting for approval), already_imported (filed before, so nothing new), or overlapping_time_off (I already have time off on those dates).",
    "",
    "If I don't have a Google Calendar connector, say so, and offer to file time off from dates I type in instead.",
  ].join("\n");
}

export function registerClockOutPrompts(server: McpServer) {
  server.registerPrompt(
    "import-time-off-from-calendar",
    {
      title: "Import time off from Google Calendar",
      description:
        "Finds vacation, sick days and other time off on your Google Calendar and, once you confirm, files them as Clock Out time-off requests. Importing the same event twice never files it twice. Needs a Google Calendar connector in your AI app.",
      argsSchema: importTimeOffArgsSchema,
    },
    (args) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: importTimeOffPromptText(args),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "export-timesheet-to-sheets",
    {
      title: "Export timesheet to Google Sheets",
      description:
        "Puts a Clock Out timesheet into Google Sheets with a Shifts tab (one row per shift) and a Summary tab (hours per employee per day). Needs a Google Sheets connector in your AI app.",
      argsSchema: exportToSheetsArgsSchema,
    },
    (args) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: exportToSheetsPromptText(args),
          },
        },
      ],
    }),
  );
}
