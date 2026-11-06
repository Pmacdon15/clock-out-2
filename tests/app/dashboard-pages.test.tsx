import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const props: Record<string, Record<string, unknown>[]> = {};
  const capture = (name: string) => (p: Record<string, unknown>) => {
    props[name] ??= [];
    props[name].push(p);
    return <div data-testid={name} />;
  };
  return {
    props,
    capture,
    admin: true,
    features: new Set<string>(),
    session: { userId: "user_1", orgId: "org_1" as string | null },
    dal: {
      getOrgBreakSettings: vi.fn(() => "break_settings"),
      getOrgLocationSettings: vi.fn(() => "location_settings"),
      getOrgMembers: vi.fn(() => "members"),
      getOrgOvertimeSettings: vi.fn(() => "overtime_settings"),
      getOrgPayPeriodSettings: vi.fn(() => "pay_period_settings"),
      getOrgPayRates: vi.fn(),
      getOrgReportingSettings: vi.fn(() => "reporting_settings"),
      getOrgSites: vi.fn(() => "sites"),
      getOrgTimeEntries: vi.fn(async (filters: unknown) => ({ org: filters })),
      getSchedule: vi.fn(() => "schedule"),
      getTimeEntries: vi.fn(async (...args: unknown[]) => ({ args })),
      getTimeOffAllowances: vi.fn(() => "allowances"),
      getTimeOffRequests: vi.fn(() => "time_off"),
    },
    getOrgPayroll: vi.fn(),
    getOrgAlertSettings: vi.fn(() => "alert_settings"),
    getMyNotificationSettings: vi.fn(() => "notification_settings"),
  };
});

vi.mock("@/lib/session", () => ({
  getSession: () => Promise.resolve(mocks.session),
  isAdmin: () => Promise.resolve(mocks.admin),
  hasFeature: (feature: string) => Promise.resolve(mocks.features.has(feature)),
}));
vi.mock("@/lib/dal", () => mocks.dal);
vi.mock("@/lib/payroll-dal", () => ({ getOrgPayroll: mocks.getOrgPayroll }));
vi.mock("@/lib/alerts-dal", () => ({
  getOrgAlertSettings: mocks.getOrgAlertSettings,
  getMyNotificationSettings: mocks.getMyNotificationSettings,
}));
vi.mock("@clerk/nextjs", () => ({
  SignInButton: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("@/components/headers/main-page-header", () => ({
  default: () => <h1>Clock Out</h1>,
}));
vi.mock("@/components/InstallPrompt", () => ({
  default: () => <div data-testid="install-prompt" />,
}));
vi.mock("@/components/McpConnectCard", () => ({
  default: () => <div data-testid="mcp-card" />,
}));
vi.mock("@/components/DashboardNav", () => ({
  default: () => <nav data-testid="nav" />,
}));
vi.mock("@/components/DashboardSync", () => ({
  default: mocks.capture("sync"),
}));
vi.mock("@/components/TimeClockPanel", () => ({
  default: mocks.capture("time-clock"),
}));
vi.mock("@/components/HoursPanel", () => ({
  default: mocks.capture("hours"),
}));
vi.mock("@/components/NotificationSettings", () => ({
  default: mocks.capture("notification-settings"),
}));
vi.mock("@/components/Schedule", () => ({
  default: mocks.capture("schedule"),
}));
vi.mock("@/components/TimeOff", () => ({
  default: mocks.capture("time-off"),
}));
vi.mock("@/components/OrgSettings", () => ({
  default: mocks.capture("org-settings"),
}));

import HoursPage from "@/app/(dashboard)/hours/page";
import DashboardLayout from "@/app/(dashboard)/layout";
import NotificationsPage from "@/app/(dashboard)/notifications/page";
import TimeClockPage from "@/app/(dashboard)/page";
import SchedulePage from "@/app/(dashboard)/schedule/page";
import SettingsPage from "@/app/(dashboard)/settings/page";
import TimeOffPage from "@/app/(dashboard)/time-off/page";
import WelcomePage from "@/app/welcome/page";

/**
 * Runs the page once, like the server does, and renders what it returned
 * (a client re-render would make fresh promises on every retry). The async
 * act lets React settle the promise children inside the Suspense holes.
 */
const renderOnce = async (Page: () => React.ReactNode) => {
  await act(async () => {
    render(Page() as React.ReactElement);
  });
};

const latest = (name: string) => {
  const list = mocks.props[name] ?? [];
  return list[list.length - 1];
};

beforeEach(() => {
  for (const key of Object.keys(mocks.props)) delete mocks.props[key];
  mocks.admin = true;
  mocks.features = new Set();
  mocks.session = { userId: "user_1", orgId: "org_1" };
  mocks.dal.getOrgPayRates.mockResolvedValue({ ok: true, value: ["rate"] });
  mocks.getOrgPayroll.mockResolvedValue({ ok: true, value: "payroll" });
});

describe("DashboardLayout", () => {
  it("frames each page with the header, nav and background sync", async () => {
    render(
      <DashboardLayout>
        <p>page body</p>
      </DashboardLayout>,
    );
    expect(screen.getByRole("heading", { name: "Clock Out" })).toBeVisible();
    expect(screen.getByTestId("install-prompt")).toBeInTheDocument();
    expect(screen.getByTestId("nav")).toBeInTheDocument();
    expect(screen.getByText("page body")).toBeInTheDocument();
    expect(screen.getByRole("main")).toContainElement(
      screen.getByText("page body"),
    );

    const sync = latest("sync");
    await expect(sync?.orgIdPromise).resolves.toBe("org_1");
    expect(sync?.settingsPromise).toBe("notification_settings");
  });

  it("passes no org when the session has none", async () => {
    mocks.session = { userId: "user_1", orgId: null };
    render(<DashboardLayout>{null}</DashboardLayout>);
    await expect(latest("sync")?.orgIdPromise).resolves.toBeUndefined();
  });
});

describe("TimeClockPage", () => {
  it("starts the clock's reads and shows the clock", async () => {
    mocks.features.add("geofencing");
    render(<TimeClockPage />);
    expect(screen.getByTestId("time-clock")).toBeInTheDocument();
    expect(screen.getByTestId("mcp-card")).toBeInTheDocument();
    const props = latest("time-clock");
    expect(props?.breakSettingsPromise).toBe("break_settings");
    expect(props?.locationSettingsPromise).toBe("location_settings");
    await expect(props?.hasGeofencingPromise).resolves.toBe(true);
    await expect(props?.isAdminPromise).resolves.toBe(true);
    await expect(props?.recentEntriesPromise).resolves.toEqual({ args: [] });
  });
});

describe("HoursPage", () => {
  it("reads the entries for the range in the URL", async () => {
    const searchParams = Promise.resolve({
      userId: ["user_2", "ignored"],
      start: "2026-03-01",
      end: "2026-03-31",
      timezone: "America/Regina",
      timeframe: "month",
    });
    render(
      <HoursPage
        params={Promise.resolve({})}
        searchParams={searchParams as never}
      />,
    );
    const filters = {
      start: "2026-03-01",
      end: "2026-03-31",
      timezone: "America/Regina",
    };
    const props = latest("hours");
    expect(screen.getByTestId("hours")).toBeInTheDocument();
    await expect(props?.entriesPromise).resolves.toEqual({
      args: ["user_2", filters],
    });
    await expect(props?.orgTimeEntriesPromise).resolves.toEqual({
      org: filters,
    });
    await expect(props?.selectedUserIdPromise).resolves.toBe("user_2");
    await expect(props?.startDatePromise).resolves.toBe("2026-03-01");
    await expect(props?.endDatePromise).resolves.toBe("2026-03-31");
    await expect(props?.timeframePromise).resolves.toBe("month");
    await expect(props?.currentUserIdPromise).resolves.toBe("user_1");
    await expect(props?.isAdminPromise).resolves.toBe(true);
    expect(props).toMatchObject({
      breakSettingsPromise: "break_settings",
      membersPromise: "members",
      overtimeSettingsPromise: "overtime_settings",
      payPeriodSettingsPromise: "pay_period_settings",
      timeOffPromise: "time_off",
    });
  });
});

describe("NotificationsPage", () => {
  it("passes the plan and role to the settings", async () => {
    mocks.features.add("notifications");
    mocks.admin = false;
    await renderOnce(NotificationsPage);
    expect(await screen.findByTestId("notification-settings")).toBeVisible();
    expect(latest("notification-settings")).toEqual({
      hasNotifications: true,
      isAdmin: false,
      settingsPromise: "notification_settings",
    });
  });
});

describe("SchedulePage", () => {
  it("shows the schedule on plans with scheduling", async () => {
    mocks.features.add("scheduling");
    await renderOnce(SchedulePage);
    expect(await screen.findByTestId("schedule")).toBeVisible();
    expect(latest("schedule")).toEqual({
      isAdmin: true,
      membersPromise: "members",
      schedulePromise: "schedule",
      timeOffPromise: "time_off",
    });
  });

  it("offers an upgrade on plans without it", async () => {
    await renderOnce(SchedulePage);
    expect(
      await screen.findByText(/Scheduling shifts is only available/),
    ).toBeVisible();
    expect(mocks.dal.getSchedule).not.toHaveBeenCalled();
  });
});

describe("TimeOffPage", () => {
  it("shows time off on plans with it", async () => {
    mocks.features.add("time_off");
    await renderOnce(TimeOffPage);
    expect(await screen.findByTestId("time-off")).toBeVisible();
    const props = latest("time-off");
    expect(props).toMatchObject({
      allowancesPromise: "allowances",
      isAdmin: true,
      membersPromise: "members",
      timeOffPromise: "time_off",
    });
    await expect(props?.currentUserIdPromise).resolves.toBe("user_1");
  });

  it("offers an upgrade on plans without it", async () => {
    await renderOnce(TimeOffPage);
    expect(
      await screen.findByText(/Time off requests and PTO tracking/),
    ).toBeVisible();
    expect(mocks.dal.getTimeOffAllowances).not.toHaveBeenCalled();
  });
});

describe("SettingsPage", () => {
  it("gives admins every org setting and their plan's features", async () => {
    mocks.features = new Set(["geofencing", "reporting"]);
    await renderOnce(SettingsPage);
    expect(await screen.findByTestId("org-settings")).toBeVisible();
    expect(latest("org-settings")).toEqual({
      alertSettingsPromise: "alert_settings",
      breakSettingsPromise: "break_settings",
      hasGeofencing: true,
      hasNotifications: false,
      hasReporting: true,
      locationSettingsPromise: "location_settings",
      membersPromise: "members",
      orgSettingsPromise: "reporting_settings",
      overtimeSettingsPromise: "overtime_settings",
      payPeriodSettingsPromise: "pay_period_settings",
      payRates: ["rate"],
      payroll: "payroll",
      sitesPromise: "sites",
    });
  });

  it("falls back to no rates or payroll when they fail to load", async () => {
    mocks.dal.getOrgPayRates.mockResolvedValue({ ok: false });
    mocks.getOrgPayroll.mockResolvedValue({ ok: false });
    await renderOnce(SettingsPage);
    await screen.findByTestId("org-settings");
    expect(latest("org-settings")).toMatchObject({
      payRates: [],
      payroll: null,
    });
  });

  it("tells members settings are for admins and reads none", async () => {
    mocks.admin = false;
    await renderOnce(SettingsPage);
    expect(
      await screen.findByText("Only organization admins can change settings."),
    ).toBeVisible();
    expect(mocks.dal.getOrgSites).not.toHaveBeenCalled();
    expect(mocks.getOrgAlertSettings).not.toHaveBeenCalled();
  });
});

describe("WelcomePage", () => {
  it("pitches the app to signed-out visitors", () => {
    render(<WelcomePage />);
    expect(screen.getByRole("heading", { name: "Clock Out" })).toBeVisible();
    expect(screen.getByText("Time tracking, simplified.")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Get Started Now" }),
    ).toBeVisible();
    expect(screen.getByTestId("mcp-card")).toBeInTheDocument();
  });
});
