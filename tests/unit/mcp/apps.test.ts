import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * MCP Apps (SEP-1865) integration: a real McpServer set up exactly like
 * /api/mcp (SERVER_OPTIONS + registerClockOutTools), driven over an in-memory
 * transport with raw JSON-RPC, as a host such as Claude or ChatGPT would.
 */

const m = vi.hoisted(() => ({
  getUserOrgMemberships: vi.fn(),
  getOrgMemberships: vi.fn(),
  getBillingSubscription: vi.fn(),
  dbGetTimeEntries: vi.fn(async () => [] as unknown[]),
  dbGetOrgTimeEntries: vi.fn(async () => [] as unknown[]),
  dbGetTimeEntryById: vi.fn(),
  dbUpdateTimeEntry: vi.fn(),
  dbGetBreakSettings: vi.fn(async () => undefined as unknown),
  dbGetOvertimeSettings: vi.fn(async () => undefined),
  dbGetTimeOffRequests: vi.fn(async () => [] as unknown[]),
  dbReviewTimeOffRequest: vi.fn(),
  orgHasReportingFeature: vi.fn(async () => true),
  sendWeeklyReports: vi.fn(async () => true),
}));

vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: vi.fn(async () => ({
    users: { getOrganizationMembershipList: m.getUserOrgMemberships },
    organizations: { getOrganizationMembershipList: m.getOrgMemberships },
    billing: { getOrganizationBillingSubscription: m.getBillingSubscription },
  })),
}));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
vi.mock("@/mcp/db", () => ({
  dbGetTimeEntries: m.dbGetTimeEntries,
  dbGetOrgTimeEntries: m.dbGetOrgTimeEntries,
  dbGetTimeEntryById: m.dbGetTimeEntryById,
  dbUpdateTimeEntry: m.dbUpdateTimeEntry,
  dbGetBreakSettings: m.dbGetBreakSettings,
  dbGetOvertimeSettings: m.dbGetOvertimeSettings,
  dbGetTimeOffRequests: m.dbGetTimeOffRequests,
  dbFindOverlappingTimeEntries: vi.fn(async () => []),
  invalidateTimeEntryCache: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  dbGetTimeOffRequests: m.dbGetTimeOffRequests,
  dbReviewTimeOffRequest: m.dbReviewTimeOffRequest,
}));
vi.mock("@/lib/reports", () => ({
  orgHasReportingFeature: m.orgHasReportingFeature,
  sendWeeklyReports: m.sendWeeklyReports,
}));
vi.mock("@/lib/alerts-db", () => ({}));
vi.mock("@/lib/schedule-notify", () => ({}));
vi.mock("@/lib/notify", () => ({}));
vi.mock("@/lib/utils-clerk", () => ({}));
vi.mock("@/lib/geoapify", () => ({}));

import {
  type AuthInfo,
  InMemoryTransport,
  type JSONRPCMessage,
  McpServer,
} from "@modelcontextprotocol/server";
import { JSDOM } from "jsdom";
import {
  appToolMeta,
  CLOCK_OUT_APPS,
  HOURS_REPORT_APP,
  MCP_APP_MIME_TYPE,
  TIMECARD_APP,
} from "@/mcp/apps";
import { clockOutAppHtml } from "@/mcp/apps-ui";
import { MCP_INSTRUCTIONS } from "@/mcp/instructions";
import { registerClockOutTools, SERVER_OPTIONS } from "@/mcp/server";

const ORG = { id: "org_1", name: "Acme", slug: "acme" };

function asRole(role: "org:admin" | "org:member") {
  m.getUserOrgMemberships.mockResolvedValue({
    data: [{ role, organization: ORG }],
  });
}

const orgMembers = {
  data: [
    {
      role: "org:admin",
      publicUserData: {
        userId: "user_admin",
        firstName: "Pat",
        lastName: "Mac",
        identifier: "pat@acme.test",
      },
    },
    {
      role: "org:member",
      publicUserData: {
        userId: "user_sam",
        firstName: "Sam",
        lastName: "Lee",
        identifier: "sam@acme.test",
      },
    },
  ],
};

// Tue Nov 3 2026, 9:00–17:00 America/Regina (UTC-6)
const samShift = {
  id: 11,
  user_id: "user_sam",
  org_id: "org_1",
  clock_in: new Date("2026-11-03T15:00:00.000Z"),
  clock_out: new Date("2026-11-03T23:00:00.000Z"),
};

/** A connected client: sends JSON-RPC as `userId` and awaits the answer. */
async function connect(userId: string) {
  const server = new McpServer(SERVER_OPTIONS.serverInfo, SERVER_OPTIONS);
  registerClockOutTools(server);
  const [client, serverSide] = InMemoryTransport.createLinkedPair();
  const answers = new Map<number, (msg: JSONRPCMessage) => void>();
  client.onmessage = (msg) => {
    const id = (msg as { id?: number }).id;
    if (typeof id === "number" && answers.has(id)) {
      answers.get(id)?.(msg);
      answers.delete(id);
    }
  };
  await server.connect(serverSide);
  await client.start();
  const authInfo: AuthInfo = {
    token: "t",
    clientId: "c",
    scopes: [],
    extra: { userId },
  };
  let nextId = 1;
  const rpc = async (method: string, params: Record<string, unknown> = {}) => {
    const id = nextId++;
    const answer = new Promise<JSONRPCMessage>((resolve) =>
      answers.set(id, resolve),
    );
    await client.send({ jsonrpc: "2.0", id, method, params }, { authInfo });
    const msg = (await answer) as {
      result?: Record<string, unknown>;
      error?: { message: string };
    };
    if (msg.error) throw new Error(msg.error.message);
    return msg.result as Record<string, unknown>;
  };
  await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {
      extensions: {
        "io.modelcontextprotocol/ui": { mimeTypes: [MCP_APP_MIME_TYPE] },
      },
    },
    clientInfo: { name: "test-host", version: "1.0.0" },
  });
  await client.send(
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { authInfo },
  );
  return rpc;
}

type ToolCall = {
  content: { type: string; text: string }[];
  structuredContent: Record<string, unknown>;
  isError?: boolean;
};

beforeEach(() => {
  vi.clearAllMocks();
  m.getOrgMemberships.mockResolvedValue(orgMembers);
  m.getBillingSubscription.mockResolvedValue({
    subscriptionItems: [
      { plan: { features: [{ slug: "time_off" }, { slug: "reporting" }] } },
    ],
  });
  m.orgHasReportingFeature.mockResolvedValue(true);
  m.dbGetTimeEntries.mockResolvedValue([samShift]);
  m.dbGetOrgTimeEntries.mockResolvedValue([samShift]);
  m.dbGetTimeOffRequests.mockResolvedValue([]);
});

describe("MCP Apps: tools/list and resources", () => {
  it("links get_weekly_timecard and run_hours_report to their ui:// apps", async () => {
    asRole("org:admin");
    const rpc = await connect("user_admin");
    const { tools } = (await rpc("tools/list")) as {
      tools: { name: string; _meta?: Record<string, unknown> }[];
    };
    const byName = new Map(tools.map((t) => [t.name, t]));
    for (const [name, app] of [
      ["get_weekly_timecard", TIMECARD_APP],
      ["run_hours_report", HOURS_REPORT_APP],
    ] as const) {
      const meta = byName.get(name)?._meta;
      expect(meta, name).toEqual(appToolMeta(app));
      expect(meta?.ui).toEqual({ resourceUri: app.uri });
      expect(meta?.["openai/outputTemplate"]).toBe(app.uri);
      expect(meta?.["openai/widgetAccessible"]).toBe(true);
    }
    // Only the two app tools carry a UI; every other tool stays plain.
    expect(
      tools
        .filter((t) => t._meta?.ui)
        .map((t) => t.name)
        .sort(),
    ).toEqual(["get_weekly_timecard", "run_hours_report"]);
    // The tools the app calls stay visible to apps.
    for (const name of ["update_time_entry", "manage_time_off"]) {
      expect(byName.has(name), name).toBe(true);
    }
  });

  it("lists each app as a ui:// resource of type text/html;profile=mcp-app", async () => {
    asRole("org:member");
    const rpc = await connect("user_sam");
    const { resources } = (await rpc("resources/list")) as {
      resources: { uri: string; mimeType: string; name: string }[];
    };
    expect(resources.map((r) => r.uri).sort()).toEqual(
      CLOCK_OUT_APPS.map((a) => a.uri).sort(),
    );
    for (const r of resources) {
      expect(r.uri.startsWith("ui://")).toBe(true);
      expect(r.mimeType).toBe(MCP_APP_MIME_TYPE);
    }
  });

  it("serves self-contained HTML for each app with an empty CSP", async () => {
    asRole("org:member");
    const rpc = await connect("user_sam");
    for (const app of CLOCK_OUT_APPS) {
      const { contents } = (await rpc("resources/read", { uri: app.uri })) as {
        contents: {
          uri: string;
          mimeType: string;
          text: string;
          _meta: { ui: { csp: Record<string, string[]> } };
        }[];
      };
      expect(contents).toHaveLength(1);
      const [page] = contents;
      expect(page?.uri).toBe(app.uri);
      expect(page?.mimeType).toBe(MCP_APP_MIME_TYPE);
      expect(page?.text).toMatch(/^<!doctype html>/);
      expect(page?.text).toContain(`data-view="${app.view}"`);
      // Nothing is fetched or loaded from outside the page.
      expect(page?.text).not.toMatch(/<script[^>]+src=|<link[^>]+href=/i);
      expect(page?.text).not.toMatch(/\bfetch\(|XMLHttpRequest|https?:\/\//);
      expect(page?._meta.ui.csp).toEqual({
        connectDomains: [],
        resourceDomains: [],
      });
      // Speaks the MCP Apps bridge, with the OpenAI Apps SDK as a fallback.
      for (const method of [
        "ui/initialize",
        "ui/notifications/initialized",
        "ui/notifications/tool-result",
        "tools/call",
      ]) {
        expect(page?.text).toContain(method);
      }
      expect(page?.text).toContain("window.openai");
      expect(page?.text).toContain("prefers-color-scheme: dark");
    }
  });

  it("advertises resources in the server capabilities", () => {
    expect(SERVER_OPTIONS.capabilities.resources).toEqual({
      listChanged: false,
    });
  });

  it("documents the in-chat apps in the server instructions", () => {
    expect(MCP_INSTRUCTIONS).toMatch(/Interactive Timecard & Hours Report/);
    expect(MCP_INSTRUCTIONS).toMatch(/update_time_entry/);
  });
});

describe("MCP Apps: tools/call results", () => {
  it("get_weekly_timecard returns the text fallback plus structuredContent for the grid", async () => {
    asRole("org:admin");
    const rpc = await connect("user_admin");
    const res = (await rpc("tools/call", {
      name: "get_weekly_timecard",
      arguments: { week_of: "2026-11-03", timezone: "America/Regina" },
    })) as ToolCall;

    expect(res.isError).toBeUndefined();
    expect(res.content[0]?.type).toBe("text");
    expect(res.content[0]?.text).toMatch(/^Weekly timecard for Acme/);
    expect(JSON.parse(res.content[1]?.text ?? "")).toEqual(
      res.structuredContent,
    );
    const sc = res.structuredContent as {
      period: Record<string, string>;
      viewer: Record<string, unknown>;
      scope: string;
      timecards: {
        user_id: string;
        total_hours: number;
        daily_breakdown: {
          date: string;
          shifts: { id: number; clock_in_local: string }[];
        }[];
      }[];
    };
    expect(sc.period).toMatchObject({
      start_date: "2026-11-02",
      end_date: "2026-11-08",
      timezone: "America/Regina",
    });
    expect(sc.viewer).toEqual({ user_id: "user_admin", is_admin: true });
    expect(sc.scope).toBe("all");
    const sam = sc.timecards.find((t) => t.user_id === "user_sam");
    expect(sam?.total_hours).toBe(8);
    expect(sam?.daily_breakdown[0]?.date).toBe("2026-11-03");
    expect(sam?.daily_breakdown[0]?.shifts[0]).toMatchObject({
      id: 11,
      clock_in_local: expect.stringMatching(/^2026-11-03 09:00/),
    });
  });

  it("a member's timecard is their own, marked as not an admin", async () => {
    asRole("org:member");
    const rpc = await connect("user_sam");
    const res = (await rpc("tools/call", {
      name: "get_weekly_timecard",
      arguments: { week_of: "2026-11-03", timezone: "America/Regina" },
    })) as ToolCall;
    const sc = res.structuredContent as {
      viewer: Record<string, unknown>;
      scope: string;
      timecards: { user_id: string }[];
    };
    expect(sc.viewer).toEqual({ user_id: "user_sam", is_admin: false });
    expect(sc.scope).toBe("member");
    expect(sc.timecards.map((t) => t.user_id)).toEqual(["user_sam"]);
  });

  it("run_hours_report returns the text fallback plus structuredContent for the chart", async () => {
    asRole("org:admin");
    const rpc = await connect("user_admin");
    const res = (await rpc("tools/call", {
      name: "run_hours_report",
      arguments: {
        start_date: "2026-11-01",
        end_date: "2026-11-07",
        timezone: "America/Regina",
      },
    })) as ToolCall;

    expect(res.isError).toBeUndefined();
    expect(res.content[0]?.text).toMatch(/^Hours report for Acme/);
    expect(JSON.parse(res.content[1]?.text ?? "")).toEqual(
      res.structuredContent,
    );
    const sc = res.structuredContent as {
      status: string;
      period: Record<string, string>;
      viewer: Record<string, unknown>;
      scope: string;
      reports: Record<string, unknown>[];
    };
    expect(sc.status).toBe("ok");
    expect(sc.period).toMatchObject({
      start_date: "2026-11-01",
      end_date: "2026-11-07",
    });
    expect(sc.viewer).toEqual({ user_id: "user_admin", is_admin: true });
    expect(sc.scope).toBe("all");
    const sam = sc.reports.find((r) => r.user_id === "user_sam");
    expect(sam).toMatchObject({
      total_hours: 8,
      gross_hours: 8,
      break_deduction_hours: 0,
      days_worked: 1,
    });
    expect(m.sendWeeklyReports).not.toHaveBeenCalled();
  });
});

describe("MCP Apps: role checks on the calls the app makes", () => {
  it("a member can't edit a shift through update_time_entry", async () => {
    asRole("org:member");
    const rpc = await connect("user_sam");
    const res = (await rpc("tools/call", {
      name: "update_time_entry",
      arguments: {
        entry_id: 11,
        date: "2026-11-03",
        clock_in: "2026-11-03 08:00",
        clock_out: "2026-11-03 18:00",
        timezone: "America/Regina",
      },
    })) as ToolCall;
    expect(res.isError).toBe(true);
    expect(res.structuredContent).toEqual({ status: "forbidden" });
    expect(m.dbGetTimeEntryById).not.toHaveBeenCalled();
    expect(m.dbUpdateTimeEntry).not.toHaveBeenCalled();
  });

  it("a member can't approve or deny time off through manage_time_off", async () => {
    asRole("org:member");
    const rpc = await connect("user_sam");
    for (const action of ["approve", "deny"]) {
      const res = (await rpc("tools/call", {
        name: "manage_time_off",
        arguments: { action, request_id: 5 },
      })) as ToolCall;
      expect(res.isError, action).toBe(true);
      expect(res.content[0]?.text).toMatch(/admin/i);
    }
    expect(m.dbReviewTimeOffRequest).not.toHaveBeenCalled();
  });

  it("a member can't run the hours report", async () => {
    asRole("org:member");
    const rpc = await connect("user_sam");
    const res = (await rpc("tools/call", {
      name: "run_hours_report",
      arguments: { start_date: "2026-11-01", end_date: "2026-11-07" },
    })) as ToolCall;
    expect(res.isError).toBe(true);
    expect(res.structuredContent).toEqual({ status: "forbidden" });
  });

  it("a member can't open another member's or everyone's timecard", async () => {
    asRole("org:member");
    const rpc = await connect("user_sam");
    for (const member of ["all", "Pat"]) {
      const res = (await rpc("tools/call", {
        name: "get_weekly_timecard",
        arguments: { member, week_of: "2026-11-03" },
      })) as ToolCall;
      expect(res.isError, member).toBe(true);
    }
  });

  it("an admin's approval from the app goes through manage_time_off", async () => {
    asRole("org:admin");
    m.dbReviewTimeOffRequest.mockResolvedValue({
      id: 5,
      org_id: "org_1",
      user_id: "user_sam",
      request_type: "vacation",
      start_date: "2026-11-05",
      end_date: "2026-11-05",
      hours_per_day: 8,
      note: null,
      status: "approved",
      reviewed_by: "user_admin",
      reviewed_at: null,
    });
    const rpc = await connect("user_admin");
    const res = (await rpc("tools/call", {
      name: "manage_time_off",
      arguments: { action: "approve", request_id: 5 },
    })) as ToolCall;
    expect(res.isError).toBeUndefined();
    expect(res.content[0]?.text).toMatch(/^Approved Sam Lee/);
    expect(m.dbReviewTimeOffRequest).toHaveBeenCalled();
  });

  it("refuses every tool call without a signed-in caller", async () => {
    asRole("org:admin");
    const rpc = await connect("");
    const res = (await rpc("tools/call", {
      name: "get_weekly_timecard",
      arguments: {},
    })) as ToolCall;
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toMatch(/Not signed in/);
  });
});

/*
 * The page itself, run in jsdom through the OpenAI Apps SDK globals
 * (window.openai), which are simpler to stub than a parent frame.
 */
function mountApp(
  view: "timecard" | "hours",
  toolOutput: Record<string, unknown>,
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>,
) {
  const dom = new JSDOM(clockOutAppHtml(view), {
    runScripts: "dangerously",
    beforeParse(window) {
      Object.assign(window, {
        openai: { toolOutput, theme: "dark", callTool },
      });
    },
  });
  return dom.window;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function timecardData(isAdmin: boolean) {
  return {
    organization: { org_id: "org_1", name: "Acme" },
    period: {
      label: "2026-11-02 to 2026-11-08",
      start_date: "2026-11-02",
      end_date: "2026-11-08",
      timezone: "America/Regina",
    },
    viewer: { user_id: isAdmin ? "user_admin" : "user_sam", is_admin: isAdmin },
    scope: isAdmin ? "all" : "member",
    organization_total_hours: 8,
    timecards: [
      {
        user_id: "user_sam",
        name: "Sam <b>Lee</b>",
        total_hours: 8,
        days_worked: 1,
        active_shifts: 0,
        overtime_hours: null,
        time_off_hours: 0,
        time_off: [],
        daily_breakdown: [
          {
            date: "2026-11-03",
            day_of_week: "Tuesday",
            total_hours: 8,
            shifts: [
              {
                id: 11,
                clock_in_local: "2026-11-03 09:00:00 CST",
                clock_out_local: "2026-11-03 17:00:00 CST",
                duration_hours: 8,
                is_active: false,
                skip_lunch: false,
                unpaid_break_minutes: 0,
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("MCP Apps: the timecard page", () => {
  it("renders the grid, escapes names and follows the host theme", () => {
    const win = mountApp("timecard", timecardData(false), vi.fn());
    const doc = win.document;
    expect(doc.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(doc.querySelector("h1")?.textContent).toContain("Sam <b>Lee</b>");
    expect(doc.querySelector("b b")).toBeNull();
    const headers = [...doc.querySelectorAll("th")].map((th) => th.textContent);
    expect(headers).toContain("Tue 11-03");
    expect(headers).toHaveLength(9); // member, 7 days, total
  });

  it("shows members no edit or approve buttons and makes no calls for them", async () => {
    const callTool = vi.fn(async () => ({}));
    const win = mountApp("timecard", timecardData(false), callTool);
    const cell = [...win.document.querySelectorAll("td.cell")].find(
      (td) => td.textContent === "8h 00m",
    ) as HTMLElement;
    cell.click();
    await flush();
    expect(win.document.querySelector(".panel")?.textContent).toContain(
      "09:00 – 17:00",
    );
    const buttons = [...win.document.querySelectorAll("button")].map(
      (b) => b.textContent,
    );
    expect(buttons).not.toContain("Edit");
    expect(buttons).not.toContain("Approve");
    expect(callTool).not.toHaveBeenCalled();
  });

  it("lets admins edit a shift and approve time off through the MCP tools", async () => {
    const pending = {
      request_id: 5,
      user_id: "user_sam",
      member: "Sam Lee",
      type_label: "Vacation",
      start_date: "2026-11-05",
      end_date: "2026-11-05",
      dates: "Nov 5, 2026",
      total_hours: 8,
      note: null,
    };
    const callTool = vi.fn(async (name: string, args: { action?: string }) => {
      if (name === "manage_time_off" && args.action === "list") {
        return { structuredContent: { requests: [pending] } };
      }
      if (name === "get_weekly_timecard") {
        return { structuredContent: timecardData(true) };
      }
      return { content: [{ type: "text", text: "Done." }] };
    });
    const win = mountApp("timecard", timecardData(true), callTool);
    await flush();
    expect(callTool).toHaveBeenCalledWith("manage_time_off", {
      org_id: "org_1",
      action: "list",
      status: "pending",
      start_date: "2026-11-02",
    });

    const doc = win.document;
    const button = (label: string) =>
      [...doc.querySelectorAll("button")].find(
        (b) => b.textContent === label,
      ) as HTMLButtonElement;

    // Edit Tuesday's shift to 08:30–17:15.
    (
      [...doc.querySelectorAll("td.cell")].find(
        (td) => td.textContent === "8h 00m",
      ) as HTMLElement
    ).click();
    button("Edit").click();
    const [clockIn, clockOut] = [
      ...doc.querySelectorAll('input[type="time"]'),
    ] as HTMLInputElement[];
    (clockIn as HTMLInputElement).value = "08:30";
    (clockOut as HTMLInputElement).value = "17:15";
    button("Save").click();
    await flush();
    await flush();
    expect(callTool).toHaveBeenCalledWith("update_time_entry", {
      org_id: "org_1",
      entry_id: 11,
      date: "2026-11-03",
      clock_in: "2026-11-03 08:30",
      clock_out: "2026-11-03 17:15",
      timezone: "America/Regina",
      skip_lunch: false,
    });
    // Then the same timecard is fetched again.
    expect(callTool).toHaveBeenCalledWith("get_weekly_timecard", {
      org_id: "org_1",
      start_date: "2026-11-02",
      end_date: "2026-11-08",
      timezone: "America/Regina",
      member: "all",
    });

    button("Approve").click();
    await flush();
    expect(callTool).toHaveBeenCalledWith("manage_time_off", {
      org_id: "org_1",
      action: "approve",
      request_id: 5,
    });
  });

  it("shows the server's refusal when a change is rejected", async () => {
    const callTool = vi.fn(async (name: string) =>
      name === "update_time_entry"
        ? {
            isError: true,
            content: [{ type: "text", text: "Overlaps another shift." }],
          }
        : { structuredContent: { requests: [] } },
    );
    const win = mountApp("timecard", timecardData(true), callTool);
    const doc = win.document;
    (
      [...doc.querySelectorAll("td.cell")].find(
        (td) => td.textContent === "8h 00m",
      ) as HTMLElement
    ).click();
    (
      [...doc.querySelectorAll("button")].find(
        (b) => b.textContent === "Edit",
      ) as HTMLButtonElement
    ).click();
    (
      [...doc.querySelectorAll("button")].find(
        (b) => b.textContent === "Save",
      ) as HTMLButtonElement
    ).click();
    await flush();
    await flush();
    expect(doc.querySelector(".status.err")?.textContent).toBe(
      "Overlaps another shift.",
    );
  });
});

describe("MCP Apps: the hours report page", () => {
  it("renders a bar and a table row per member", () => {
    const data = {
      ...timecardData(true),
      timecards: undefined,
      hours_are_net_of_breaks: true,
      reports: [
        {
          user_id: "user_sam",
          name: "Sam Lee",
          total_hours: 12.5,
          gross_hours: 13,
          break_deduction_hours: 0.5,
          overtime_hours: 0.5,
          time_off_hours: 8,
          days_worked: 2,
          daily_breakdown: [],
        },
      ],
    };
    const win = mountApp(
      "hours",
      data,
      vi.fn(async () => ({})),
    );
    const doc = win.document;
    expect(doc.querySelector("h1")?.textContent).toBe("Hours report");
    expect(doc.querySelectorAll(".bar")).toHaveLength(1);
    expect(doc.querySelector(".bar i.ot")).not.toBeNull();
    const row = doc.querySelector("tbody tr");
    expect(row?.textContent).toContain("12h 30m");
    expect(row?.textContent).toContain("13h 00m");
    expect(doc.querySelector(".tile span")?.textContent).toBe("Net hours");
  });
});
