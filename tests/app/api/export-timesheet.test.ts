import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAuth = vi.fn();
const mockGetOrgMemberships = vi.fn();
const mockGetUserOrgMemberships = vi.fn();

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => mockAuth(),
  clerkClient: vi.fn(async () => ({
    users: {
      getOrganizationMembershipList: mockGetUserOrgMemberships,
    },
    organizations: {
      getOrganizationMembershipList: mockGetOrgMemberships,
    },
  })),
}));

const mockVerifyMcpToken = vi.fn();
vi.mock("@/mcp/auth", () => ({
  verifyMcpToken: (...args: unknown[]) => mockVerifyMcpToken(...args),
}));

const mockDbGetOrgTimeEntries = vi.fn(async () => []);
const mockDbGetTimeEntries = vi.fn(async () => []);

vi.mock("@/mcp/db", () => ({
  dbClockInAt: vi.fn(),
  dbClockOutAt: vi.fn(),
  dbDeleteTimeEntry: vi.fn(),
  dbFindOverlappingTimeEntries: vi.fn(async () => []),
  dbGetActiveEntry: vi.fn(),
  dbGetOrgActiveEntries: vi.fn(async () => []),
  dbGetOrgTimeEntries: (...args: unknown[]) => mockDbGetOrgTimeEntries(...args),
  dbGetReportingSettings: vi.fn(),
  dbGetTimeEntries: (...args: unknown[]) => mockDbGetTimeEntries(...args),
  dbGetTimeEntryById: vi.fn(),
  dbInsertTimeEntry: vi.fn(),
  dbUpdateReportingSettings: vi.fn(),
  dbUpdateTimeEntry: vi.fn(),
  invalidateReportingSettingsCache: vi.fn(),
  invalidateTimeEntryCache: vi.fn(),
}));

vi.mock("@/lib/utils-clerk", () => ({
  isOverMemberShipLimit: vi.fn(async () => false),
}));

vi.mock("@/lib/reports", () => ({
  sendWeeklyReports: vi.fn(async () => true),
}));

import { GET } from "@/app/api/export/timesheet/route";

describe("GET /api/export/timesheet", () => {
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

  it("redirects unauthenticated browser requests to Clerk sign-in", async () => {
    const redirectToSignIn = vi.fn(
      ({ returnBackUrl }: { returnBackUrl: string }) =>
        Response.redirect(
          `https://accounts.example.com/sign-in?redirect_url=${encodeURIComponent(returnBackUrl)}`,
          307,
        ),
    );
    mockAuth.mockResolvedValueOnce({ userId: null, redirectToSignIn });

    const req = new Request(
      "https://clockout.patmac.ca/api/export/timesheet?org_id=org_1&start_date=2026-10-26&end_date=2026-10-28&format=pdf",
      { headers: { accept: "text/html,application/xhtml+xml" } },
    );
    const res = await GET(req);

    expect(res.status).toBe(307);
    expect(redirectToSignIn).toHaveBeenCalledWith({
      returnBackUrl: req.url,
    });
  });

  it("returns 401 JSON when unauthenticated and not a browser HTML navigation", async () => {
    mockAuth.mockResolvedValueOnce({ userId: null });

    const req = new Request(
      "https://clockout.patmac.ca/api/export/timesheet?org_id=org_1&start_date=2026-10-26&end_date=2026-10-28",
    );
    const res = await GET(req);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("unauthorized");
  });

  it("downloads a valid PDF attachment when signed into Clerk in the browser", async () => {
    mockAuth.mockResolvedValueOnce({ userId: "user_admin" });
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

    const req = new Request(
      "https://clockout.patmac.ca/api/export/timesheet?org_id=org_1&member=all&start_date=2026-10-26&end_date=2026-10-28&format=pdf&timezone=America/Edmonton",
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="timesheet-entire-organization-2026-10-26-to-2026-10-28.pdf"',
    );
    const text = Buffer.from(await res.arrayBuffer()).toString("latin1");
    expect(text.startsWith("%PDF-1.4\n")).toBe(true);
    expect(text).toContain("(Alex Smith) Tj");
  });

  it("allows an MCP agent with a verified Clerk OAuth bearer token to download the PDF", async () => {
    mockAuth.mockResolvedValueOnce({ userId: null });
    mockVerifyMcpToken.mockResolvedValueOnce({
      token: "oat_123",
      clientId: "client_1",
      scopes: [],
      extra: { userId: "user_worker" },
    });
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
    mockDbGetTimeEntries.mockResolvedValueOnce([
      {
        id: 2,
        user_id: "user_worker",
        org_id: "org_1",
        clock_in: new Date("2026-10-26T15:00:00.000Z"),
        clock_out: new Date("2026-10-26T21:00:00.000Z"),
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);

    const req = new Request(
      "https://clockout.patmac.ca/api/export/timesheet?org_id=org_1&member=user_worker&start_date=2026-10-26&end_date=2026-10-28&format=pdf&timezone=America/Edmonton",
      { headers: { authorization: "Bearer oat_123" } },
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="timesheet-alex-smith-2026-10-26-to-2026-10-28.pdf"',
    );
  });

  it("returns 403 when a regular member tries to download another member's or all timesheets", async () => {
    mockAuth.mockResolvedValueOnce({ userId: "user_worker" });
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

    const req = new Request(
      "https://clockout.patmac.ca/api/export/timesheet?org_id=org_1&member=all&start_date=2026-10-26&end_date=2026-10-28",
    );
    const res = await GET(req);

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.status).toBe("forbidden");
  });

  it("returns 401 when an invalid bearer token is sent", async () => {
    mockAuth.mockResolvedValueOnce({ userId: null });
    mockVerifyMcpToken.mockResolvedValueOnce(undefined);

    const req = new Request(
      "https://clockout.patmac.ca/api/export/timesheet?org_id=org_1",
      { headers: { authorization: "Bearer bad_token" } },
    );
    const res = await GET(req);

    expect(res.status).toBe(401);
  });

  it("downloads a CSV attachment with text/csv headers", async () => {
    mockAuth.mockResolvedValueOnce({ userId: "user_admin" });
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

    const req = new Request(
      "https://clockout.patmac.ca/api/export/timesheet?org_id=org_1&member=all&start_date=2026-10-26&end_date=2026-10-28&format=csv&timezone=America/Edmonton",
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="timesheet-entire-organization-2026-10-26-to-2026-10-28.csv"',
    );
    expect(res.headers.get("cache-control")).toBe("private, no-store");

    const buffer = Buffer.from(await res.arrayBuffer());
    expect(Array.from(buffer.subarray(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    const text = buffer.toString("utf8").slice(1);
    const lines = text.split("\r\n").filter(Boolean);
    expect(lines[0]).toBe(
      "Record Type,Employee,Date,Day,Clock In,Clock Out,Hours,Daily Total,Period,Days Worked,Shifts,Avg Hours/Day",
    );
    expect(lines[1]).toContain("Shift,Alex Smith,2026-10-26,Mon,");
    expect(lines[1]).toContain(",8.00,8.00,");
    expect(text).toContain("Total,,,,,,8.00,");
  });

  it("returns 400 when invalid query parameters are provided", async () => {
    mockAuth.mockResolvedValueOnce({ userId: "user_admin" });

    const req = new Request(
      "https://clockout.patmac.ca/api/export/timesheet?org_id=org_1&format=docx",
    );
    const res = await GET(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_parameters");
  });
});
