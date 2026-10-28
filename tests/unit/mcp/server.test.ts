import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetOrgMemberships = vi.fn();
const mockGetUserOrgMemberships = vi.fn();

vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: vi.fn(async () => ({
    users: {
      getOrganizationMembershipList: mockGetUserOrgMemberships,
    },
    organizations: {
      getOrganizationMembershipList: mockGetOrgMemberships,
    },
  })),
}));

const mockDbFindOverlapping = vi.fn();
const mockDbInsertTimeEntry = vi.fn();
const mockDbUpdateTimeEntry = vi.fn();
const mockDbGetTimeEntryById = vi.fn();
const mockDbGetActiveEntry = vi.fn();
const mockDbClockInAt = vi.fn();
const mockDbClockOutAt = vi.fn();
const mockInvalidateTimeEntryCache = vi.fn();
const mockInvalidateReportingSettingsCache = vi.fn();

vi.mock("@/mcp/db", () => ({
  dbClockInAt: (...args: unknown[]) => mockDbClockInAt(...args),
  dbClockOutAt: (...args: unknown[]) => mockDbClockOutAt(...args),
  dbDeleteTimeEntry: vi.fn(),
  dbFindOverlappingTimeEntries: (...args: unknown[]) =>
    mockDbFindOverlapping(...args),
  dbGetActiveEntry: (...args: unknown[]) => mockDbGetActiveEntry(...args),
  dbGetOrgActiveEntries: vi.fn(async () => []),
  dbGetOrgTimeEntries: vi.fn(async () => []),
  dbGetReportingSettings: vi.fn(async () => undefined),
  dbGetTimeEntries: vi.fn(async () => []),
  dbGetTimeEntryById: (...args: unknown[]) => mockDbGetTimeEntryById(...args),
  dbInsertTimeEntry: (...args: unknown[]) => mockDbInsertTimeEntry(...args),
  dbUpdateReportingSettings: vi.fn(),
  dbUpdateTimeEntry: (...args: unknown[]) => mockDbUpdateTimeEntry(...args),
  invalidateReportingSettingsCache: (...args: unknown[]) =>
    mockInvalidateReportingSettingsCache(...args),
  invalidateTimeEntryCache: (...args: unknown[]) =>
    mockInvalidateTimeEntryCache(...args),
}));

vi.mock("@/lib/utils-clerk", () => ({
  isOverMemberShipLimit: vi.fn(async () => false),
}));

vi.mock("@/lib/reports", () => ({
  sendWeeklyReports: vi.fn(async () => true),
}));

import { MCP_INSTRUCTIONS } from "@/mcp/instructions";
import {
  callerFrom,
  registerClockOutTools,
  SERVER_INFO,
  SERVER_OPTIONS,
} from "@/mcp/server";
import { addTimeEntryTool, updateTimeEntryTool } from "@/mcp/tools";

type Registered = {
  name: string;
  config: {
    description?: string;
    inputSchema?: unknown;
    annotations?: Record<string, boolean>;
  };
};

function registered() {
  const tools: Registered[] = [];
  const server = {
    registerTool: (name: string, config: Registered["config"]) => {
      tools.push({ name, config });
    },
    server: { getClientVersion: () => undefined },
  };
  registerClockOutTools(server as never);
  return new Map(tools.map((t) => [t.name, t.config]));
}

const tools = registered();

describe("Clock Out MCP server", () => {
  it("exposes all expected tools", () => {
    expect([...tools.keys()].sort()).toEqual([
      "add_time_entry",
      "clock_in",
      "clock_out",
      "delete_time_entry",
      "get_clock_status",
      "get_weekly_timecard",
      "list_members",
      "list_organizations",
      "list_time_entries",
      "manage_reporting_settings",
      "update_time_entry",
      "who_is_working",
    ]);
  });

  it("advertises Clock Out's own icons and websiteUrl in SERVER_INFO", () => {
    expect(SERVER_OPTIONS.serverInfo).toBe(SERVER_INFO);
    expect(SERVER_INFO.name).toBe("clock-out");
    expect(SERVER_INFO.websiteUrl).toContain("clockout.patmac.ca");
    expect(SERVER_INFO.icons.length).toBeGreaterThanOrEqual(2);
    expect(SERVER_INFO.icons[0]?.src).toContain("clockout.patmac.ca/icon.svg");
  });

  it("marks read-only tools with readOnlyHint: true", () => {
    for (const name of [
      "list_organizations",
      "list_members",
      "who_is_working",
      "get_clock_status",
      "list_time_entries",
      "get_weekly_timecard",
    ]) {
      expect(tools.get(name)?.annotations?.readOnlyHint, name).toBe(true);
    }
  });

  it("marks update_time_entry and delete_time_entry as destructive", () => {
    for (const name of ["update_time_entry", "delete_time_entry"]) {
      expect(tools.get(name)?.annotations?.destructiveHint, name).toBe(true);
      expect(tools.get(name)?.description, name).toMatch(/explicitly asks/);
    }
  });

  it("instructs AI clients to prevent double/overlapping times and handle timecard images", () => {
    expect(MCP_INSTRUCTIONS).toMatch(
      /Never create duplicate or overlapping shifts/,
    );
    expect(MCP_INSTRUCTIONS).toMatch(/Photos \/ Images of Timecards/);
  });

  it("extracts callerFrom verified auth", () => {
    expect(
      callerFrom({
        token: "t",
        clientId: "c",
        scopes: [],
        extra: { userId: "user_123" },
      }),
    ).toEqual({ userId: "user_123", client: null });
    expect(callerFrom(undefined)).toBeNull();
  });
});

describe("Double / overlapping time prevention & cache invalidation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUserOrgMemberships.mockResolvedValue({
      data: [
        {
          role: "org:admin",
          organization: {
            id: "org_1",
            name: "PatMac Org",
            slug: "patmac-org",
            membersCount: 2,
          },
        },
      ],
    });
    mockGetOrgMemberships.mockResolvedValue({
      data: [
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
            userId: "user_worker",
            firstName: "Alex",
            lastName: "Smith",
            identifier: "alex@patmac.ca",
          },
        },
      ],
    });
  });

  it("rejects duplicate/overlapping shifts within the same image/batch add_time_entry call", async () => {
    const res = await addTimeEntryTool(
      { userId: "user_admin", client: "Claude" },
      {
        member: "Alex",
        timezone: "America/Edmonton",
        entries: [
          { date: "2026-10-26", clock_in: "09:00", clock_out: "17:00" },
          { date: "2026-10-26", clock_in: "13:00", clock_out: "18:00" },
        ],
      },
    );

    expect(res.isError).toBe(true);
    expect(res.data.status).toBe("duplicate_or_overlapping_in_batch");
    expect(mockDbInsertTimeEntry).not.toHaveBeenCalled();
  });

  it("rejects add_time_entry when a shift overlaps with an existing database entry", async () => {
    mockDbFindOverlapping.mockResolvedValueOnce([
      {
        id: 42,
        user_id: "user_worker",
        org_id: "org_1",
        clock_in: new Date("2026-10-26T15:00:00.000Z"),
        clock_out: new Date("2026-10-26T23:00:00.000Z"),
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);

    const res = await addTimeEntryTool(
      { userId: "user_admin", client: "Gemini" },
      {
        member: "Alex",
        date: "2026-10-26",
        clock_in: "09:00",
        clock_out: "17:00",
        timezone: "America/Edmonton",
      },
    );

    expect(res.isError).toBe(true);
    expect(res.data.status).toBe("overlapping_existing_entries");
    expect(mockDbInsertTimeEntry).not.toHaveBeenCalled();
  });

  it("inserts non-overlapping shifts and invalidates cache immediately", async () => {
    mockDbFindOverlapping.mockResolvedValue([]);
    mockDbInsertTimeEntry.mockImplementation(
      async (userId: string, orgId: string, clockIn: Date, clockOut: Date) => ({
        id: 99,
        user_id: userId,
        org_id: orgId,
        clock_in: clockIn,
        clock_out: clockOut,
        created_at: new Date(),
        updated_at: new Date(),
      }),
    );

    const res = await addTimeEntryTool(
      { userId: "user_admin", client: "Muse" },
      {
        member: "Alex",
        date: "2026-10-27",
        clock_in: "09:00",
        clock_out: "17:00",
        timezone: "America/Edmonton",
      },
    );

    expect(res.isError).toBeUndefined();
    expect(res.data.status).toBe("added");
    expect(mockDbInsertTimeEntry).toHaveBeenCalledTimes(1);
    expect(mockInvalidateTimeEntryCache).toHaveBeenCalledWith(
      "user_worker",
      "org_1",
    );
  });

  it("rejects update_time_entry when the edited hours overlap another shift", async () => {
    mockDbGetTimeEntryById.mockResolvedValueOnce({
      id: 10,
      user_id: "user_worker",
      org_id: "org_1",
      clock_in: new Date("2026-10-27T15:00:00.000Z"),
      clock_out: new Date("2026-10-27T19:00:00.000Z"),
      created_at: new Date(),
      updated_at: new Date(),
    });
    mockDbFindOverlapping.mockResolvedValueOnce([
      {
        id: 11,
        user_id: "user_worker",
        org_id: "org_1",
        clock_in: new Date("2026-10-27T20:00:00.000Z"),
        clock_out: new Date("2026-10-27T23:00:00.000Z"),
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);

    const res = await updateTimeEntryTool(
      { userId: "user_admin", client: "Claude" },
      {
        entry_id: 10,
        date: "2026-10-27",
        clock_in: "09:00",
        clock_out: "16:00",
        timezone: "America/Edmonton",
      },
    );

    expect(res.isError).toBe(true);
    expect(res.data.status).toBe("overlapping_existing_entries");
    expect(mockDbUpdateTimeEntry).not.toHaveBeenCalled();
  });
});
