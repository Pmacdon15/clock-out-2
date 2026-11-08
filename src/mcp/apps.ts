import type { McpServer } from "@modelcontextprotocol/server";
import { type ClockOutView, clockOutAppHtml } from "@/mcp/apps-ui";

/*
 * Clock Out's in-chat apps: a timecard grid for get_weekly_timecard, an
 * hours chart/table for run_hours_report, an anomalies card for
 * audit_timesheets and a clock-in card for clock_in (which reads the
 * device's location when the org needs it), shown inside Claude, ChatGPT and other hosts instead of a
 * wall of text.
 *
 * Follows the MCP Apps extension (SEP-1865, `io.modelcontextprotocol/ui`):
 * each app is a `ui://` resource of type `text/html;profile=mcp-app`, linked
 * from its tool by `_meta.ui.resourceUri`. The OpenAI Apps SDK keys
 * (`openai/outputTemplate`, ...) point ChatGPT at the same resource. Hosts
 * without app support ignore all of this and keep using the text content.
 */

export const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";

export type ClockOutApp = {
  name: string;
  uri: string;
  title: string;
  description: string;
  view: ClockOutView;
  invoking: string;
  invoked: string;
  /** Browser features the app's iframe needs (MCP Apps `ui.permissions`). */
  permissions?: { geolocation?: Record<string, never> };
};

export const TIMECARD_APP: ClockOutApp = {
  name: "timecard-app",
  uri: "ui://clock-out/timecard.html",
  title: "Timecard",
  description:
    "Interactive weekly timecard grid: hours per member per day, with each day's shifts. Admins can edit shifts and approve or deny pending time off.",
  view: "timecard",
  invoking: "Loading timecard…",
  invoked: "Timecard ready",
};

export const HOURS_REPORT_APP: ClockOutApp = {
  name: "hours-report-app",
  uri: "ui://clock-out/hours-report.html",
  title: "Hours report",
  description:
    "Interactive hours report: a chart and table of net, gross, break, overtime and time off hours per member, with each member's shifts. Admins can edit shifts and approve or deny pending time off.",
  view: "hours",
  invoking: "Running hours report…",
  invoked: "Hours report ready",
};

export const ANOMALIES_APP: ClockOutApp = {
  name: "anomalies-app",
  uri: "ui://clock-out/anomalies.html",
  title: "Timesheet anomalies",
  description:
    "Interactive timesheet audit: findings by severity and type (missed clock-outs, long shifts, overlaps, missed meal breaks, far-away punches, after-the-fact edits), with each finding's suggested fix. Admins can apply a suggested fix after confirming it.",
  view: "anomalies",
  invoking: "Auditing timesheets…",
  invoked: "Audit ready",
};

export const CLOCK_IN_APP: ClockOutApp = {
  name: "clock-in-app",
  uri: "ui://clock-out/clock-in.html",
  title: "Clock in",
  description:
    "Clock-in card: when the organization needs your location, it asks the device for its current position (with your permission) and clocks you in with it, so the work-site geofence is checked against where you really are.",
  view: "clock",
  invoking: "Clocking in…",
  invoked: "Clock in",
  permissions: { geolocation: {} },
};

export const CLOCK_OUT_APPS = [
  TIMECARD_APP,
  HOURS_REPORT_APP,
  ANOMALIES_APP,
  CLOCK_IN_APP,
] as const;

/** `_meta` for a tool whose results the app renders. */
export function appToolMeta(app: ClockOutApp) {
  return {
    ui: { resourceUri: app.uri },
    // Earlier drafts of SEP-1865 used a flat key; some hosts still read it.
    "ui/resourceUri": app.uri,
    "openai/outputTemplate": app.uri,
    // Lets the ChatGPT widget call tools (update_time_entry, ...) itself.
    "openai/widgetAccessible": true,
    "openai/toolInvocation/invoking": app.invoking,
    "openai/toolInvocation/invoked": app.invoked,
  };
}

/** `_meta` for an app's resource: no outside origins at all. */
export function appResourceMeta(app: ClockOutApp) {
  return {
    ui: {
      csp: { connectDomains: [], resourceDomains: [] },
      prefersBorder: true,
      ...(app.permissions ? { permissions: app.permissions } : {}),
    },
    "openai/widgetDescription": app.description,
    "openai/widgetPrefersBorder": true,
    "openai/widgetCSP": { connect_domains: [], resource_domains: [] },
  };
}

/** Registers each app's `ui://` resource. The HTML holds no user data. */
export function registerClockOutApps(server: McpServer) {
  for (const app of CLOCK_OUT_APPS) {
    server.registerResource(
      app.name,
      app.uri,
      {
        title: app.title,
        description: app.description,
        mimeType: MCP_APP_MIME_TYPE,
        _meta: appResourceMeta(app),
      },
      async (uri) => ({
        contents: [
          {
            uri: uri.href,
            mimeType: MCP_APP_MIME_TYPE,
            text: clockOutAppHtml(app.view),
            _meta: appResourceMeta(app),
          },
        ],
      }),
    );
  }
}
