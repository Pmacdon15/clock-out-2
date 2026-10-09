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
