import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getUserOrgMemberships: vi.fn(),
  getOrgMemberships: vi.fn(),
  dbGetOrgTimeEntries: vi.fn(async (..._args: unknown[]) => [] as unknown[]),
  dbGetTimeEntries: vi.fn(async (..._args: unknown[]) => [] as unknown[]),
  dbGetBreakSettings: vi.fn(
    async (..._args: unknown[]) => undefined as unknown,
  ),
  dbGetSites: vi.fn(async (..._args: unknown[]) => [] as unknown[]),
  dbGetAlertSettings: vi.fn(
    async (..._args: unknown[]) => undefined as unknown,
  ),
  dbGetTimeEntryById: vi.fn(),
  dbFindOverlappingTimeEntries: vi.fn(
    async (..._args: unknown[]) => [] as unknown[],
  ),
  dbUpdateTimeEntry: vi.fn(),
  invalidateTimeEntryCache: vi.fn(),
  dbGetScheduledShifts: vi.fn(async (..._args: unknown[]) => [] as unknown[]),
  dbGetTimeOffRequests: vi.fn(async (..._args: unknown[]) => [] as unknown[]),
  orgHasPlanFeature: vi.fn(async (..._args: unknown[]) => false),
}));

vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: vi.fn(async () => ({
    users: { getOrganizationMembershipList: m.getUserOrgMemberships },
    organizations: { getOrganizationMembershipList: m.getOrgMemberships },
  })),
}));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
vi.mock("@/mcp/db", () => ({
  dbGetOrgTimeEntries: m.dbGetOrgTimeEntries,
  dbGetTimeEntries: m.dbGetTimeEntries,
  dbGetBreakSettings: m.dbGetBreakSettings,
  dbGetSites: m.dbGetSites,
  dbGetTimeEntryById: m.dbGetTimeEntryById,
  dbFindOverlappingTimeEntries: m.dbFindOverlappingTimeEntries,
  dbUpdateTimeEntry: m.dbUpdateTimeEntry,
  invalidateTimeEntryCache: m.invalidateTimeEntryCache,
}));
vi.mock("@/lib/alerts-db", () => ({
  dbGetAlertSettings: m.dbGetAlertSettings,
}));
vi.mock("@/lib/db", () => ({
  dbGetScheduledShifts: m.dbGetScheduledShifts,
  dbGetTimeOffRequests: m.dbGetTimeOffRequests,
}));
vi.mock("@/lib/plan-features", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/plan-features")>()),
  orgHasPlanFeature: m.orgHasPlanFeature,
}));
vi.mock("@/lib/reports", () => ({}));
vi.mock("@/lib/utils-clerk", () => ({}));
vi.mock("@/lib/schedule-notify", () => ({}));
vi.mock("@/lib/notify", () => ({}));
vi.mock("@/lib/geoapify", () => ({}));

import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import type { AuditFinding } from "@/lib/audit-timesheets";
import {
  auditTimesheetsInputSchema,
  auditTimesheetsTool,
  MAX_AUDIT_DAYS,
} from "@/mcp/audit-tools";
import { MCP_INSTRUCTIONS } from "@/mcp/instructions";
import {
  registerClockOutTools,
  SERVER_INFO,
  SERVER_OPTIONS,
} from "@/mcp/server";
import { updateTimeEntryInputSchema, updateTimeEntryTool } from "@/mcp/tools";

const admin = { userId: "user_admin", client: "Claude" };

const adminMembership = {
  role: "org:admin",
  organization: { id: "org_1", name: "PatMac Org", slug: "patmac-org" },
};

const members = [
  {
    role: "org:admin",
    publicUserData: {
      userId: "user_admin",
      firstName: "Patrick",
      lastName: "MacDonald",
      identifier: "patrick@patmac.ca",
    },
  },
  {
    role: "org:member",
    publicUserData: {
      userId: "user_alex",
      firstName: "Alex",
      lastName: "Smith",
      identifier: "alex@patmac.ca",
    },
  },
];

/** Alex forgot to clock out on Oct 6 (09:00 local, still open). */
const openEntry = {
  id: 41,
  user_id: "user_alex",
  org_id: "org_1",
  clock_in: new Date("2026-10-06T15:00:00.000Z"),
  clock_out: null,
  skip_lunch: false,
  breaks: [],
  created_at: new Date("2026-10-06T15:00:00.000Z"),
  updated_at: new Date("2026-10-06T15:00:00.000Z"),
};

/** A usual 8h day with lunch, so the estimate is 8h. */
const usualEntry = {
  id: 40,
  user_id: "user_alex",
  org_id: "org_1",
  clock_in: new Date("2026-10-05T15:00:00.000Z"),
  clock_out: new Date("2026-10-05T23:00:00.000Z"),
  skip_lunch: false,
  breaks: [
    {
      id: 1,
      time_entry_id: 40,
      break_type: "unpaid_meal",
      break_start: new Date("2026-10-05T19:00:00.000Z"),
      break_end: new Date("2026-10-05T19:30:00.000Z"),
      created_at: new Date("2026-10-05T19:00:00.000Z"),
      updated_at: new Date("2026-10-05T19:30:00.000Z"),
    },
  ],
  created_at: new Date("2026-10-05T15:00:00.000Z"),
  updated_at: new Date("2026-10-05T23:00:00.000Z"),
};

/** Another organization's row that a misbehaving query might return. */
const foreignEntry = {
  ...openEntry,
  id: 99,
  org_id: "org_other",
  user_id: "user_stranger",
};

const range = { start_date: "2026-10-05", end_date: "2026-10-09" };

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-10T18:00:00.000Z"));
  m.getUserOrgMemberships.mockResolvedValue({ data: [adminMembership] });
  m.getOrgMemberships.mockResolvedValue({ data: members });
  m.dbGetOrgTimeEntries.mockResolvedValue([
    usualEntry,
    openEntry,
    foreignEntry,
  ]);
  m.dbGetTimeEntries.mockResolvedValue([usualEntry, openEntry]);
  m.dbGetBreakSettings.mockResolvedValue(undefined);
  m.dbGetSites.mockResolvedValue([]);
  m.dbGetAlertSettings.mockResolvedValue(undefined);
  m.dbFindOverlappingTimeEntries.mockResolvedValue([]);
  m.orgHasPlanFeature.mockResolvedValue(false);
  m.dbGetScheduledShifts.mockResolvedValue([]);
  m.dbGetTimeOffRequests.mockResolvedValue([]);
});

describe("audit_timesheets tool", () => {
  it("rejects regular members", async () => {
    m.getUserOrgMemberships.mockResolvedValue({
      data: [{ ...adminMembership, role: "org:member" }],
    });
    const res = await auditTimesheetsTool(
      { userId: "user_alex", client: "Claude" },
      range,
    );
    expect(res.isError).toBe(true);
    expect(res.data.status).toBe("forbidden");
    expect(m.dbGetOrgTimeEntries).not.toHaveBeenCalled();
    expect(m.dbGetTimeEntries).not.toHaveBeenCalled();
  });

  it("passes on an organization resolution problem", async () => {
    m.getUserOrgMemberships.mockResolvedValue({ data: [] });
    const res = await auditTimesheetsTool(admin, range);
    expect(res.isError).toBe(true);
    expect(m.dbGetOrgTimeEntries).not.toHaveBeenCalled();
  });

  it("audits only the caller's organization and drops rows from any other org", async () => {
    const res = await auditTimesheetsTool(admin, {
      ...range,
      timezone: "America/Edmonton",
    });
    expect(res.isError).toBeUndefined();
    expect(m.dbGetOrgTimeEntries).toHaveBeenCalledWith(
      "org_1",
      new Date("2026-10-05T06:00:00.000Z"),
      new Date("2026-10-10T05:59:59.999Z"),
    );
    expect(m.dbGetBreakSettings).toHaveBeenCalledWith("org_1");
    expect(m.dbGetSites).toHaveBeenCalledWith("org_1");
    expect(m.dbGetAlertSettings).toHaveBeenCalledWith("org_1");
    const findings = res.data.findings as AuditFinding[];
    expect(res.data.entries_audited).toBe(2);
    expect(findings.flatMap((f) => f.entry_ids)).not.toContain(99);
    expect(findings.every((f) => f.employee.user_id !== "user_stranger")).toBe(
      true,
    );
    expect(findings.map((f) => f.type)).toEqual(["missed_clock_out"]);
    expect(findings[0]).toMatchObject({
      employee: { user_id: "user_alex", name: "Alex Smith" },
      entry_ids: [41],
      date: "2026-10-06",
      suggested_fix: {
        org_id: "org_1",
        entry_id: 41,
        clock_out: "2026-10-06T23:00:00.000Z",
        timezone: "America/Edmonton",
      },
    });
    expect(res.summary).toMatch(/Found 1 timesheet issue for PatMac Org/);
    expect(res.summary).toMatch(/Suggested fix \(update_time_entry\)/);
  });

  it("audits one member when asked", async () => {
    const res = await auditTimesheetsTool(admin, { ...range, member: "Alex" });
    expect(m.dbGetTimeEntries).toHaveBeenCalledWith(
      "user_alex",
      "org_1",
      expect.any(Date),
      expect.any(Date),
    );
    expect(m.dbGetOrgTimeEntries).not.toHaveBeenCalled();
    expect(res.data.member).toEqual({
      user_id: "user_alex",
      name: "Alex Smith",
    });
  });

  it("reports an unknown member", async () => {
    const res = await auditTimesheetsTool(admin, { ...range, member: "Zed" });
    expect(res.isError).toBe(true);
    expect(m.dbGetTimeEntries).not.toHaveBeenCalled();
  });

  it("validates the date range", async () => {
    const backwards = await auditTimesheetsTool(admin, {
      start_date: "2026-10-09",
      end_date: "2026-10-01",
    });
    expect(backwards.data.status).toBe("invalid_dates");
    const bogus = await auditTimesheetsTool(admin, {
      start_date: "2026-13-45",
      end_date: "2026-10-01",
    });
    expect(bogus.data.status).toBe("invalid_dates");
    const tooLong = await auditTimesheetsTool(admin, {
      start_date: "2024-01-01",
      end_date: "2026-01-01",
    });
    expect(tooLong.data.status).toBe("range_too_long");
    expect(tooLong.summary).toContain(String(MAX_AUDIT_DAYS));
  });

  it("returns a clean result when nothing is wrong", async () => {
    m.dbGetOrgTimeEntries.mockResolvedValue([usualEntry]);
    const res = await auditTimesheetsTool(admin, range);
    expect(res.summary).toMatch(/No timesheet problems found/);
    expect(res.data.findings).toEqual([]);
    expect(res.data.counts).toMatchObject({ total: 0 });
  });

  it("passes thresholds, checks, sites, break and alert settings through", async () => {
    m.dbGetBreakSettings.mockResolvedValue({
      org_id: "org_1",
      dock_lunch: true,
      lunch_duration_minutes: 30,
      lunch_min_shift_hours: 6,
    });
    m.dbGetSites.mockResolvedValue([
      { name: "Depot", latitude: 51, longitude: -114, radius_meters: 100 },
    ]);
    const autoClosed = {
      ...usualEntry,
      id: 50,
      clock_in: new Date("2026-10-07T15:00:00.000Z"),
      clock_out: new Date("2026-10-08T07:00:00.000Z"),
      updated_at: new Date("2026-10-08T07:05:00.000Z"),
      breaks: [],
    };
    m.dbGetOrgTimeEntries.mockResolvedValue([usualEntry, autoClosed]);
    m.dbGetAlertSettings.mockResolvedValue({
      auto_clock_out_enabled: true,
      auto_clock_out_hours: 16,
    });
    const res = await auditTimesheetsTool(admin, {
      ...range,
      checks: ["missed_clock_out", "long_shift"],
      long_shift_hours: 10,
      edit_grace_minutes: 1,
    });
    expect(res.data.thresholds).toMatchObject({
      long_shift_hours: 10,
      edit_grace_minutes: 1,
      meal_break_after_hours: 6,
    });
    const findings = res.data.findings as AuditFinding[];
    expect(findings.map((f) => [f.type, f.entry_ids[0]])).toEqual([
      ["missed_clock_out", 50],
    ]);
    const checks = res.data.checks as { type: string; status: string }[];
    expect(checks.find((c) => c.type === "punch_far_from_site")?.status).toBe(
      "skipped",
    );
  });

  it("keeps working when the optional settings lookups fail", async () => {
    m.dbGetBreakSettings.mockRejectedValue(new Error("db down"));
    m.dbGetSites.mockRejectedValue(new Error("db down"));
    m.dbGetAlertSettings.mockRejectedValue(new Error("db down"));
    const res = await auditTimesheetsTool(admin, range);
    expect(res.data.status).toBe("ok");
    expect((res.data.findings as AuditFinding[]).length).toBe(1);
  });
});

describe("audit_timesheets: late arrivals and no-shows", () => {
  /** Alex was scheduled 09:00–17:00 MDT on Oct 5 (clocked in on time) and Oct 7 (never came). */
  const shiftOct5 = {
    id: 7,
    org_id: "org_1",
    user_id: "user_alex",
    shift_start: new Date("2026-10-05T15:00:00.000Z"),
    shift_end: new Date("2026-10-05T23:00:00.000Z"),
    note: null,
    created_by: "user_admin",
  };
  const shiftOct7 = {
    ...shiftOct5,
    id: 8,
    shift_start: new Date("2026-10-07T15:00:00.000Z"),
    shift_end: new Date("2026-10-07T23:00:00.000Z"),
  };
  beforeEach(() => {
    // Only the Oct 5 shift: an open entry would cover later shifts too.
    m.dbGetOrgTimeEntries.mockResolvedValue([usualEntry]);
    m.dbGetTimeEntries.mockResolvedValue([usualEntry]);
  });

  const scheduleOnly = {
    ...range,
    timezone: "America/Edmonton",
    checks: ["late_arrival", "no_show"] as ("late_arrival" | "no_show")[],
  };

  it("skips them without loading anything when the plan has no scheduling", async () => {
    const res = await auditTimesheetsTool(admin, scheduleOnly);
    expect(m.orgHasPlanFeature).toHaveBeenCalledWith("org_1", "scheduling");
    expect(m.dbGetScheduledShifts).not.toHaveBeenCalled();
    expect(res.data.findings).toEqual([]);
    const checks = res.data.checks as { type: string; status: string }[];
    expect(checks.find((c) => c.type === "no_show")?.status).toBe("skipped");
  });

  it("doesn't check the plan when neither check is requested", async () => {
    await auditTimesheetsTool(admin, { ...range, checks: ["long_shift"] });
    expect(m.orgHasPlanFeature).not.toHaveBeenCalled();
  });

  it("loads the period's schedule, the day before's clock-ins and approved time off", async () => {
    m.orgHasPlanFeature.mockResolvedValue(true);
    m.dbGetScheduledShifts.mockResolvedValue([
      shiftOct5,
      shiftOct7,
      { ...shiftOct7, id: 9, org_id: "org_other" },
    ]);
    const res = await auditTimesheetsTool(admin, scheduleOnly);
    expect(m.dbGetScheduledShifts).toHaveBeenCalledWith(
      "org_1",
      null,
      new Date("2026-10-05T06:00:00.000Z"),
      new Date("2026-10-10T06:00:00.000Z"),
    );
    expect(m.dbGetOrgTimeEntries).toHaveBeenCalledWith(
      "org_1",
      new Date("2026-10-04T06:00:00.000Z"),
      new Date("2026-10-05T06:00:00.000Z"),
    );
    expect(m.dbGetTimeOffRequests).toHaveBeenCalledWith(
      "org_1",
      null,
      "2026-10-05",
    );
    const findings = res.data.findings as AuditFinding[];
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      type: "no_show",
      scheduled_shift_id: 8,
      entry_ids: [],
      employee: { user_id: "user_alex", name: "Alex Smith" },
      date: "2026-10-07",
    });
    expect(res.summary).toContain(
      "[high] no_show — Alex Smith, 2026-10-07 (scheduled shift #8):",
    );
  });

  it("skips no-shows on approved time off and audits one member's schedule", async () => {
    m.orgHasPlanFeature.mockResolvedValue(true);
    m.dbGetScheduledShifts.mockResolvedValue([shiftOct7]);
    m.dbGetTimeOffRequests.mockResolvedValue([
      {
        org_id: "org_1",
        user_id: "user_alex",
        status: "approved",
        start_date: "2026-10-07",
        end_date: "2026-10-07",
      },
    ]);
    const res = await auditTimesheetsTool(admin, {
      ...scheduleOnly,
      member: "Alex",
    });
    expect(m.dbGetScheduledShifts).toHaveBeenCalledWith(
      "org_1",
      "user_alex",
      expect.any(Date),
      expect.any(Date),
    );
    expect(res.data.findings).toEqual([]);

    // A pending request doesn't excuse it.
    m.dbGetTimeOffRequests.mockResolvedValue([
      {
        org_id: "org_1",
        user_id: "user_alex",
        status: "pending",
        start_date: "2026-10-07",
        end_date: "2026-10-07",
      },
    ]);
    const again = await auditTimesheetsTool(admin, scheduleOnly);
    expect((again.data.findings as AuditFinding[]).map((f) => f.type)).toEqual([
      "no_show",
    ]);
  });

  it("flags a late arrival with its entry and passes late_grace_minutes through", async () => {
    m.orgHasPlanFeature.mockResolvedValue(true);
    m.dbGetScheduledShifts.mockResolvedValue([
      { ...shiftOct5, shift_start: new Date("2026-10-05T14:30:00.000Z") },
    ]);
    const res = await auditTimesheetsTool(admin, {
      ...scheduleOnly,
      checks: ["late_arrival"],
    });
    const findings = res.data.findings as AuditFinding[];
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      type: "late_arrival",
      severity: "medium",
      entry_ids: [40],
      scheduled_shift_id: 7,
    });
    expect(res.summary).toContain("(entry #40, scheduled shift #7)");

    const lenient = await auditTimesheetsTool(admin, {
      ...scheduleOnly,
      checks: ["late_arrival"],
      late_grace_minutes: 45,
    });
    expect(lenient.data.findings).toEqual([]);
    expect(
      (lenient.data.thresholds as { late_grace_minutes: number })
        .late_grace_minutes,
    ).toBe(45);
  });
});

describe("audit_timesheets → update_time_entry round trip", () => {
  it("produces a suggested_fix that update_time_entry's schema accepts unchanged and that applies", async () => {
    const res = await auditTimesheetsTool(admin, range);
    const fix = (res.data.findings as AuditFinding[])[0]?.suggested_fix;
    expect(fix).toBeTruthy();

    // Every key is a real update_time_entry parameter and the values validate.
    const allowed = Object.keys(updateTimeEntryInputSchema.shape);
    for (const key of Object.keys(fix as object)) {
      expect(allowed, key).toContain(key);
    }
    const parsed = updateTimeEntryInputSchema.strict().parse(fix);
    expect(parsed).toEqual(fix);

    m.dbGetTimeEntryById.mockResolvedValue(openEntry);
    m.dbUpdateTimeEntry.mockImplementation(
      async (id: number, clockIn: Date, clockOut: Date | null) => ({
        ...openEntry,
        id,
        clock_in: clockIn,
        clock_out: clockOut,
      }),
    );
    const applied = await updateTimeEntryTool(admin, parsed);
    expect(applied.isError).toBeUndefined();
    expect(applied.data.status).toBe("updated");
    expect(m.dbGetTimeEntryById).toHaveBeenCalledWith(41, "org_1");
    expect(m.dbUpdateTimeEntry).toHaveBeenCalledWith(
      41,
      new Date("2026-10-06T15:00:00.000Z"),
      new Date("2026-10-06T23:00:00.000Z"),
      "org_1",
      true,
    );
  });

  it("produces skip_lunch and overlap fixes the schema accepts", async () => {
    m.dbGetBreakSettings.mockResolvedValue({
      org_id: "org_1",
      dock_lunch: true,
      lunch_duration_minutes: 30,
      lunch_min_shift_hours: 5,
    });
    const skipped = {
      ...usualEntry,
      id: 60,
      clock_in: new Date("2026-10-07T15:00:00.000Z"),
      clock_out: new Date("2026-10-07T23:00:00.000Z"),
      updated_at: new Date("2026-10-07T23:00:00.000Z"),
      created_at: new Date("2026-10-07T15:00:00.000Z"),
      skip_lunch: true,
      breaks: [],
    };
    const overlap = {
      ...skipped,
      id: 61,
      skip_lunch: false,
      clock_in: new Date("2026-10-07T21:00:00.000Z"),
      clock_out: new Date("2026-10-08T01:00:00.000Z"),
      created_at: new Date("2026-10-07T21:00:00.000Z"),
      updated_at: new Date("2026-10-08T01:00:00.000Z"),
    };
    m.dbGetOrgTimeEntries.mockResolvedValue([usualEntry, skipped, overlap]);
    const res = await auditTimesheetsTool(admin, range);
    const findings = res.data.findings as AuditFinding[];
    const fixes = findings
      .map((f) => f.suggested_fix)
      .filter((f): f is NonNullable<typeof f> => f !== null);
    expect(fixes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entry_id: 60, skip_lunch: false }),
        expect.objectContaining({
          entry_id: 60,
          clock_out: "2026-10-07T21:00:00.000Z",
        }),
      ]),
    );
    for (const fix of fixes) {
      expect(() =>
        updateTimeEntryInputSchema.strict().parse(fix),
      ).not.toThrow();
    }
  });
});

describe("audit_timesheets over the MCP protocol", () => {
  type Message = {
    id?: number;
    result?: Record<string, unknown>;
    error?: unknown;
  };

  async function connect() {
    const server = new McpServer(SERVER_INFO, SERVER_OPTIONS);
    registerClockOutTools(server);
    const [client, serverSide] = InMemoryTransport.createLinkedPair();
    const received: Message[] = [];
    client.onmessage = (msg) => {
      received.push(msg as Message);
    };
    await server.connect(serverSide);
    await client.start();

    let nextId = 1;
    const auth = {
      token: "t",
      clientId: "c",
      scopes: [],
      extra: { userId: "user_admin" },
    };
    const request = async (
      method: string,
      params: Record<string, unknown> = {},
    ) => {
      const id = nextId++;
      await client.send(
        { jsonrpc: "2.0", id, method, params },
        { authInfo: auth },
      );
      await vi.waitFor(() => {
        if (!received.some((r) => r.id === id)) throw new Error("waiting");
      });
      return received.find((r) => r.id === id) as Message;
    };

    const init = await request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "vitest", version: "1.0.0" },
    });
    expect(init.error).toBeUndefined();
    await client.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    return { request, close: () => server.close() };
  }

  it("lists audit_timesheets as a read-only tool with its input schema", async () => {
    const { request, close } = await connect();
    const res = await request("tools/list");
    const tools = res.result?.tools as {
      name: string;
      description: string;
      inputSchema: { properties: Record<string, unknown>; required?: string[] };
      annotations?: Record<string, boolean>;
    }[];
    const audit = tools.find((t) => t.name === "audit_timesheets");
    expect(audit).toBeDefined();
    expect(audit?.annotations?.readOnlyHint).toBe(true);
    expect(audit?.description).toMatch(/update_time_entry/);
    expect(audit?.inputSchema.required).toEqual(
      expect.arrayContaining(["start_date", "end_date"]),
    );
    expect(Object.keys(audit?.inputSchema.properties ?? {})).toEqual(
      expect.arrayContaining([
        "member",
        "checks",
        "long_shift_hours",
        "meal_break_after_hours",
        "meal_break_min_minutes",
        "max_distance_meters",
      ]),
    );
    await close();
  });

  it("calls audit_timesheets and then applies a finding's fix with update_time_entry", async () => {
    const { request, close } = await connect();
    const res = await request("tools/call", {
      name: "audit_timesheets",
      arguments: { ...range, timezone: "America/Edmonton" },
    });
    expect(res.error).toBeUndefined();
    const result = res.result as {
      content: { type: string; text: string }[];
      structuredContent: { status: string; findings: AuditFinding[] };
      isError?: boolean;
    };
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.type).toBe("text");
    expect(result.content[0]?.text).toMatch(/Found 1 timesheet issue/);
    expect(JSON.parse(result.content[1]?.text ?? "{}")).toEqual(
      JSON.parse(JSON.stringify(result.structuredContent)),
    );
    expect(result.structuredContent.status).toBe("ok");
    const fix = result.structuredContent.findings[0]?.suggested_fix;
    expect(fix).toMatchObject({ entry_id: 41 });

    m.dbGetTimeEntryById.mockResolvedValue(openEntry);
    m.dbUpdateTimeEntry.mockImplementation(
      async (id: number, clockIn: Date, clockOut: Date | null) => ({
        ...openEntry,
        id,
        clock_in: clockIn,
        clock_out: clockOut,
      }),
    );
    const applied = await request("tools/call", {
      name: "update_time_entry",
      arguments: fix,
    });
    const appliedResult = applied.result as {
      structuredContent: { status: string };
      isError?: boolean;
    };
    expect(appliedResult.isError).toBeUndefined();
    expect(appliedResult.structuredContent.status).toBe("updated");
    expect(m.dbUpdateTimeEntry).toHaveBeenCalledWith(
      41,
      expect.any(Date),
      new Date("2026-10-06T23:00:00.000Z"),
      "org_1",
      true,
    );
    await close();
  });

  it("rejects a member caller over the protocol", async () => {
    m.getUserOrgMemberships.mockResolvedValue({
      data: [{ ...adminMembership, role: "org:member" }],
    });
    const { request, close } = await connect();
    const res = await request("tools/call", {
      name: "audit_timesheets",
      arguments: range,
    });
    const result = res.result as {
      isError?: boolean;
      structuredContent: { status: string };
    };
    expect(result.isError).toBe(true);
    expect(result.structuredContent.status).toBe("forbidden");
    await close();
  });

  it("rejects input that fails the schema", async () => {
    const { request, close } = await connect();
    const res = await request("tools/call", {
      name: "audit_timesheets",
      arguments: { start_date: "Oct 1", end_date: "2026-10-09" },
    });
    const result = res.result as { isError?: boolean } | undefined;
    expect(result?.isError ?? Boolean(res.error)).toBe(true);
    expect(m.dbGetOrgTimeEntries).not.toHaveBeenCalled();
    await close();
  });
});

describe("audit_timesheets schema and instructions", () => {
  it("requires the date range and bounds thresholds", () => {
    expect(() => auditTimesheetsInputSchema.parse({})).toThrow();
    expect(() =>
      auditTimesheetsInputSchema.parse({ ...range, long_shift_hours: -1 }),
    ).toThrow();
    expect(() =>
      auditTimesheetsInputSchema.parse({ ...range, checks: ["nope"] }),
    ).toThrow();
    expect(
      auditTimesheetsInputSchema.parse({
        ...range,
        checks: ["missed_meal_break"],
        max_distance_meters: 500,
      }),
    ).toMatchObject({ checks: ["missed_meal_break"] });
  });

  it("documents the audit → apply-fix workflow", () => {
    expect(MCP_INSTRUCTIONS).toMatch(/Timesheet Audit → Apply Fixes/);
    expect(MCP_INSTRUCTIONS).toMatch(/audit_timesheets/);
    expect(MCP_INSTRUCTIONS).toMatch(
      /call update_time_entry with the finding's suggested_fix object exactly as given/,
    );
    expect(MCP_INSTRUCTIONS).toMatch(/after the admin confirms/);
  });
});
