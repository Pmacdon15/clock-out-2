import { act, render, screen } from "@testing-library/react";
import { startTransition } from "react";
import { describe, expect, it, vi } from "vitest";
import type {
  BreakSettingsData,
  LocationSettingsData,
  OvertimeSettingsData,
  ReportingSettingsData,
  SiteData,
} from "@/lib/types";
import { resolved } from "../utils";

type CapturedProps = {
  hasReporting: boolean;
  initialData: ReportingSettingsData | null;
  onUpdateOptimistic: (next: Partial<ReportingSettingsData>) => void;
};

type CapturedBreakProps = {
  initialData: BreakSettingsData | null;
  onUpdateOptimistic: (next: Partial<BreakSettingsData>) => void;
};

type CapturedLocationProps = {
  initialData: LocationSettingsData | null;
  sites: SiteData[];
  onUpdateOptimistic: (next: Partial<LocationSettingsData>) => void;
};

type CapturedOvertimeProps = {
  initialData: OvertimeSettingsData | null;
  onUpdateOptimistic: (next: Partial<OvertimeSettingsData>) => void;
};

const captured = vi.hoisted(() => ({
  props: [] as CapturedProps[],
  breakProps: [] as CapturedBreakProps[],
  locationProps: [] as CapturedLocationProps[],
  alertProps: [] as { initialData: unknown }[],
  overtimeProps: [] as CapturedOvertimeProps[],
  payRateProps: [] as {
    members: { id: string; name: string }[];
    initialRates: unknown[];
  }[],
}));

vi.mock("@/components/PayRateSettings", () => ({
  default: (props: {
    members: { id: string; name: string }[];
    initialRates: unknown[];
  }) => {
    captured.payRateProps.push(props);
    return (
      <div data-testid="pay-rates">
        {props.members.length}|{props.initialRates.length}
      </div>
    );
  },
}));

vi.mock("@/components/AlertSettings", () => ({
  default: (props: { initialData: unknown }) => {
    captured.alertProps.push(props);
    return <div data-testid="alerts">{JSON.stringify(props.initialData)}</div>;
  },
}));

vi.mock("@/components/ReportingSettings", () => ({
  default: (props: CapturedProps) => {
    captured.props.push(props);
    return (
      <div data-testid="reporting">
        {String(props.hasReporting)}|{JSON.stringify(props.initialData)}
      </div>
    );
  },
}));

vi.mock("@/components/BreakSettings", () => ({
  default: (props: CapturedBreakProps) => {
    captured.breakProps.push(props);
    return <div data-testid="breaks">{JSON.stringify(props.initialData)}</div>;
  },
}));

vi.mock("@/components/LocationSettings", () => ({
  default: (props: CapturedLocationProps) => {
    captured.locationProps.push(props);
    return (
      <div data-testid="location">
        {JSON.stringify(props.initialData)}|{props.sites.length}
      </div>
    );
  },
}));

vi.mock("@/components/OvertimeSettings", () => ({
  default: (props: CapturedOvertimeProps) => {
    captured.overtimeProps.push(props);
    return (
      <div data-testid="overtime">{JSON.stringify(props.initialData)}</div>
    );
  },
}));

import OrgSettings from "@/components/OrgSettings";

const latest = () => captured.props[captured.props.length - 1];
const latestBreak = () => captured.breakProps[captured.breakProps.length - 1];
const latestLocation = () =>
  captured.locationProps[captured.locationProps.length - 1];
const latestOvertime = () =>
  captured.overtimeProps[captured.overtimeProps.length - 1];

function updateOvertimeOptimistically(next: Partial<OvertimeSettingsData>) {
  act(() => {
    startTransition(async () => {
      latestOvertime().onUpdateOptimistic(next);
      await new Promise(() => {});
    });
  });
}

/** Fires an optimistic update inside a transition that never settles. */
function updateOptimistically(next: Partial<ReportingSettingsData>) {
  act(() => {
    startTransition(async () => {
      latest().onUpdateOptimistic(next);
      await new Promise(() => {});
    });
  });
}

function updateBreaksOptimistically(next: Partial<BreakSettingsData>) {
  act(() => {
    startTransition(async () => {
      latestBreak().onUpdateOptimistic(next);
      await new Promise(() => {});
    });
  });
}

function updateLocationOptimistically(next: Partial<LocationSettingsData>) {
  act(() => {
    startTransition(async () => {
      latestLocation().onUpdateOptimistic(next);
      await new Promise(() => {});
    });
  });
}

const locationValue: LocationSettingsData = {
  org_id: "org_1",
  capture_mode: "optional",
  restrict_clock_in: false,
};

const site: SiteData = {
  id: 1,
  org_id: "org_1",
  name: "Depot",
  latitude: 45.421,
  longitude: -75.69,
  radius_meters: 150,
};

describe("OrgSettings", () => {
  it("shows the shift alert rules only when they were requested", () => {
    const alerts = {
      org_id: "org_1",
      forgot_clock_out_enabled: true,
      forgot_clock_out_hours: 10,
      auto_clock_out_enabled: false,
      auto_clock_out_hours: 16,
      break_reminder_enabled: false,
      break_reminder_minutes: 45,
      notify_admins: true,
    };
    const { unmount } = render(
      <OrgSettings
        alertSettingsPromise={resolved({ ok: true, value: alerts })}
        hasReporting={false}
        orgSettingsPromise={resolved({ ok: true, value: null })}
      />,
    );
    expect(captured.alertProps.at(-1)?.initialData).toEqual(alerts);
    unmount();

    render(
      <OrgSettings
        alertSettingsPromise={resolved({ ok: false, error: { reason: "x" } })}
        hasReporting={false}
        orgSettingsPromise={resolved({ ok: true, value: null })}
      />,
    );
    expect(screen.getByTestId("alerts")).toHaveTextContent("null");
  });

  it("gives the pay rate card the members and their rates", () => {
    const members = [{ id: "user_1", name: "Ada" }];
    const rates = [
      {
        org_id: "org_1",
        user_id: "user_1",
        hourly_rate: 20,
        overtime_multiplier: 1.5,
      },
    ];
    const { unmount } = render(
      <OrgSettings
        hasReporting={false}
        membersPromise={resolved(members)}
        orgSettingsPromise={resolved({ ok: true, value: null })}
        payRates={rates}
      />,
    );
    expect(captured.payRateProps.at(-1)).toEqual({
      members,
      initialRates: rates,
    });
    unmount();

    render(
      <OrgSettings
        hasReporting={false}
        orgSettingsPromise={resolved({ ok: true, value: null })}
      />,
    );
    expect(screen.getByTestId("pay-rates")).toHaveTextContent("0|0");
  });

  it("leaves the shift alert rules out without a promise", () => {
    render(
      <OrgSettings
        hasReporting={false}
        orgSettingsPromise={resolved({ ok: true, value: null })}
      />,
    );
    expect(screen.queryByTestId("alerts")).not.toBeInTheDocument();
  });

  it("passes no initial data when the settings failed to load", () => {
    render(
      <OrgSettings
        breakSettingsPromise={resolved({ ok: false, error: { reason: "x" } })}
        hasReporting
        orgSettingsPromise={resolved({ ok: false, error: { reason: "x" } })}
      />,
    );
    expect(screen.getByTestId("reporting")).toHaveTextContent("true|null");
    expect(screen.getByTestId("breaks")).toHaveTextContent("null");
  });

  it("renders the location panel with no settings and no sites by default", () => {
    render(
      <OrgSettings
        hasReporting={false}
        orgSettingsPromise={resolved({ ok: true, value: null })}
      />,
    );
    expect(screen.getByTestId("location")).toHaveTextContent("null|0");
  });

  it("passes the loaded location settings and sites down", () => {
    render(
      <OrgSettings
        hasReporting={false}
        locationSettingsPromise={resolved({ ok: true, value: locationValue })}
        orgSettingsPromise={resolved({ ok: true, value: null })}
        sitesPromise={resolved({ ok: true, value: [site] })}
      />,
    );
    expect(latestLocation().initialData).toEqual(locationValue);
    expect(latestLocation().sites).toEqual([site]);

    updateLocationOptimistically({
      capture_mode: "required",
      restrict_clock_in: true,
    });
    expect(latestLocation().initialData).toEqual({
      ...locationValue,
      capture_mode: "required",
      restrict_clock_in: true,
    });
  });

  it("falls back to no settings and no sites when either read failed", () => {
    render(
      <OrgSettings
        hasReporting={false}
        locationSettingsPromise={resolved({
          ok: false,
          error: { reason: "x" },
        })}
        orgSettingsPromise={resolved({ ok: true, value: null })}
        sitesPromise={resolved({ ok: false, error: { reason: "x" } })}
      />,
    );
    expect(latestLocation().initialData).toBeNull();
    expect(latestLocation().sites).toEqual([]);
    // Nothing to merge into, so an optimistic update is a no-op.
    updateLocationOptimistically({ capture_mode: "required" });
    expect(latestLocation().initialData).toBeNull();
  });

  it("ignores optimistic updates when there are no settings yet", () => {
    render(
      <OrgSettings
        hasReporting={false}
        orgSettingsPromise={resolved({ ok: true, value: null })}
      />,
    );
    updateOptimistically({ report_frequency: "custom" });
    updateBreaksOptimistically({ dock_lunch: true });
    expect(screen.getByTestId("reporting")).toHaveTextContent("false|null");
    expect(screen.getByTestId("breaks")).toHaveTextContent("null");
  });

  it("merges optimistic reporting and break updates into the loaded settings", () => {
    const value = {
      org_id: "org_1",
      report_frequency: "weekly",
      report_day: null,
      report_interval: 1,
    };
    const breakValue: BreakSettingsData = {
      org_id: "org_1",
      dock_lunch: false,
      lunch_duration_minutes: 30,
      lunch_min_shift_hours: 5,
    };
    render(
      <OrgSettings
        breakSettingsPromise={resolved({ ok: true, value: breakValue })}
        hasReporting
        orgSettingsPromise={resolved({ ok: true, value })}
      />,
    );
    // The loaded row is passed straight down, so the saved values survive a refresh.
    expect(latest().initialData).toEqual(value);
    expect(latestBreak().initialData).toEqual(breakValue);

    updateOptimistically({ report_frequency: "custom", report_day: "Friday" });
    expect(latest().initialData).toEqual({
      ...value,
      report_frequency: "custom",
      report_day: "Friday",
    });

    updateBreaksOptimistically({
      dock_lunch: true,
      lunch_duration_minutes: 45,
    });
    expect(latestBreak().initialData).toEqual({
      ...breakValue,
      dock_lunch: true,
      lunch_duration_minutes: 45,
    });
  });

  it("passes the overtime settings down and merges optimistic updates", () => {
    const overtimeValue: OvertimeSettingsData = {
      org_id: "org_1",
      daily_threshold_hours: 8,
      weekly_threshold_hours: null,
    };
    render(
      <OrgSettings
        hasReporting={false}
        orgSettingsPromise={resolved({ ok: true, value: null })}
        overtimeSettingsPromise={resolved({ ok: true, value: overtimeValue })}
      />,
    );
    expect(latestOvertime().initialData).toEqual(overtimeValue);

    updateOvertimeOptimistically({ weekly_threshold_hours: 40 });
    expect(latestOvertime().initialData).toEqual({
      ...overtimeValue,
      weekly_threshold_hours: 40,
    });
  });

  it("passes no overtime settings when they are missing or failed to load", () => {
    render(
      <OrgSettings
        hasReporting={false}
        orgSettingsPromise={resolved({ ok: true, value: null })}
        overtimeSettingsPromise={resolved({
          ok: false,
          error: { reason: "x" },
        })}
      />,
    );
    expect(screen.getByTestId("overtime")).toHaveTextContent("null");
    // Nothing to merge into, so an optimistic update is a no-op.
    updateOvertimeOptimistically({ daily_threshold_hours: 8 });
    expect(latestOvertime().initialData).toBeNull();
  });
});
