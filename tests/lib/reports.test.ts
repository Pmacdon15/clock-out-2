import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  // The SES client reads AWS_REGION at import time; start from a clean slate.
  delete process.env.AWS_REGION;
  return {
    send: vi.fn(),
    sesConfig: vi.fn(),
    getOrganization: vi.fn(),
    getOrganizationList: vi.fn(),
    getOrganizationMembershipList: vi.fn(),
    getOrganizationBillingSubscription: vi.fn(),
    render: vi.fn(async () => "<html>report</html>"),
    WeeklyReportEmail: vi.fn((props: unknown) => props),
    dbGetBreakSettings: vi.fn(),
    dbGetOvertimeSettings: vi.fn(),
    dbGetTimeEntriesForPeriod: vi.fn(),
    dbGetApprovedTimeOffForPeriod: vi.fn(),
  };
});

vi.mock("@aws-sdk/client-ses", () => ({
  SESClient: class {
    send = mocks.send;
    constructor(config: unknown) {
      mocks.sesConfig(config);
    }
  },
  SendEmailCommand: class {
    constructor(public input: unknown) {}
  },
}));

vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: vi.fn(async () => ({
    organizations: {
      getOrganization: mocks.getOrganization,
      getOrganizationList: mocks.getOrganizationList,
      getOrganizationMembershipList: mocks.getOrganizationMembershipList,
    },
    billing: {
      getOrganizationBillingSubscription:
        mocks.getOrganizationBillingSubscription,
    },
  })),
}));

vi.mock("@react-email/render", () => ({ render: mocks.render }));
vi.mock("@/components/emails/WeeklyReportEmail", () => ({
  WeeklyReportEmail: mocks.WeeklyReportEmail,
}));
vi.mock("@/lib/db", () => ({
  dbGetBreakSettings: mocks.dbGetBreakSettings,
  dbGetOvertimeSettings: mocks.dbGetOvertimeSettings,
  dbGetTimeEntriesForPeriod: mocks.dbGetTimeEntriesForPeriod,
  dbGetApprovedTimeOffForPeriod: mocks.dbGetApprovedTimeOffForPeriod,
}));

import { orgHasReportingFeature, sendWeeklyReports } from "@/lib/reports";

// Snapshot the constructor call now: call history is cleared before every test.
const initialSesConfig = mocks.sesConfig.mock.calls[0]?.[0];

const org = { id: "org_1", name: "Acme" };
const withReporting = {
  subscriptionItems: [
    { plan: null },
    { plan: {} },
    { plan: { features: [{ slug: "other" }, { slug: "reporting" }] } },
  ],
};
const admin = {
  role: "org:admin",
  publicUserData: {
    userId: "admin_1",
    firstName: "Ada",
    lastName: "Lovelace",
    identifier: "ada@example.com",
  },
};
const worker = {
  role: "org:member",
  publicUserData: {
    userId: "worker_1",
    firstName: "Grace",
    lastName: null,
    identifier: "grace@example.com",
  },
};
const emailOnly = {
  role: "org:member",
  publicUserData: { userId: "worker_2", identifier: "linus@example.com" },
};
const noUser = { role: "org:member", publicUserData: undefined };

const shift = (start: string, end: string | null) => ({
  clock_in: start,
  clock_out: end,
});

const start = new Date("2026-01-01T00:00:00Z");
const end = new Date("2026-01-08T00:00:00Z");

/** Props passed to the email template for the nth sent email. */
const emailProps = (n = 0) =>
  mocks.WeeklyReportEmail.mock.calls[n][0] as Record<string, unknown>;

beforeEach(() => {
  vi.stubEnv("AWS_ACCESS_KEY_ID", "key");
  vi.stubEnv("AWS_SECRET_ACCESS_KEY", "secret");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
  vi.stubEnv("SES_FROM_EMAIL", "");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.getOrganization.mockResolvedValue(org);
  mocks.getOrganizationList.mockResolvedValue({ data: [org] });
  mocks.getOrganizationBillingSubscription.mockResolvedValue(withReporting);
  mocks.getOrganizationMembershipList.mockResolvedValue({ data: [admin] });
  mocks.dbGetBreakSettings.mockResolvedValue(undefined);
  mocks.dbGetOvertimeSettings.mockResolvedValue(undefined);
  mocks.dbGetTimeEntriesForPeriod.mockResolvedValue([]);
  mocks.dbGetApprovedTimeOffForPeriod.mockResolvedValue([]);
  mocks.send.mockResolvedValue({ MessageId: "m1" });
});

describe("SES client", () => {
  it("defaults to us-east-1", () => {
    expect(initialSesConfig).toEqual({ region: "us-east-1" });
  });

  it("uses AWS_REGION when set", async () => {
    vi.resetModules();
    vi.stubEnv("AWS_REGION", "ca-central-1");
    await import("@/lib/reports");
    expect(mocks.sesConfig).toHaveBeenLastCalledWith({
      region: "ca-central-1",
    });
  });
});

describe("sendWeeklyReports", () => {
  it.each([
    ["no AWS credentials", "", ""],
    ["no AWS secret", "key", ""],
  ])("skips sending with %s", async (_label, id, secret) => {
    vi.stubEnv("AWS_ACCESS_KEY_ID", id);
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", secret);
    await expect(sendWeeklyReports(start, end)).resolves.toBe(false);
    expect(mocks.getOrganizationList).not.toHaveBeenCalled();
  });

  it("processes every org when no target is given", async () => {
    await expect(sendWeeklyReports(start, end)).resolves.toBe(true);
    expect(mocks.getOrganizationList).toHaveBeenCalledWith({
      limit: 100,
      offset: 0,
    });
    expect(mocks.getOrganization).not.toHaveBeenCalled();
  });

  it("only processes the target org when given", async () => {
    await sendWeeklyReports(start, end, "org_1");
    expect(mocks.getOrganization).toHaveBeenCalledWith({
      organizationId: "org_1",
    });
    expect(mocks.getOrganizationList).not.toHaveBeenCalled();
  });

  it("skips orgs whose billing lookup fails", async () => {
    mocks.getOrganizationBillingSubscription.mockRejectedValue(new Error("x"));
    await sendWeeklyReports(start, end);
    expect(mocks.getOrganizationMembershipList).not.toHaveBeenCalled();
  });

  it("skips orgs without the reporting feature", async () => {
    mocks.getOrganizationBillingSubscription.mockResolvedValue({
      subscriptionItems: [{ plan: { features: [{ slug: "other" }] } }],
    });
    await sendWeeklyReports(start, end);
    expect(mocks.getOrganizationMembershipList).not.toHaveBeenCalled();
  });

  it("skips orgs with no admin email to send to", async () => {
    mocks.getOrganizationMembershipList.mockResolvedValue({
      data: [worker, { role: "org:admin", publicUserData: { userId: "a2" } }],
    });
    await sendWeeklyReports(start, end);
    expect(mocks.dbGetTimeEntriesForPeriod).not.toHaveBeenCalled();
  });

  it("skips members without a user id and members with no entries", async () => {
    mocks.getOrganizationMembershipList.mockResolvedValue({
      data: [admin, noUser],
    });
    await sendWeeklyReports(start, end);
    expect(mocks.dbGetTimeEntriesForPeriod).toHaveBeenCalledTimes(1);
    expect(mocks.dbGetTimeEntriesForPeriod).toHaveBeenCalledWith(
      "admin_1",
      "org_1",
      start,
      end,
    );
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("emails admins a per-member report with a daily breakdown", async () => {
    mocks.getOrganizationMembershipList.mockResolvedValue({
      data: [admin, worker, emailOnly],
    });
    mocks.dbGetTimeEntriesForPeriod.mockImplementation(async (userId) => {
      if (userId !== "worker_1")
        return [shift("2026-01-02T09:00:00Z", "2026-01-02T09:30:00Z")];
      return [
        shift("2026-01-02T09:00:00Z", "2026-01-02T12:15:00Z"),
        shift("2026-01-02T13:00:00Z", "2026-01-02T13:45:00Z"),
        shift("2026-01-03T09:00:00Z", "2026-01-03T10:00:00Z"),
        shift("2026-01-04T09:00:00Z", null),
      ];
    });

    await sendWeeklyReports(start, end, "org_1");

    expect(mocks.send).toHaveBeenCalledTimes(3);
    expect([0, 1, 2].map((n) => emailProps(n).userName)).toEqual([
      "Ada Lovelace",
      "Grace",
      "linus@example.com",
    ]);

    const grace = emailProps(1);
    expect(grace).toMatchObject({
      totalHours: "5h 0m",
      periodStart: "Jan 1, 2026",
      // endDate is midnight, so the report ends the day before.
      periodEnd: "Jan 7, 2026",
      dashboardUrl: "https://clockout.patmac.ca",
      userId: "worker_1",
      orgId: "org_1",
      week: "1",
      month: "0",
      year: "2026",
      timeframe: "week",
      customStart: "2026-01-01",
      customEnd: "2026-01-07",
      breakdown: [
        {
          date: "Jan 2, 2026",
          rawMs: 4 * 60 * 60 * 1000,
          shifts: [
            { start: "9:00 AM", end: "12:15 PM", duration: "3h 15m" },
            { start: "1:00 PM", end: "1:45 PM", duration: "45m" },
          ],
        },
        {
          date: "Jan 3, 2026",
          rawMs: 60 * 60 * 1000,
          shifts: [{ start: "9:00 AM", end: "10:00 AM", duration: "1h 0m" }],
        },
      ],
    });
    const chart = JSON.parse(
      decodeURIComponent(
        new URL(grace.chartUrl as string).searchParams.get("c") as string,
      ),
    );
    expect(chart.data.labels).toEqual(["Jan 2", "Jan 3"]);
    expect(chart.data.datasets[0].data).toEqual([4, 1]);

    expect(emailProps(0).totalHours).toBe("30m");

    const command = mocks.send.mock.calls[1][0].input;
    expect(command).toEqual({
      Destination: { ToAddresses: ["ada@example.com"] },
      Message: {
        Body: { Html: { Charset: "UTF-8", Data: "<html>report</html>" } },
        Subject: { Charset: "UTF-8", Data: "Weekly Hours Report for Grace" },
      },
      Source: "Clock Out <no-reply@clockout.patmac.ca>",
    });
  });

  it("uses configured URLs and keeps a non-midnight end date", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://example.test");
    vi.stubEnv("SES_FROM_EMAIL", "Reports <reports@example.test>");
    mocks.dbGetTimeEntriesForPeriod.mockResolvedValue([
      shift("2026-01-20T09:00:00Z", "2026-01-20T10:00:00Z"),
    ]);

    await sendWeeklyReports(
      new Date("2026-01-16T00:00:00Z"),
      new Date("2026-01-23T12:00:00Z"),
      "org_1",
      "custom",
    );

    expect(emailProps()).toMatchObject({
      dashboardUrl: "https://example.test",
      periodEnd: "Jan 23, 2026",
      customEnd: "2026-01-23",
      timeframe: "custom",
      week: "3",
    });
    expect(mocks.send.mock.calls[0][0].input.Source).toBe(
      "Reports <reports@example.test>",
    );
  });

  it.each([
    ["2026-01-08T00:00:00Z", "2"],
    ["2026-01-24T00:00:00Z", "4"],
  ])("maps a period starting %s to week %s", async (startIso, week) => {
    mocks.dbGetTimeEntriesForPeriod.mockResolvedValue([
      shift("2026-01-25T09:00:00Z", "2026-01-25T10:00:00Z"),
    ]);
    await sendWeeklyReports(new Date(startIso), end, "org_1");
    expect(emailProps().week).toBe(week);
  });

  it("keeps going when an email fails to send", async () => {
    mocks.dbGetTimeEntriesForPeriod.mockResolvedValue([
      shift("2026-01-02T09:00:00Z", "2026-01-02T10:00:00Z"),
    ]);
    mocks.send.mockRejectedValue(new Error("ses down"));
    await expect(sendWeeklyReports(start, end, "org_1")).resolves.toBe(true);
    expect(console.error).toHaveBeenCalled();
  });

  it("only reports on the requested members and labels on-demand reports", async () => {
    mocks.getOrganizationMembershipList.mockResolvedValue({
      data: [admin, worker, emailOnly],
    });
    mocks.dbGetTimeEntriesForPeriod.mockResolvedValue([
      shift("2026-01-02T09:00:00Z", "2026-01-02T10:00:00Z"),
    ]);
    await sendWeeklyReports(start, end, "org_1", "custom", {
      userIds: ["worker_1"],
    });
    expect(mocks.dbGetTimeEntriesForPeriod).toHaveBeenCalledTimes(1);
    expect(mocks.dbGetTimeEntriesForPeriod).toHaveBeenCalledWith(
      "worker_1",
      "org_1",
      start,
      end,
    );
    expect(mocks.send).toHaveBeenCalledTimes(1);
    const command = mocks.send.mock.calls[0]?.[0] as {
      input: { Message: { Subject: { Data: string } } };
    };
    expect(command.input.Message.Subject.Data).toBe(
      "Hours Report for Grace (Jan 1, 2026 – Jan 7, 2026)",
    );
    expect(emailProps().timeframe).toBe("custom");
  });

  describe("pagination", () => {
    /** Serves `items` the way Clerk does: one `limit`-sized slice per call. */
    const servePages =
      <T>(items: T[]) =>
      async ({ limit, offset }: { limit: number; offset: number }) => ({
        data: items.slice(offset, offset + limit),
        totalCount: items.length,
      });

    const manyOrgs = Array.from({ length: 101 }, (_, i) => ({
      id: `org_${i + 1}`,
      name: `Org ${i + 1}`,
    }));
    const manyMembers = [
      admin,
      ...Array.from({ length: 100 }, (_, i) => ({
        role: "org:member",
        publicUserData: {
          userId: `worker_${i + 1}`,
          firstName: `Worker${i + 1}`,
          lastName: null,
          identifier: `worker${i + 1}@example.com`,
        },
      })),
    ];

    it("processes orgs past the first page", async () => {
      mocks.getOrganizationList.mockImplementation(servePages(manyOrgs));

      await expect(sendWeeklyReports(start, end)).resolves.toBe(true);

      expect(mocks.getOrganizationList).toHaveBeenCalledTimes(2);
      expect(mocks.getOrganizationList.mock.calls).toEqual([
        [{ limit: 100, offset: 0 }],
        [{ limit: 100, offset: 100 }],
      ]);
      // Every org was looked at, including the only one on the second page.
      expect(mocks.getOrganizationBillingSubscription).toHaveBeenCalledTimes(
        101,
      );
      expect(mocks.getOrganizationBillingSubscription).toHaveBeenCalledWith(
        "org_101",
      );
    });

    it("reports on members past the first page", async () => {
      mocks.getOrganizationMembershipList.mockImplementation(
        servePages(manyMembers),
      );
      mocks.dbGetTimeEntriesForPeriod.mockResolvedValue([
        shift("2026-01-02T09:00:00Z", "2026-01-02T10:00:00Z"),
      ]);

      await sendWeeklyReports(start, end, "org_1");

      expect(mocks.getOrganizationMembershipList).toHaveBeenCalledTimes(2);
      expect(mocks.getOrganizationMembershipList.mock.calls).toEqual([
        [{ organizationId: "org_1", limit: 100, offset: 0 }],
        [{ organizationId: "org_1", limit: 100, offset: 100 }],
      ]);
      expect(mocks.dbGetTimeEntriesForPeriod).toHaveBeenCalledTimes(101);
      expect(mocks.dbGetTimeEntriesForPeriod).toHaveBeenCalledWith(
        "worker_100",
        "org_1",
        start,
        end,
      );
      expect(mocks.send).toHaveBeenCalledTimes(101);
    });

    it("stops walking members when a page comes back empty", async () => {
      // totalCount lies about there being more members than Clerk will serve.
      mocks.getOrganizationMembershipList.mockImplementation(
        async ({ offset }: { offset: number }) => ({
          data: offset === 0 ? manyMembers.slice(0, 100) : [],
          totalCount: 10_000,
        }),
      );

      await expect(sendWeeklyReports(start, end, "org_1")).resolves.toBe(true);
      expect(mocks.getOrganizationMembershipList).toHaveBeenCalledTimes(2);
      expect(mocks.dbGetTimeEntriesForPeriod).toHaveBeenCalledTimes(100);
    });

    it("raises a failure part way through the member walk", async () => {
      mocks.getOrganizationMembershipList
        .mockResolvedValueOnce({
          data: manyMembers.slice(0, 100),
          totalCount: 101,
        })
        .mockRejectedValueOnce(new Error("clerk down"));

      await expect(sendWeeklyReports(start, end, "org_1")).rejects.toThrow(
        "clerk down",
      );
    });
  });
});

describe("orgHasReportingFeature", () => {
  it("is true when a subscription plan includes reporting", async () => {
    await expect(orgHasReportingFeature("org_1")).resolves.toBe(true);
  });

  it("is false without the feature or when billing lookup fails", async () => {
    mocks.getOrganizationBillingSubscription.mockResolvedValueOnce({
      subscriptionItems: [{ plan: { features: [{ slug: "other" }] } }],
    });
    await expect(orgHasReportingFeature("org_1")).resolves.toBe(false);
    mocks.getOrganizationBillingSubscription.mockRejectedValueOnce(
      new Error("no billing"),
    );
    await expect(orgHasReportingFeature("org_1")).resolves.toBe(false);
  });
});

describe("sendWeeklyReports break records", () => {
  const shiftWithBreaks = {
    clock_in: "2026-01-05T09:00:00Z",
    clock_out: "2026-01-05T17:00:00Z",
    breaks: [
      {
        id: 1,
        time_entry_id: 1,
        break_type: "unpaid_meal",
        break_start: "2026-01-05T12:00:00Z",
        break_end: "2026-01-05T12:30:00Z",
      },
      {
        id: 2,
        time_entry_id: 1,
        break_type: "paid_rest",
        break_start: "2026-01-05T15:00:00Z",
        break_end: "2026-01-05T15:15:00Z",
      },
    ],
  };

  it("deducts unpaid breaks only and lists every break per shift", async () => {
    mocks.dbGetTimeEntriesForPeriod.mockResolvedValue([shiftWithBreaks]);
    await sendWeeklyReports(start, end, "org_1");
    const props = emailProps();
    expect(props.totalHours).toBe("7h 30m");
    const breakdown = props.breakdown as {
      shifts: { duration: string; breaks?: string }[];
    }[];
    expect(breakdown[0].shifts[0].duration).toBe("7h 30m");
    expect(breakdown[0].shifts[0].breaks).toBe(
      "Meal period 12:00 PM - 12:30 PM (30m, unpaid); " +
        "Paid rest break 3:00 PM - 3:15 PM (15m, paid)",
    );
  });

  it("leaves the break line off a shift with no breaks", async () => {
    mocks.dbGetTimeEntriesForPeriod.mockResolvedValue([
      { clock_in: "2026-01-05T09:00:00Z", clock_out: "2026-01-05T17:00:00Z" },
    ]);
    await sendWeeklyReports(start, end, "org_1");
    const breakdown = emailProps().breakdown as {
      shifts: { breaks?: string }[];
    }[];
    expect(breakdown[0].shifts[0].breaks).toBeUndefined();
  });

  it("marks a still-running break with an open end time", async () => {
    mocks.dbGetTimeEntriesForPeriod.mockResolvedValue([
      {
        clock_in: "2026-01-05T09:00:00Z",
        clock_out: "2026-01-05T17:00:00Z",
        breaks: [
          {
            id: 3,
            time_entry_id: 1,
            break_type: "unpaid_rest",
            break_start: "2026-01-05T12:00:00Z",
            break_end: null,
          },
        ],
      },
    ]);
    await sendWeeklyReports(start, end, "org_1");
    const breakdown = emailProps().breakdown as {
      shifts: { breaks?: string }[];
    }[];
    expect(breakdown[0].shifts[0].breaks).toContain("12:00 PM - ...");
  });

  it("does not dock lunch on top of a recorded unpaid break", async () => {
    mocks.dbGetBreakSettings.mockResolvedValue({
      org_id: "org_1",
      dock_lunch: true,
      lunch_duration_minutes: 30,
      lunch_min_shift_hours: 5,
    });
    mocks.dbGetTimeEntriesForPeriod.mockResolvedValue([shiftWithBreaks]);
    await sendWeeklyReports(start, end, "org_1");
    // 8h shift, 30m unpaid break recorded: the automatic 30m dock stands down.
    expect(emailProps().totalHours).toBe("7h 30m");
  });
});

describe("sendWeeklyReports overtime", () => {
  const shiftOn = (day: string, startHour: number, hours: number) => ({
    clock_in: `2026-01-${day}T${String(startHour).padStart(2, "0")}:00:00Z`,
    clock_out: `2026-01-${day}T${String(startHour + hours).padStart(2, "0")}:00:00Z`,
  });

  it("leaves overtime out of the email when the org tracks none", async () => {
    mocks.dbGetTimeEntriesForPeriod.mockResolvedValue([shiftOn("05", 8, 10)]);
    await sendWeeklyReports(start, end, "org_1");
    const props = emailProps();
    expect(props.overtimeHours).toBeUndefined();
    expect(props.regularHours).toBeUndefined();
    const breakdown = props.breakdown as Record<string, unknown>[];
    expect(breakdown[0].overtime).toBeUndefined();
    const chart = JSON.parse(
      decodeURIComponent(
        new URL(props.chartUrl as string).searchParams.get("c") as string,
      ),
    );
    expect(chart.data.datasets).toHaveLength(1);
    expect(chart.options.plugins.legend.display).toBe(false);
  });

  it("splits regular and overtime hours per shift, day and period", async () => {
    mocks.dbGetOvertimeSettings.mockResolvedValue({
      org_id: "org_1",
      daily_threshold_hours: 8,
      weekly_threshold_hours: null,
    });
    mocks.dbGetTimeEntriesForPeriod.mockResolvedValue([
      // Mon: 6h + 4h = 10h -> 2h daily overtime, all on the second shift.
      shiftOn("05", 6, 6),
      shiftOn("05", 13, 4),
      // Tue: 7h, no overtime.
      shiftOn("06", 9, 7),
      // Still running: skipped like every other report line.
      { clock_in: "2026-01-07T09:00:00Z", clock_out: null },
    ]);
    await sendWeeklyReports(start, end, "org_1");
    const props = emailProps();
    expect(props).toMatchObject({
      totalHours: "17h 0m",
      regularHours: "15h 0m",
      overtimeHours: "2h 0m",
      overtimePolicy: "over 8h/day",
    });
    const breakdown = props.breakdown as {
      overtime?: string;
      shifts: { overtime?: string }[];
    }[];
    expect(breakdown[0].overtime).toBe("2h 0m");
    expect(breakdown[0].shifts[0].overtime).toBeUndefined();
    expect(breakdown[0].shifts[1].overtime).toBe("2h 0m");
    expect(breakdown[1].overtime).toBeUndefined();

    const chart = JSON.parse(
      decodeURIComponent(
        new URL(props.chartUrl as string).searchParams.get("c") as string,
      ),
    );
    expect(chart.data.datasets.map((d: { label: string }) => d.label)).toEqual([
      "Regular",
      "Overtime",
    ]);
    expect(chart.data.datasets[0].data).toEqual([8, 7]);
    expect(chart.data.datasets[1].data).toEqual([2, 0]);
    expect(chart.options.plugins.legend.display).toBe(true);
  });

  it("still sends the report when the overtime lookup fails", async () => {
    mocks.dbGetOvertimeSettings.mockRejectedValue(new Error("db down"));
    mocks.dbGetTimeEntriesForPeriod.mockResolvedValue([shiftOn("05", 8, 10)]);
    await sendWeeklyReports(start, end, "org_1");
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(emailProps().overtimeHours).toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(
      "[Reports] Error fetching overtime settings for org_1:",
      expect.any(Error),
    );
  });
});

describe("time off in reports", () => {
  const vacation = {
    id: 1,
    request_type: "vacation",
    // Starts before the period: only Jan 1–2 count.
    start_date: "2025-12-30",
    end_date: "2026-01-02",
    hours_per_day: 8,
  };
  const sick = {
    id: 2,
    request_type: "sick",
    start_date: "2026-01-05",
    end_date: "2026-01-05",
    hours_per_day: 7.5,
  };

  it("lists approved time off in the period and its hours", async () => {
    mocks.dbGetTimeEntriesForPeriod.mockResolvedValue([
      shift("2026-01-06T09:00:00Z", "2026-01-06T10:00:00Z"),
    ]);
    mocks.dbGetApprovedTimeOffForPeriod.mockResolvedValue([vacation, sick]);
    await sendWeeklyReports(start, end, "org_1");

    expect(mocks.dbGetApprovedTimeOffForPeriod).toHaveBeenCalledWith(
      "admin_1",
      "org_1",
      "2026-01-01",
      "2026-01-07",
    );
    expect(emailProps()).toMatchObject({
      totalHours: "1h 0m",
      totalTimeOff: "23.5h",
      timeOff: [
        {
          type: "Vacation (PTO)",
          dates: "Dec 30, 2025 – Jan 2, 2026",
          hours: "16h",
        },
        { type: "Sick day", dates: "Jan 5, 2026", hours: "7.5h" },
      ],
    });
  });

  it("totals unpaid time off apart from paid", async () => {
    mocks.dbGetApprovedTimeOffForPeriod.mockResolvedValue([
      sick,
      {
        ...sick,
        id: 3,
        request_type: "unpaid",
        start_date: "2026-01-06",
        end_date: "2026-01-06",
        hours_per_day: 8,
      },
    ]);
    await sendWeeklyReports(start, end, "org_1");
    expect(emailProps()).toMatchObject({
      totalTimeOff: "7.5h",
      totalUnpaidTimeOff: "8h",
    });
  });

  it("still sends a report for a member who only had time off", async () => {
    mocks.dbGetApprovedTimeOffForPeriod.mockResolvedValue([sick]);
    await sendWeeklyReports(start, end, "org_1");
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(emailProps()).toMatchObject({ totalHours: "0m", breakdown: [] });
  });

  it("sends the hours without time off when the lookup fails", async () => {
    mocks.dbGetTimeEntriesForPeriod.mockResolvedValue([
      shift("2026-01-06T09:00:00Z", "2026-01-06T10:00:00Z"),
    ]);
    mocks.dbGetApprovedTimeOffForPeriod.mockRejectedValue(new Error("db"));
    await sendWeeklyReports(start, end, "org_1");
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(emailProps()).toMatchObject({ timeOff: [], totalTimeOff: "0h" });
    expect(emailProps().totalUnpaidTimeOff).toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(
      "[Reports] Error fetching time off for Ada Lovelace:",
      expect.any(Error),
    );
  });
});
