import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DashboardTabsProps } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  dashboardProps: [] as DashboardTabsProps[],
  has: vi.fn((check: { feature?: string; role?: string }) =>
    Boolean(check.feature === "reporting" || check.role === "org:admin"),
  ),
  protect: vi.fn(),
  getOrgMembers: vi.fn(),
  getOrgReportingSettings: vi.fn(),
  getOrgTimeEntries: vi.fn(),
  getTimeEntries: vi.fn(),
}));

vi.mock("@clerk/nextjs", () => ({
  Show: ({ when, children }: { when: string; children: React.ReactNode }) => (
    <div data-testid={`show-${when}`}>{children}</div>
  ),
  SignInButton: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: { protect: mocks.protect } }));
vi.mock("@/lib/dal", () => ({
  getOrgMembers: mocks.getOrgMembers,
  getOrgReportingSettings: mocks.getOrgReportingSettings,
  getOrgTimeEntries: mocks.getOrgTimeEntries,
  getTimeEntries: mocks.getTimeEntries,
}));
vi.mock("@/components/DashboardTabs", () => ({
  default: (props: DashboardTabsProps) => {
    mocks.dashboardProps.push(props);
    return <div data-testid="dashboard" />;
  },
}));
vi.mock("@/components/headers/main-page-header", () => ({
  default: () => <header data-testid="header" />,
}));
vi.mock("@/components/fallbacks/home-page-fallback", () => ({
  default: () => <div data-testid="skeleton" />,
}));

import Home from "@/app/page";

const searchParams = {
  defaultTab: "view",
  userId: ["user_2", "ignored"],
  start: "2026-03-01",
  end: "2026-03-31",
  timezone: "America/Regina",
  week: "2",
  month: "2",
  year: "2026",
  timeframe: "month",
};

function renderHome() {
  mocks.protect.mockResolvedValue({
    userId: "user_1",
    orgId: "org_1",
    has: mocks.has,
  });
  mocks.getOrgMembers.mockReturnValue(Promise.resolve(["members"]));
  mocks.getOrgReportingSettings.mockReturnValue(Promise.resolve("settings"));
  mocks.getOrgTimeEntries.mockImplementation(async (filters) => ({
    org: filters,
  }));
  mocks.getTimeEntries.mockImplementation(async (userId, filters) => ({
    userId,
    filters,
  }));
  const Page = Home as unknown as (props: {
    params: Promise<object>;
    searchParams: Promise<Record<string, string | string[]>>;
  }) => React.ReactElement;
  render(
    <Page
      params={Promise.resolve({})}
      searchParams={Promise.resolve(searchParams)}
    />,
  );
  return mocks.dashboardProps[mocks.dashboardProps.length - 1];
}

describe("Home page", () => {
  it("renders the dashboard for signed-in users and a pitch for everyone else", () => {
    renderHome();
    expect(screen.getByTestId("header")).toBeInTheDocument();
    expect(screen.getByTestId("show-signed-in")).toContainElement(
      screen.getByTestId("dashboard"),
    );
    expect(screen.getByTestId("show-signed-out")).toHaveTextContent(
      "Time tracking, simplified.",
    );
    expect(
      screen.getByRole("button", { name: "Get Started Now" }),
    ).toBeInTheDocument();
    expect(mocks.protect).toHaveBeenCalled();
  });

  it("derives every dashboard promise from auth and the search params", async () => {
    const props = renderHome();
    const filters = {
      start: "2026-03-01",
      end: "2026-03-31",
      timezone: "America/Regina",
    };

    await expect(props.defaultTabPromise).resolves.toBe("view");
    await expect(props.endDatePromise).resolves.toBe("2026-03-31");
    await expect(props.startDatePromise).resolves.toBe("2026-03-01");
    await expect(props.selectedMonthPromise).resolves.toBe("2");
    await expect(props.selectedUserIdPromise).resolves.toBe("user_2");
    await expect(props.selectedWeekPromise).resolves.toBe("2");
    await expect(props.selectedYearPromise).resolves.toBe("2026");
    await expect(props.timeframePromise).resolves.toBe("month");
    await expect(props.entriesPromise).resolves.toEqual({
      userId: "user_2",
      filters,
    });
    await expect(props.orgTimeEntriesPromise).resolves.toEqual({
      org: filters,
    });
    await expect(props.recentEntriesPromise).resolves.toEqual({
      userId: undefined,
      filters: undefined,
    });
    await expect(props.hasReportingPromise).resolves.toBe(true);
    await expect(props.isAdminPromise).resolves.toBe(true);
    await expect(props.membersPromise).resolves.toEqual(["members"]);
    await expect(props.orgSettingsPromise).resolves.toBe("settings");
    await expect(props.orgIdPromise).resolves.toBe("org_1");
    await expect(props.userIdPromise).resolves.toBe("user_1");

    expect(mocks.has).toHaveBeenCalledWith({ feature: "reporting" });
    expect(mocks.has).toHaveBeenCalledWith({ role: "org:admin" });
  });
});
