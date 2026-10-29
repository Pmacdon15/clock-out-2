import { act, render, screen } from "@testing-library/react";
import { startTransition } from "react";
import { describe, expect, it, vi } from "vitest";
import type { BreakSettingsData, ReportingSettingsData } from "@/lib/types";
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

const captured = vi.hoisted(() => ({
  props: [] as CapturedProps[],
  breakProps: [] as CapturedBreakProps[],
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

import OrgSettings from "@/components/OrgSettings";

const latest = () => captured.props[captured.props.length - 1];
const latestBreak = () => captured.breakProps[captured.breakProps.length - 1];

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
