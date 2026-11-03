import { act, fireEvent, render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ViewHoursProps } from "@/lib/types";
import { makeEntry, resolved } from "../utils";

type Captured = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  user: null as { fullName: string | null } | null,
  props: {} as Record<string, Record<string, unknown>[]>,
}));

const capture = (name: string) => (props: Record<string, unknown>) => {
  mocks.props[name] ??= [];
  mocks.props[name].push(props);
  return <div data-testid={name} />;
};

vi.mock("@clerk/nextjs", () => ({ useUser: () => ({ user: mocks.user }) }));
vi.mock("@/components/ViewHours/TimeframeSelector", () => ({
  TimeframeSelector: (p: Captured) => capture("TimeframeSelector")(p),
}));
vi.mock("@/components/ViewHours/HoursBarChart", () => ({
  HoursBarChart: (p: Captured) => capture("HoursBarChart")(p),
}));
vi.mock("@/components/ViewHours/HoursLineChart", () => ({
  HoursLineChart: (p: Captured) => capture("HoursLineChart")(p),
}));
vi.mock("@/components/ViewHours/MemberToggles", () => ({
  MemberToggles: (p: Captured) => capture("MemberToggles")(p),
}));
vi.mock("@/components/ViewHours/DaysWorkedBreakdown", () => ({
  DaysWorkedBreakdown: (p: Captured) => capture("DaysWorkedBreakdown")(p),
}));
vi.mock("@/components/ViewHours/EntryList", () => ({
  EntryList: (p: Captured) => capture("EntryList")(p),
}));
vi.mock("@/components/ViewHours/OvertimeSummary", () => ({
  OvertimeSummary: (p: Captured) => capture("OvertimeSummary")(p),
}));
vi.mock("@/components/ViewHours/PaySummary", () => ({
  PaySummary: (p: Captured) => capture("PaySummary")(p),
}));
vi.mock("@/components/ViewHours/TimeOffSummary", () => ({
  TimeOffSummary: (p: Captured) => capture("TimeOffSummary")(p),
}));
vi.mock("@/components/ViewHours/TimesheetExport", () => ({
  TimesheetExport: (p: Captured) => capture("TimesheetExport")(p),
}));

import ViewHours from "@/components/ViewHours";

const latest = (name: string) => {
  const list = mocks.props[name] ?? [];
  return list[list.length - 1];
};

const members = [
  { id: "u1", name: "Ada" },
  { id: "u2", name: "Grace" },
];
const myEntries = [makeEntry({ id: 1, user_id: "me" })];
const orgEntries = [makeEntry({ id: 2, user_id: "u1" })];

function renderView(overrides: Partial<ViewHoursProps> = {}) {
  return render(
    <ViewHours
      currentUserIdPromise={resolved("me")}
      endDatePromise={resolved("2026-03-14")}
      entries={myEntries}
      isAdmin
      membersPromise={resolved(members)}
      orgTimeEntriesPromise={resolved({ ok: true as const, value: orgEntries })}
      selectedUserIdPromise={resolved("")}
      setOptimisticEntries={vi.fn()}
      startDatePromise={resolved("2026-03-08")}
      timeframePromise={resolved("month")}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  mocks.props = {};
  mocks.user = { fullName: "Me Myself" };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ViewHours for the current user", () => {
  it("passes the user's own entries and filters to every panel", () => {
    renderView();
    expect(latest("TimeframeSelector")).toMatchObject({
      availableYears: [new Date().getFullYear()],
      currentUserId: "me",
      startDate: "2026-03-08",
      endDate: "2026-03-14",
      isAdmin: true,
      members,
      selectedUserId: "",
      timeframe: "month",
    });
    expect(latest("HoursBarChart")).toMatchObject({
      employeeName: "Me Myself",
      filteredEntries: myEntries,
      isViewingAll: false,
      previousTotalHours: 0,
      timeframe: "month",
    });
    expect(latest("DaysWorkedBreakdown")).toEqual({
      entries: myEntries,
      isViewingAll: false,
    });
    expect(latest("EntryList")).toMatchObject({
      entries: myEntries,
      isAdmin: true,
      isViewingAll: false,
    });
    expect(screen.queryByTestId("MemberToggles")).not.toBeInTheDocument();
  });

  it("switches between bar and line charts", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "LINE CHART" }));
    expect(screen.queryByTestId("HoursBarChart")).not.toBeInTheDocument();
    expect(latest("HoursLineChart")).toMatchObject({
      employeeName: "Me Myself",
      members: [{ id: "me", name: "Me Myself" }],
      visibleMemberIds: new Set(["me"]),
    });

    fireEvent.click(screen.getByRole("button", { name: "BAR CHART" }));
    expect(screen.getByTestId("HoursBarChart")).toBeInTheDocument();
  });

  it("calls the user 'You' when Clerk has no name", () => {
    mocks.user = { fullName: null };
    renderView();
    expect(latest("HoursBarChart").employeeName).toBe("You");
  });

  it("calls the user 'You' before Clerk loads", () => {
    mocks.user = null;
    renderView();
    expect(latest("HoursBarChart").employeeName).toBe("You");
  });

  it("falls back to defaults when optional promises are missing", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-04-02T12:00:00Z"));
    await act(async () => {
      render(
        <Suspense fallback="loading">
          <ViewHours
            entries={myEntries}
            orgTimeEntriesPromise={resolved({
              ok: false as const,
              error: { reason: "admins only" },
            })}
            setOptimisticEntries={vi.fn()}
          />
        </Suspense>,
      );
    });
    expect(latest("TimeframeSelector")).toMatchObject({
      currentUserId: "",
      isAdmin: false,
      members: [],
      selectedUserId: "",
      startDate: "2026-04-02",
      endDate: "2026-04-02",
      timeframe: "week",
    });

    expect(latest("HoursBarChart")).toMatchObject({
      employeeName: "Me Myself",
      filteredEntries: myEntries,
      isViewingAll: false,
    });
  });

  it("uses today when the date promises resolve empty", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-04-02T12:00:00Z"));
    renderView({
      startDatePromise: resolved(undefined),
      endDatePromise: resolved(undefined),
      timeframePromise: resolved(undefined),
    });
    expect(latest("TimeframeSelector")).toMatchObject({
      startDate: "2026-04-02",
      endDate: "2026-04-02",
      timeframe: "week",
    });
  });
});

describe("ViewHours for a selected member", () => {
  it("names the selected member", () => {
    renderView({ selectedUserIdPromise: resolved("u2") });
    expect(latest("HoursBarChart").employeeName).toBe("Grace");
    fireEvent.click(screen.getByRole("button", { name: "LINE CHART" }));
    expect(latest("HoursLineChart")).toMatchObject({
      members: [{ id: "u2", name: "Grace" }],
      visibleMemberIds: new Set(["u2"]),
    });
  });

  it("uses a generic name for an unknown member", () => {
    renderView({ selectedUserIdPromise: resolved("someone-else") });
    expect(latest("HoursBarChart").employeeName).toBe("Employee");
  });
});

describe("ViewHours for the whole org", () => {
  it("shows org entries and member toggles to admins", () => {
    renderView({ selectedUserIdPromise: resolved("all") });
    expect(latest("HoursBarChart")).toMatchObject({
      employeeName: "Entire Organization",
      filteredEntries: orgEntries,
      isViewingAll: true,
      visibleMemberIds: new Set(["u1", "u2"]),
    });
    expect(latest("EntryList")).toMatchObject({
      entries: orgEntries,
      isViewingAll: true,
      members,
    });
    expect(latest("MemberToggles")).toMatchObject({
      members,
      visibleMemberIds: new Set(["u1", "u2"]),
    });

    fireEvent.click(screen.getByRole("button", { name: "LINE CHART" }));
    expect(latest("HoursLineChart")).toMatchObject({
      members,
      visibleMemberIds: new Set(["u1", "u2"]),
    });
  });

  it("toggles individual members and all members", () => {
    renderView({ selectedUserIdPromise: resolved("all") });
    const toggles = () =>
      latest("MemberToggles") as {
        toggleMember: (id: string) => void;
        toggleAll: () => void;
      };

    act(() => toggles().toggleMember("u1"));
    expect(latest("MemberToggles").visibleMemberIds).toEqual(new Set(["u2"]));

    act(() => toggles().toggleMember("u1"));
    expect(latest("MemberToggles").visibleMemberIds).toEqual(
      new Set(["u2", "u1"]),
    );

    act(() => toggles().toggleAll());
    expect(latest("MemberToggles").visibleMemberIds).toEqual(new Set());

    act(() => toggles().toggleAll());
    expect(latest("MemberToggles").visibleMemberIds).toEqual(
      new Set(["u1", "u2"]),
    );
  });

  it("ignores 'all' for non-admins", () => {
    renderView({ isAdmin: false, selectedUserIdPromise: resolved("all") });
    expect(latest("HoursBarChart")).toMatchObject({
      employeeName: "Employee",
      filteredEntries: myEntries,
      isViewingAll: false,
    });
  });
});

describe("ViewHours timesheet export", () => {
  it("is hidden outside the custom timeframe", () => {
    renderView();
    expect(screen.queryByTestId("TimesheetExport")).not.toBeInTheDocument();
  });

  it("offers the export for a custom period", () => {
    renderView({ timeframePromise: resolved("custom") });
    expect(latest("TimesheetExport")).toMatchObject({
      employeeName: "Me Myself",
      entries: myEntries,
      isViewingAll: false,
      startDate: "2026-03-08",
      endDate: "2026-03-14",
    });
  });

  it("offers the export for a pay period and passes the pay period settings", () => {
    const payPeriodSettings = {
      org_id: "org_1",
      enabled: true,
      frequency: "weekly" as const,
      anchor_payday: "2026-11-13",
      holdback_days: 7,
    };
    renderView({ payPeriodSettings, timeframePromise: resolved("pay-period") });
    expect(latest("TimesheetExport")).toMatchObject({
      startDate: "2026-03-08",
    });
    expect(latest("TimeframeSelector")).toMatchObject({
      payPeriodSettings,
      timeframe: "pay-period",
    });
  });

  it("exports the whole org's entries when viewing all", () => {
    renderView({
      selectedUserIdPromise: resolved("all"),
      timeframePromise: resolved("custom"),
    });
    expect(latest("TimesheetExport")).toMatchObject({
      employeeName: "Entire Organization",
      entries: orgEntries,
      isViewingAll: true,
      members,
    });
  });
});

describe("ViewHours overtime", () => {
  const overtimeSettings = {
    org_id: "org_1",
    daily_threshold_hours: 6,
    weekly_threshold_hours: null,
  };

  it("shows no overtime panel or splits when the org tracks none", () => {
    renderView();
    expect(screen.queryByTestId("OvertimeSummary")).not.toBeInTheDocument();
    expect(latest("EntryList").overtimeByEntry).toBeUndefined();
  });

  it("splits the shown entries and passes the splits to the panels", () => {
    renderView({ overtimeSettings, timeframePromise: resolved("custom") });
    const summary = latest("OvertimeSummary");
    expect(summary).toMatchObject({
      entries: myEntries,
      isViewingAll: false,
      members,
      overtimeSettings,
    });
    const splits = summary.overtimeByEntry as Map<
      unknown,
      { overtimeHours: number }
    >;
    // makeEntry shifts run 8h; the daily threshold is 6h.
    expect(splits.get(myEntries[0])?.overtimeHours).toBe(2);
    expect(latest("EntryList").overtimeByEntry).toBe(splits);
    expect(latest("TimesheetExport").overtimeSettings).toBe(overtimeSettings);
  });

  it("splits the org's entries when viewing all", () => {
    renderView({ overtimeSettings, selectedUserIdPromise: resolved("all") });
    const summary = latest("OvertimeSummary");
    expect(summary.entries).toBe(orgEntries);
    expect(summary.isViewingAll).toBe(true);
  });
});

describe("ViewHours pay", () => {
  const payRates = [
    { org_id: "org_1", user_id: "me", hourly_rate: 20, overtime_multiplier: 2 },
  ];

  it("shows no pay panel without any pay rates", () => {
    renderView({ payRates: [] });
    expect(screen.queryByTestId("PaySummary")).not.toBeInTheDocument();
    renderView();
    expect(screen.queryByTestId("PaySummary")).not.toBeInTheDocument();
  });

  it("splits every hour as regular when overtime is off", () => {
    renderView({ payRates, timeframePromise: resolved("custom") });
    const summary = latest("PaySummary");
    expect(summary).toMatchObject({
      entries: myEntries,
      isViewingAll: false,
      members,
    });
    const rates = summary.payRates as Map<string, unknown>;
    expect(rates.get("me")).toEqual({ hourlyRate: 20, overtimeMultiplier: 2 });
    const splits = summary.splitsByEntry as Map<
      unknown,
      { regularHours: number; overtimeHours: number }
    >;
    expect(splits.get(myEntries[0])).toMatchObject({
      regularHours: 8,
      overtimeHours: 0,
    });
    expect(latest("TimesheetExport").payRates).toBe(rates);
  });

  it("reuses the overtime splits when overtime is tracked", () => {
    renderView({
      payRates,
      overtimeSettings: {
        org_id: "org_1",
        daily_threshold_hours: 6,
        weekly_threshold_hours: null,
      },
    });
    expect(latest("PaySummary").splitsByEntry).toBe(
      latest("OvertimeSummary").overtimeByEntry,
    );
  });
});

describe("ViewHours time off", () => {
  const approved = {
    id: 1,
    org_id: "org_1",
    user_id: "me",
    request_type: "vacation" as const,
    start_date: "2026-03-09",
    end_date: "2026-03-10",
    hours_per_day: 8,
    note: null,
    status: "approved" as const,
    reviewed_by: "a",
    reviewed_at: null,
  };

  it("shows the viewer's time off in the selected range", () => {
    renderView({
      timeOffPromise: resolved({ ok: true as const, value: [approved] }),
    });
    expect(latest("TimeOffSummary")).toEqual({
      requests: [approved],
      startDate: "2026-03-08",
      endDate: "2026-03-14",
      userId: "me",
      members,
    });
  });

  it("follows the selected member, or everyone in the org view", () => {
    renderView({ selectedUserIdPromise: resolved("u2") });
    expect(latest("TimeOffSummary")).toMatchObject({
      userId: "u2",
      requests: [],
    });
    renderView({ selectedUserIdPromise: resolved("all") });
    expect(latest("TimeOffSummary")).toMatchObject({ userId: null });
  });

  it("falls back to an empty user id and no requests when loading fails", () => {
    renderView({
      currentUserIdPromise: resolved(null),
      timeOffPromise: resolved({
        ok: false as const,
        error: { reason: "boom" },
      }),
    });
    expect(latest("TimeOffSummary")).toMatchObject({
      userId: "",
      requests: [],
    });
  });
});
