import type { McpServer } from "@modelcontextprotocol/server";
import { type ClockOutView, clockOutAppHtml } from "@/mcp/apps-ui";

/*
 * Clock Out's in-chat apps: a timecard grid for get_weekly_timecard and an
 * hours chart/table for run_hours_report, shown inside Claude, ChatGPT and
 * other hosts instead of a wall of text.
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

export const CLOCK_OUT_APPS = [TIMECARD_APP, HOURS_REPORT_APP] as const;

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
