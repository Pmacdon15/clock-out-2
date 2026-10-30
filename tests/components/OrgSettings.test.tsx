import { act, render, screen } from "@testing-library/react";
import { startTransition } from "react";
import { describe, expect, it, vi } from "vitest";
import type {
  BreakSettingsData,
  LocationSettingsData,
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

const captured = vi.hoisted(() => ({
  props: [] as CapturedProps[],
  breakProps: [] as CapturedBreakProps[],
  locationProps: [] as CapturedLocationProps[],
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

import OrgSettings from "@/components/OrgSettings";

const latest = () => captured.props[captured.props.length - 1];
const latestBreak = () => captured.breakProps[captured.breakProps.length - 1];
const latestLocation = () =>
  captured.locationProps[captured.locationProps.length - 1];

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
    // The loaded row has no nested `reporting` object, so nothing is passed yet.
    expect(latest().initialData).toBeNull();
    expect(latestBreak().initialData).toEqual(breakValue);

    updateOptimistically({ report_frequency: "custom", report_day: "Friday" });
    expect(latest().initialData).toEqual({
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
});
