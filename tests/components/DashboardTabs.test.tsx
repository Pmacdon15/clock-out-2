import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DashboardTabsProps, TimeEntry } from "@/lib/types";
import { makeEntry, resolved } from "../utils";

const captured = vi.hoisted(() => ({
  timeClock: [] as Record<string, unknown>[],
  viewHours: [] as Record<string, unknown>[],
  orgSettings: [] as Record<string, unknown>[],
  notifications: [] as Record<string, unknown>[],
  timeOff: [] as Record<string, unknown>[],
  schedule: [] as Record<string, unknown>[],
  orgSwitcher: vi.fn(),
}));

vi.mock("@/components/time-clock", () => ({
  default: (props: Record<string, unknown>) => {
    captured.timeClock.push(props);
    return <div data-testid="time-clock" />;
  },
}));
vi.mock("@/components/ViewHours", () => ({
  default: (props: Record<string, unknown>) => {
    captured.viewHours.push(props);
    return <div data-testid="view-hours" />;
  },
}));
vi.mock("@/components/OrgSettings", () => ({
  default: (props: Record<string, unknown>) => {
    captured.orgSettings.push(props);
    return <div data-testid="org-settings" />;
  },
}));
vi.mock("@/components/NotificationSettings", () => ({
  default: (props: Record<string, unknown>) => {
    captured.notifications.push(props);
    return <div data-testid="notification-settings" />;
  },
}));
vi.mock("@/components/Schedule", () => ({
  default: (props: Record<string, unknown>) => {
    captured.schedule.push(props);
    return <div data-testid="schedule" />;
  },
}));
vi.mock("@/components/TimezoneSync", () => ({
  default: () => <div data-testid="timezone-sync" />,
}));
vi.mock("@/components/TimeOff", () => ({
  default: (props: Record<string, unknown>) => {
    captured.timeOff.push(props);
    return <div data-testid="time-off" />;
  },
}));
vi.mock("@/components/OrgSwitcher", () => ({
  useOrgSwitcher: captured.orgSwitcher,
}));

import DashboardTabs from "@/components/DashboardTabs";

const entries = [makeEntry({ id: 1 })];
const recent = [makeEntry({ id: 2 })];
const ok = <T,>(value: T) => resolved({ ok: true as const, value });

function props(
  overrides: Partial<DashboardTabsProps> = {},
): DashboardTabsProps {
  return {
    defaultTabPromise: resolved(undefined),
    entriesPromise: ok(entries),
    orgSettingsPromise: ok(null),
    orgTimeEntriesPromise: ok([]),
    recentEntriesPromise: ok(recent),
    schedulePromise: ok([]),
    timeOffPromise: ok([]),
    membersPromise: resolved([]),
    endDatePromise: resolved(undefined),
    startDatePromise: resolved(undefined),
    isAdminPromise: resolved(false),
    hasReportingPromise: resolved(false),
    hasSchedulingPromise: resolved(true),
    hasTimeOffPromise: resolved(true),
    userIdPromise: resolved("user_1"),
    orgIdPromise: resolved("org_1"),
    ...overrides,
  };
}

const latest = (list: Record<string, unknown>[]) => list[list.length - 1];

describe("DashboardTabs", () => {
  it("offers every member a notifications tab when preferences are loaded", () => {
    const notificationSettingsPromise = ok({
      preferences: {
        email_enabled: true,
        push_enabled: true,
        shift_alerts: true,
        break_alerts: true,
        admin_alerts: true,
      },
      emailAvailable: true,
      pushAvailable: false,
      vapidPublicKey: null,
    });
    const alertSettingsPromise = ok(null as never);
    render(
      <DashboardTabs
        {...props({
          alertSettingsPromise,
          defaultTabPromise: resolved("notifications"),
          isAdminPromise: resolved(true),
          notificationSettingsPromise,
        })}
      />,
    );
    expect(screen.getByTestId("notification-settings")).toBeInTheDocument();
    expect(screen.getByTestId("timezone-sync")).toBeInTheDocument();
    expect(latest(captured.notifications)).toEqual({
      isAdmin: true,
      settingsPromise: notificationSettingsPromise,
    });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(latest(captured.orgSettings).alertSettingsPromise).toBe(
      alertSettingsPromise,
    );
  });

  it("hides the notifications tab without preferences", () => {
    render(<DashboardTabs {...props()} />);
    expect(
      screen.queryByRole("button", { name: "Notifications" }),
    ).not.toBeInTheDocument();
  });

  it("shows the error when entries fail to load", () => {
    render(
      <DashboardTabs
        {...props({
          entriesPromise: resolved({ ok: false, error: { reason: "boom" } }),
        })}
      />,
    );
    expect(
      screen.getByText("Error fetching time entries: boom"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("opens on the time clock for members and hides settings", () => {
    const p = props();
    render(<DashboardTabs {...p} />);
    expect(captured.orgSwitcher).toHaveBeenCalledWith(p.orgIdPromise);
    expect(screen.getByTestId("time-clock")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Settings" })).toBeNull();
    expect(latest(captured.timeClock)).toMatchObject({
      initialEntries: recent,
      isAdmin: false,
    });
  });

  it("passes entries and filters through to the hours view", () => {
    const p = props();
    render(<DashboardTabs {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Hours" }));
    expect(screen.getByTestId("view-hours")).toBeInTheDocument();
    expect(latest(captured.viewHours)).toMatchObject({
      entries,
      isAdmin: false,
      currentUserIdPromise: p.userIdPromise,
      membersPromise: p.membersPromise,
      orgTimeEntriesPromise: p.orgTimeEntriesPromise,
      startDatePromise: p.startDatePromise,
      endDatePromise: p.endDatePromise,
      timeOffPromise: p.timeOffPromise,
    });
  });

  it("shows the time off tab to every member", () => {
    const p = props();
    render(<DashboardTabs {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Time Off" }));
    expect(screen.getByTestId("time-off")).toBeInTheDocument();
    expect(latest(captured.timeOff)).toEqual({
      currentUserIdPromise: p.userIdPromise,
      isAdmin: false,
      membersPromise: p.membersPromise,
      timeOffPromise: p.timeOffPromise,
    });
  });

  it("shows the schedule tab to every member", () => {
    const p = props();
    render(<DashboardTabs {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Schedule" }));
    expect(screen.getByTestId("schedule")).toBeInTheDocument();
    expect(latest(captured.schedule)).toEqual({
      isAdmin: false,
      membersPromise: p.membersPromise,
      schedulePromise: p.schedulePromise,
      timeOffPromise: p.timeOffPromise,
    });
  });

  it.each([
    ["Schedule", "schedule", { hasSchedulingPromise: resolved(false) }],
    ["Time Off", "time-off", { hasTimeOffPromise: resolved(false) }],
  ])(
    "offers an upgrade in place of %s when the plan lacks it",
    (tab, testId, overrides) => {
      render(<DashboardTabs {...props(overrides)} />);
      fireEvent.click(screen.getByRole("button", { name: tab }));
      expect(screen.queryByTestId(testId)).not.toBeInTheDocument();
      expect(screen.getByText("Premium Feature")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "View Plans" })).toHaveAttribute(
        "href",
        "/plans",
      );
    },
  );

  it("shows settings to admins with reporting and honours the default tab", () => {
    const p = props({
      defaultTabPromise: resolved("settings"),
      isAdminPromise: resolved(true),
      hasReportingPromise: resolved(true),
    });
    render(<DashboardTabs {...p} />);
    expect(screen.getByTestId("org-settings")).toBeInTheDocument();
    expect(latest(captured.orgSettings)).toEqual({
      breakSettingsPromise: undefined,
      hasGeofencing: false,
      hasReporting: true,
      locationSettingsPromise: undefined,
      membersPromise: p.membersPromise,
      orgSettingsPromise: p.orgSettingsPromise,
      payRates: [],
      sitesPromise: undefined,
    });
  });

  it("passes the geofencing entitlement and its settings to the panels", () => {
    const locationSettings = {
      org_id: "org_1",
      capture_mode: "required",
      restrict_clock_in: true,
    };
    const sites = [{ id: 1, org_id: "org_1", name: "Depot" }];
    const p = props({
      defaultTabPromise: resolved("settings"),
      isAdminPromise: resolved(true),
      hasReportingPromise: resolved(true),
      hasGeofencingPromise: resolved(true),
      locationSettingsPromise: ok(locationSettings),
      sitesPromise: ok(sites),
    } as Partial<DashboardTabsProps>);
    render(<DashboardTabs {...p} />);
    expect(latest(captured.orgSettings)).toMatchObject({
      hasGeofencing: true,
      locationSettingsPromise: p.locationSettingsPromise,
      sitesPromise: p.sitesPromise,
    });
    fireEvent.click(screen.getByRole("button", { name: "Time Clock" }));
    expect(latest(captured.timeClock)).toMatchObject({ locationSettings });
  });

  it("gives the clock no location settings when the org lacks the feature", () => {
    render(
      <DashboardTabs
        {...props({
          hasGeofencingPromise: resolved(false),
          locationSettingsPromise: ok({
            org_id: "org_1",
            capture_mode: "required",
            restrict_clock_in: true,
          }),
        } as Partial<DashboardTabsProps>)}
      />,
    );
    expect(latest(captured.timeClock)).toMatchObject({
      locationSettings: null,
    });
  });

  it("gives the clock no location settings when the read failed", () => {
    render(
      <DashboardTabs
        {...props({
          hasGeofencingPromise: resolved(true),
          locationSettingsPromise: resolved({
            ok: false,
            error: { reason: "boom" },
          }),
        } as Partial<DashboardTabsProps>)}
      />,
    );
    expect(latest(captured.timeClock)).toMatchObject({
      locationSettings: null,
    });
  });

  it("passes resolved breakSettings when breakSettingsPromise succeeds or fails", () => {
    const breakSettings = {
      dock_lunch: true,
      lunch_duration_minutes: 30,
      lunch_min_shift_hours: 5,
    };
    render(
      <DashboardTabs
        {...props({
          breakSettingsPromise: ok(breakSettings),
        })}
      />,
    );
    expect(latest(captured.timeClock).breakSettings).toEqual(breakSettings);

    render(
      <DashboardTabs
        {...props({
          breakSettingsPromise: resolved({
            ok: false,
            error: { reason: "err" },
          }),
        })}
      />,
    );
    expect(latest(captured.timeClock).breakSettings).toBeNull();
  });

  it("passes overtime settings to the hours view and the settings tab", () => {
    const overtimeSettings = {
      org_id: "org_1",
      daily_threshold_hours: 8,
      weekly_threshold_hours: 40,
    };
    const overtimeSettingsPromise = ok(overtimeSettings);
    render(
      <DashboardTabs
        {...props({
          defaultTabPromise: resolved("view"),
          overtimeSettingsPromise,
        })}
      />,
    );
    expect(latest(captured.viewHours).overtimeSettings).toEqual(
      overtimeSettings,
    );

    render(
      <DashboardTabs
        {...props({
          defaultTabPromise: resolved("settings"),
          isAdminPromise: resolved(true),
          overtimeSettingsPromise,
        })}
      />,
    );
    expect(latest(captured.orgSettings).overtimeSettingsPromise).toBe(
      overtimeSettingsPromise,
    );

    render(
      <DashboardTabs
        {...props({
          defaultTabPromise: resolved("view"),
          overtimeSettingsPromise: resolved({
            ok: false,
            error: { reason: "err" },
          }),
        })}
      />,
    );
    expect(latest(captured.viewHours).overtimeSettings).toBeNull();
  });

  it("passes pay rates to the hours view and the settings tab", () => {
    const rates = [
      {
        org_id: "org_1",
        user_id: "user_1",
        hourly_rate: 20,
        overtime_multiplier: 1.5,
      },
    ];
    render(
      <DashboardTabs
        {...props({
          defaultTabPromise: resolved("view"),
          payRatesPromise: ok(rates),
        })}
      />,
    );
    expect(latest(captured.viewHours).payRates).toEqual(rates);

    render(
      <DashboardTabs
        {...props({
          defaultTabPromise: resolved("settings"),
          isAdminPromise: resolved(true),
          payRatesPromise: ok(rates),
        })}
      />,
    );
    expect(latest(captured.orgSettings).payRates).toEqual(rates);

    render(
      <DashboardTabs
        {...props({
          defaultTabPromise: resolved("view"),
          payRatesPromise: resolved({ ok: false, error: { reason: "err" } }),
        })}
      />,
    );
    expect(latest(captured.viewHours).payRates).toEqual([]);
  });

  it("gives the hours view no overtime settings without the promise", () => {
    render(
      <DashboardTabs {...props({ defaultTabPromise: resolved("view") })} />,
    );
    expect(latest(captured.viewHours).overtimeSettings).toBeNull();
  });

  it("shows settings to admins without reporting so they can set lunch breaks", () => {
    const p = props({
      defaultTabPromise: resolved("settings"),
      isAdminPromise: resolved(true),
    });
    render(<DashboardTabs {...p} />);
    expect(screen.getByTestId("org-settings")).toBeInTheDocument();
    expect(latest(captured.orgSettings)).toMatchObject({ hasReporting: false });
  });

  it("treats missing entry lists as empty", () => {
    render(
      <DashboardTabs
        {...props({
          entriesPromise: resolved({
            ok: true,
            value: undefined as unknown as TimeEntry[],
          }),
          recentEntriesPromise: resolved({
            ok: true,
            value: undefined as unknown as TimeEntry[],
          }),
        })}
      />,
    );
    expect(latest(captured.timeClock).initialEntries).toEqual([]);
  });

  it("treats failed recent entries as empty", () => {
    render(
      <DashboardTabs
        {...props({
          recentEntriesPromise: resolved({ ok: false, error: { reason: "x" } }),
        })}
      />,
    );
    expect(latest(captured.timeClock).initialEntries).toEqual([]);
  });
});
