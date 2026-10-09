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
    dbGetTimeEntriesForPeriod: vi.fn(),
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
  dbGetTimeEntriesForPeriod: mocks.dbGetTimeEntriesForPeriod,
}));

import { sendWeeklyReports } from "@/lib/reports";

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
  mocks.dbGetTimeEntriesForPeriod.mockResolvedValue([]);
  mocks.send.mockResolvedValue({ MessageId: "m1" });
});

describe("SES client", () => {
  it("defaults to us-east-1", () => {
    expect(mocks.sesConfig).toHaveBeenCalledWith({ region: "us-east-1" });
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
    expect(mocks.getOrganizationList).toHaveBeenCalledWith({ limit: 100 });
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
});
