import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetOrgMemberships = vi.fn();
const mockGetUserOrgMemberships = vi.fn();
const mockCreateOrganizationInvitation = vi.fn();
const mockGetOrganizationInvitationList = vi.fn();
const mockRevokeOrganizationInvitation = vi.fn();

vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: vi.fn(async () => ({
    users: {
      getOrganizationMembershipList: mockGetUserOrgMemberships,
    },
    organizations: {
      getOrganizationMembershipList: mockGetOrgMemberships,
      createOrganizationInvitation: mockCreateOrganizationInvitation,
      getOrganizationInvitationList: mockGetOrganizationInvitationList,
      revokeOrganizationInvitation: mockRevokeOrganizationInvitation,
    },
  })),
}));

const mockDbFindOverlapping = vi.fn();
const mockDbInsertTimeEntry = vi.fn();
const mockDbUpdateTimeEntry = vi.fn();
const mockDbGetTimeEntryById = vi.fn();
const mockDbGetActiveEntry = vi.fn();
const mockDbGetOrgTimeEntries = vi.fn(async () => []);
const mockDbGetTimeEntries = vi.fn(async () => []);
const mockDbClockInAt = vi.fn();
const mockDbClockOutAt = vi.fn();
const mockInvalidateTimeEntryCache = vi.fn();
const mockInvalidateReportingSettingsCache = vi.fn();
const mockDbGetBreakSettings = vi.fn(async () => undefined);
const mockDbGetReportingSettings = vi.fn(async () => undefined);
const mockDbUpdateReportingSettings = vi.fn();
const mockDbUpdateBreakSettings = vi.fn();
const mockInvalidateBreakSettingsCache = vi.fn();
const mockOrgHasReportingFeature = vi.fn(async () => true);
const mockSendWeeklyReports = vi.fn(async () => true);

vi.mock("@/mcp/db", () => ({
  dbClockInAt: (...args: unknown[]) => mockDbClockInAt(...args),
  dbClockOutAt: (...args: unknown[]) => mockDbClockOutAt(...args),
  dbDeleteTimeEntry: vi.fn(),
  dbFindOverlappingTimeEntries: (...args: unknown[]) =>
    mockDbFindOverlapping(...args),
  dbGetActiveEntry: (...args: unknown[]) => mockDbGetActiveEntry(...args),
  dbGetBreakSettings: (...args: unknown[]) => mockDbGetBreakSettings(...args),
  dbGetOrgActiveEntries: vi.fn(async () => []),
  dbGetOrgTimeEntries: (...args: unknown[]) => mockDbGetOrgTimeEntries(...args),
  dbGetReportingSettings: (...args: unknown[]) =>
    mockDbGetReportingSettings(...args),
  dbGetTimeEntries: (...args: unknown[]) => mockDbGetTimeEntries(...args),
  dbGetTimeEntryById: (...args: unknown[]) => mockDbGetTimeEntryById(...args),
  dbInsertTimeEntry: (...args: unknown[]) => mockDbInsertTimeEntry(...args),
  dbUpdateBreakSettings: (...args: unknown[]) =>
    mockDbUpdateBreakSettings(...args),
  dbUpdateReportingSettings: (...args: unknown[]) =>
    mockDbUpdateReportingSettings(...args),
  dbUpdateTimeEntry: (...args: unknown[]) => mockDbUpdateTimeEntry(...args),
  invalidateBreakSettingsCache: (...args: unknown[]) =>
    mockInvalidateBreakSettingsCache(...args),
  invalidateReportingSettingsCache: (...args: unknown[]) =>
    mockInvalidateReportingSettingsCache(...args),
  invalidateTimeEntryCache: (...args: unknown[]) =>
    mockInvalidateTimeEntryCache(...args),
}));

vi.mock("@/lib/utils-clerk", () => ({
  isOverMemberShipLimit: vi.fn(async () => false),
}));

vi.mock("@/lib/reports", () => ({
  orgHasReportingFeature: (...args: unknown[]) =>
    mockOrgHasReportingFeature(...args),
  sendWeeklyReports: (...args: unknown[]) => mockSendWeeklyReports(...args),
}));

import { MCP_INSTRUCTIONS } from "@/mcp/instructions";
import {
  callerFrom,
  registerClockOutTools,
  SERVER_INFO,
  SERVER_OPTIONS,
} from "@/mcp/server";
import {
  addTimeEntryTool,
  exportTimesheetTool,
  inviteMemberTool,
  manageBreakSettingsTool,
  manageReportingSettingsTool,
  runHoursReportTool,
  updateTimeEntryTool,
} from "@/mcp/tools";

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
      "export_timesheet",
      "get_clock_status",
      "get_weekly_timecard",
      "invite_member",
      "list_members",
      "list_organizations",
      "list_time_entries",
      "manage_break_settings",
      "manage_reporting_settings",
      "run_hours_report",
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
      "export_timesheet",
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

  it("exports a PDF timesheet with a Clerk-protected download URL and embedded PDF resource", async () => {
    mockDbGetOrgTimeEntries.mockResolvedValueOnce([
      {
        id: 1,
        user_id: "user_worker",
        org_id: "org_1",
        clock_in: new Date("2026-10-26T15:00:00.000Z"),
        clock_out: new Date("2026-10-26T23:00:00.000Z"),
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);

    const res = await exportTimesheetTool(
      { userId: "user_admin", client: "Claude" },
      {
        start_date: "2026-10-26",
        end_date: "2026-10-28",
        format: "pdf",
        timezone: "America/Edmonton",
      },
    );

    expect(res.isError).toBeUndefined();
    expect(res.data.status).toBe("ready");
    expect(res.data.file_name).toBe(
      "timesheet-entire-organization-2026-10-26-to-2026-10-28.pdf",
    );
    expect(res.data.total_hours).toBe(8);
    expect(res.data.download_url).toContain(
      "/api/export/timesheet?org_id=org_1&member=all&start_date=2026-10-26&end_date=2026-10-28&format=pdf&timezone=America%2FEdmonton",
    );
    expect(res.resource?.mimeType).toBe("application/pdf");
    expect(res.resources).toHaveLength(2);
    expect(res.data.pdf).toEqual({
      file_name: "timesheet-entire-organization-2026-10-26-to-2026-10-28.pdf",
      mime_type: "application/pdf",
      download_url: expect.stringContaining("format=pdf"),
    });
    expect(res.data.spreadsheet).toEqual({
      file_name: "timesheet-entire-organization-2026-10-26-to-2026-10-28.xlsx",
      mime_type:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      download_url: expect.stringContaining("format=xlsx"),
    });
    const pdfContent = Buffer.from(res.resource?.blob ?? "", "base64").toString(
      "latin1",
    );
    expect(pdfContent.startsWith("%PDF-1.4\n")).toBe(true);
    expect(pdfContent).toContain("(Alex Smith) Tj");
  });

  it("forbids non-admin members from exporting timesheets for other members or 'all'", async () => {
    mockGetUserOrgMemberships.mockResolvedValueOnce({
      data: [
        {
          role: "org:member",
          organization: {
            id: "org_1",
            name: "PatMac Org",
            slug: "patmac-org",
            membersCount: 2,
          },
        },
      ],
    });

    const res = await exportTimesheetTool(
      { userId: "user_worker", client: "Claude" },
      {
        member: "all",
        start_date: "2026-10-26",
        end_date: "2026-10-28",
      },
    );

    expect(res.isError).toBe(true);
    expect(res.data.status).toBe("forbidden");
  });

  it("allows admins to invite new members by email and skips existing members/pending invites", async () => {
    mockGetOrganizationInvitationList.mockResolvedValueOnce({
      data: [
        {
          id: "orginv_existing",
          emailAddress: "pending@patmac.ca",
          role: "org:member",
          status: "pending",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
    });
    mockCreateOrganizationInvitation.mockResolvedValueOnce({
      id: "orginv_new_1",
      emailAddress: "newhire@patmac.ca",
      role: "org:member",
      status: "pending",
      createdAt: 1730000000000,
      updatedAt: 1730000000000,
    });

    const res = await inviteMemberTool(
      { userId: "user_admin", client: "Claude" },
      {
        emails: ["newhire@patmac.ca", "alex@patmac.ca", "pending@patmac.ca"],
        role: "member",
      },
    );

    expect(res.isError).toBeUndefined();
    expect(res.data.status).toBe("invited");
    expect(mockCreateOrganizationInvitation).toHaveBeenCalledTimes(1);
    expect(mockCreateOrganizationInvitation).toHaveBeenCalledWith({
      organizationId: "org_1",
      inviterUserId: "user_admin",
      emailAddress: "newhire@patmac.ca",
      role: "org:member",
      redirectUrl: "https://clockout.patmac.ca",
    });
    expect(res.data.sent).toHaveLength(1);
    expect(res.data.skipped).toEqual([
      { email_address: "alex@patmac.ca", reason: "already_member" },
      {
        email_address: "pending@patmac.ca",
        reason: "already_invited",
        invitation_id: "orginv_existing",
      },
    ]);
  });

  it("lists and revokes pending organization invitations for admins", async () => {
    mockGetOrganizationInvitationList.mockResolvedValueOnce({
      data: [
        {
          id: "orginv_42",
          emailAddress: "invitee@patmac.ca",
          role: "org:admin",
          status: "pending",
          createdAt: 1730000000000,
          updatedAt: 1730000000000,
        },
      ],
    });

    const listRes = await inviteMemberTool(
      { userId: "user_admin", client: "Claude" },
      { action: "list" },
    );

    expect(listRes.isError).toBeUndefined();
    expect(listRes.data.pending_count).toBe(1);

    mockGetOrganizationInvitationList.mockResolvedValueOnce({
      data: [
        {
          id: "orginv_42",
          emailAddress: "invitee@patmac.ca",
          role: "org:admin",
          status: "pending",
          createdAt: 1730000000000,
          updatedAt: 1730000000000,
        },
      ],
    });
    mockRevokeOrganizationInvitation.mockResolvedValueOnce({
      id: "orginv_42",
      emailAddress: "invitee@patmac.ca",
      role: "org:admin",
      status: "revoked",
    });

    const revokeRes = await inviteMemberTool(
      { userId: "user_admin", client: "Claude" },
      { action: "revoke", email: "invitee@patmac.ca" },
    );

    expect(revokeRes.isError).toBeUndefined();
    expect(revokeRes.data.status).toBe("revoked");
    expect(mockRevokeOrganizationInvitation).toHaveBeenCalledWith({
      organizationId: "org_1",
      invitationId: "orginv_42",
      requestingUserId: "user_admin",
    });
  });

  it("forbids non-admin members from inviting users", async () => {
    mockGetUserOrgMemberships.mockResolvedValueOnce({
      data: [
        {
          role: "org:member",
          organization: {
            id: "org_1",
            name: "PatMac Org",
            slug: "patmac-org",
            membersCount: 2,
          },
        },
      ],
    });

    const res = await inviteMemberTool(
      { userId: "user_worker", client: "Claude" },
      { email: "someone@patmac.ca" },
    );

    expect(res.isError).toBe(true);
    expect(res.data.status).toBe("forbidden");
    expect(mockCreateOrganizationInvitation).not.toHaveBeenCalled();
  });
});

describe("run_hours_report", () => {
  const adminMembership = {
    role: "org:admin",
    organization: { id: "org_1", name: "PatMac Org", slug: "patmac-org" },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockOrgHasReportingFeature.mockResolvedValue(true);
    mockSendWeeklyReports.mockResolvedValue(true);
    mockDbGetBreakSettings.mockResolvedValue(undefined);
    mockGetUserOrgMemberships.mockResolvedValue({ data: [adminMembership] });
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
            userId: "user_adam",
            firstName: "Adam",
            lastName: "Jones",
            identifier: "adam@patmac.ca",
          },
        },
      ],
    });
    mockDbGetTimeEntries.mockResolvedValue([
      {
        id: 1,
        user_id: "user_adam",
        org_id: "org_1",
        // Oct 6 2026, 8:00–17:00 America/Edmonton (UTC-6)
        clock_in: new Date("2026-10-06T14:00:00.000Z"),
        clock_out: new Date("2026-10-06T23:00:00.000Z"),
      },
      {
        id: 2,
        user_id: "user_adam",
        org_id: "org_1",
        clock_in: new Date("2026-10-07T14:00:00.000Z"),
        clock_out: new Date("2026-10-07T18:00:00.000Z"),
      },
    ] as never);
  });

  const caller = { userId: "user_admin", client: "Claude" };

  it("is registered as an admin reporting tool", () => {
    expect(tools.get("run_hours_report")?.description).toMatch(/Admin-only/);
    expect(tools.get("run_hours_report")?.description).toMatch(/Reporting/);
  });

  it("rejects non-admins", async () => {
    mockGetUserOrgMemberships.mockResolvedValue({
      data: [{ ...adminMembership, role: "org:member" }],
    });
    const res = await runHoursReportTool(
      { userId: "user_adam", client: "Claude" },
      { member: "Adam", start_date: "2026-10-01", end_date: "2026-10-15" },
    );
    expect(res.isError).toBe(true);
    expect(res.data.status).toBe("forbidden");
    expect(mockDbGetTimeEntries).not.toHaveBeenCalled();
  });

  it("requires the paid reporting feature", async () => {
    mockOrgHasReportingFeature.mockResolvedValue(false);
    const res = await runHoursReportTool(caller, {
      member: "Adam",
      start_date: "2026-10-01",
      end_date: "2026-10-15",
    });
    expect(res.isError).toBe(true);
    expect(res.data.status).toBe("reporting_not_enabled");
    expect(mockDbGetTimeEntries).not.toHaveBeenCalled();
  });

  it("rejects an end date before the start date", async () => {
    const res = await runHoursReportTool(caller, {
      member: "Adam",
      start_date: "2026-10-15",
      end_date: "2026-10-01",
    });
    expect(res.isError).toBe(true);
    expect(res.data.status).toBe("invalid_dates");
  });

  it("returns a member's net hours for the range to the AI without emailing", async () => {
    mockDbGetBreakSettings.mockResolvedValue({
      org_id: "org_1",
      dock_lunch: true,
      lunch_duration_minutes: 30,
      lunch_min_shift_hours: 5,
    } as never);

    const res = await runHoursReportTool(caller, {
      member: "Adam",
      start_date: "2026-10-01",
      end_date: "2026-10-15",
      timezone: "America/Edmonton",
    });

    expect(res.isError).toBeUndefined();
    expect(mockDbGetTimeEntries).toHaveBeenCalledWith(
      "user_adam",
      "org_1",
      new Date("2026-10-01T06:00:00.000Z"),
      new Date("2026-10-16T05:59:59.999Z"),
    );
    const reports = res.data.reports as {
      name: string;
      total_hours: number;
      gross_hours: number;
      days_worked: number;
    }[];
    expect(reports).toHaveLength(1);
    // 9h shift docked 30m lunch + 4h shift under the lunch threshold
    expect(reports[0]).toMatchObject({
      name: "Adam Jones",
      gross_hours: 13,
      total_hours: 12.5,
      days_worked: 2,
    });
    expect(res.summary).toMatch(/Adam Jones worked/);
    expect(mockSendWeeklyReports).not.toHaveBeenCalled();
    expect(res.data.email).toBeUndefined();
  });

  it("emails the report to admins when asked, limited to the requested member", async () => {
    const res = await runHoursReportTool(caller, {
      member: "Adam",
      start_date: "2026-10-01",
      end_date: "2026-10-15",
      deliver: "both",
    });

    expect(mockSendWeeklyReports).toHaveBeenCalledTimes(1);
    const [start, end, orgId, timeframe, options] = mockSendWeeklyReports.mock
      .calls[0] as unknown as [
      Date,
      Date,
      string,
      string,
      { userIds: string[] },
    ];
    expect(orgId).toBe("org_1");
    expect(timeframe).toBe("custom");
    expect(options).toEqual({ userIds: ["user_adam"] });
    expect(end.getTime() - start.getTime()).toBe(15 * 86_400_000);
    expect(res.data.email).toMatchObject({
      status: "sent",
      recipients: ["patrick@patmac.ca"],
      members_emailed: ["Adam Jones"],
    });
    expect(res.data.reports).toBeDefined();
  });

  it("reports on everyone by default", async () => {
    mockDbGetOrgTimeEntries.mockResolvedValueOnce([]);
    const res = await runHoursReportTool(caller, {
      start_date: "2026-10-01",
      end_date: "2026-10-07",
      deliver: "email_admins",
    });
    expect(mockDbGetOrgTimeEntries).toHaveBeenCalled();
    expect(mockSendWeeklyReports).not.toHaveBeenCalled();
    expect(res.data.email).toMatchObject({ status: "no_completed_shifts" });
    expect(res.data.reports).toBeUndefined();
  });
});

describe("manage_reporting_settings", () => {
  const adminMembership = {
    role: "org:admin",
    organization: { id: "org_1", name: "PatMac Org", slug: "patmac-org" },
  };
  const caller = { userId: "user_admin", client: "Claude" };

  beforeEach(() => {
    vi.clearAllMocks();
    mockOrgHasReportingFeature.mockResolvedValue(true);
    mockGetUserOrgMemberships.mockResolvedValue({ data: [adminMembership] });
    mockDbGetReportingSettings.mockResolvedValue(undefined);
    mockDbUpdateReportingSettings.mockImplementation(
      async (
        orgId: string,
        report_frequency: string,
        report_day: string | null,
        report_interval: number,
      ) => ({ org_id: orgId, report_frequency, report_day, report_interval }),
    );
  });

  it("reports whether the plan includes Reporting when viewing settings", async () => {
    mockOrgHasReportingFeature.mockResolvedValue(false);
    const res = await manageReportingSettingsTool(caller, { action: "get" });
    expect(res.isError).toBeUndefined();
    expect(res.data.reporting_enabled).toBe(false);
  });

  it("requires the paid reporting feature to update settings", async () => {
    mockOrgHasReportingFeature.mockResolvedValue(false);
    const res = await manageReportingSettingsTool(caller, {
      action: "update",
      report_frequency: "twice-monthly",
    });
    expect(res.isError).toBe(true);
    expect(res.data.status).toBe("reporting_not_enabled");
    expect(mockDbUpdateReportingSettings).not.toHaveBeenCalled();
  });

  it("requires the paid reporting feature to send a test report", async () => {
    mockOrgHasReportingFeature.mockResolvedValue(false);
    const res = await manageReportingSettingsTool(caller, {
      action: "send_test_report",
    });
    expect(res.data.status).toBe("reporting_not_enabled");
    expect(mockSendWeeklyReports).not.toHaveBeenCalled();
  });

  it("rejects updates from non-admins", async () => {
    mockGetUserOrgMemberships.mockResolvedValue({
      data: [{ ...adminMembership, role: "org:member" }],
    });
    const res = await manageReportingSettingsTool(
      { userId: "user_adam", client: "Claude" },
      { action: "update", report_frequency: "weekly" },
    );
    expect(res.data.status).toBe("forbidden");
    expect(mockDbUpdateReportingSettings).not.toHaveBeenCalled();
  });

  it("updates the schedule and invalidates the settings cache", async () => {
    const res = await manageReportingSettingsTool(caller, {
      action: "update",
      report_frequency: "custom",
      report_day: "Friday",
      report_interval: 2,
    });
    expect(res.data.status).toBe("updated");
    expect(mockDbUpdateReportingSettings).toHaveBeenCalledWith(
      "org_1",
      "custom",
      "Friday",
      2,
    );
    expect(mockInvalidateReportingSettingsCache).toHaveBeenCalledWith("org_1");
  });

  it("can turn emailed reports off", async () => {
    await manageReportingSettingsTool(caller, {
      action: "update",
      report_frequency: "off",
    });
    expect(mockDbUpdateReportingSettings).toHaveBeenCalledWith(
      "org_1",
      "off",
      null,
      1,
    );
  });

  it("treats a day-only update as a custom schedule, keeping the current interval", async () => {
    mockDbGetReportingSettings.mockResolvedValue({
      org_id: "org_1",
      report_frequency: "custom",
      report_day: "Monday",
      report_interval: 2,
    } as never);
    await manageReportingSettingsTool(caller, {
      action: "update",
      report_day: "Thursday",
    });
    expect(mockDbUpdateReportingSettings).toHaveBeenCalledWith(
      "org_1",
      "custom",
      "Thursday",
      2,
    );
  });
});

describe("manage_break_settings", () => {
  const adminMembership = {
    role: "org:admin",
    organization: { id: "org_1", name: "PatMac Org", slug: "patmac-org" },
  };
  const caller = { userId: "user_admin", client: "Claude" };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUserOrgMemberships.mockResolvedValue({ data: [adminMembership] });
    mockDbGetBreakSettings.mockResolvedValue(undefined);
    mockDbUpdateBreakSettings.mockImplementation(
      async (
        orgId: string,
        dock_lunch: boolean,
        lunch_duration_minutes: number,
        lunch_min_shift_hours: number,
      ) => ({
        org_id: orgId,
        dock_lunch,
        lunch_duration_minutes,
        lunch_min_shift_hours,
      }),
    );
  });

  it("shows defaults when nothing is saved yet", async () => {
    const res = await manageBreakSettingsTool(caller, {});
    expect(res.isError).toBeUndefined();
    expect(res.data.settings).toEqual({
      org_id: "org_1",
      dock_lunch: false,
      lunch_duration_minutes: 30,
      lunch_min_shift_hours: 5,
    });
  });

  it("does not require the paid reporting feature", async () => {
    mockOrgHasReportingFeature.mockResolvedValue(false);
    const res = await manageBreakSettingsTool(caller, {
      action: "update",
      dock_lunch: true,
    });
    expect(res.data.status).toBe("updated");
  });

  it("rejects updates from non-admins", async () => {
    mockGetUserOrgMemberships.mockResolvedValue({
      data: [{ ...adminMembership, role: "org:member" }],
    });
    const res = await manageBreakSettingsTool(
      { userId: "user_adam", client: "Claude" },
      { action: "update", dock_lunch: true },
    );
    expect(res.data.status).toBe("forbidden");
    expect(mockDbUpdateBreakSettings).not.toHaveBeenCalled();
  });

  it("rejects an update with nothing to change", async () => {
    const res = await manageBreakSettingsTool(caller, { action: "update" });
    expect(res.isError).toBe(true);
    expect(res.data.status).toBe("invalid_input");
    expect(mockDbUpdateBreakSettings).not.toHaveBeenCalled();
  });

  it("merges a partial update with the saved settings and invalidates the cache", async () => {
    mockDbGetBreakSettings.mockResolvedValue({
      org_id: "org_1",
      dock_lunch: true,
      lunch_duration_minutes: 30,
      lunch_min_shift_hours: 5,
    } as never);
    const res = await manageBreakSettingsTool(caller, {
      action: "update",
      lunch_duration_minutes: 45,
    });
    expect(res.data.status).toBe("updated");
    expect(mockDbUpdateBreakSettings).toHaveBeenCalledWith(
      "org_1",
      true,
      45,
      5,
    );
    expect(mockInvalidateBreakSettingsCache).toHaveBeenCalledWith("org_1");
  });

  it("can turn the deduction off", async () => {
    mockDbGetBreakSettings.mockResolvedValue({
      org_id: "org_1",
      dock_lunch: true,
      lunch_duration_minutes: 60,
      lunch_min_shift_hours: 6,
    } as never);
    await manageBreakSettingsTool(caller, {
      action: "update",
      dock_lunch: false,
    });
    expect(mockDbUpdateBreakSettings).toHaveBeenCalledWith(
      "org_1",
      false,
      60,
      6,
    );
  });
});
