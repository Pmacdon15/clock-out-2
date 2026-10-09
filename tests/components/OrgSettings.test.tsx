import { act, render, screen } from "@testing-library/react";
import { startTransition } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ReportingSettingsData } from "@/lib/types";
import { resolved } from "../utils";

type CapturedProps = {
  hasReporting: boolean;
  initialData: ReportingSettingsData | null;
  onUpdateOptimistic: (next: Partial<ReportingSettingsData>) => void;
};

const captured = vi.hoisted(() => ({ props: [] as CapturedProps[] }));

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

import OrgSettings from "@/components/OrgSettings";

const latest = () => captured.props[captured.props.length - 1];

/** Fires an optimistic update inside a transition that never settles. */
function updateOptimistically(next: Partial<ReportingSettingsData>) {
  act(() => {
    startTransition(async () => {
      latest().onUpdateOptimistic(next);
      await new Promise(() => {});
    });
  });
}

describe("OrgSettings", () => {
  it("passes no initial data when the settings failed to load", () => {
    render(
      <OrgSettings
        hasReporting
        orgSettingsPromise={resolved({ ok: false, error: { reason: "x" } })}
      />,
    );
    expect(screen.getByTestId("reporting")).toHaveTextContent("true|null");
  });

  it("ignores optimistic updates when there are no settings yet", () => {
    render(
      <OrgSettings
        hasReporting={false}
        orgSettingsPromise={resolved({ ok: true, value: null })}
      />,
    );
    updateOptimistically({ report_frequency: "custom" });
    expect(screen.getByTestId("reporting")).toHaveTextContent("false|null");
  });

  it("merges optimistic reporting updates into the loaded settings", () => {
    const value = {
      org_id: "org_1",
      report_frequency: "weekly",
      report_day: null,
      report_interval: 1,
    };
    render(
      <OrgSettings
        hasReporting
        orgSettingsPromise={resolved({ ok: true, value })}
      />,
    );
    // The loaded row has no nested `reporting` object, so nothing is passed yet.
    expect(latest().initialData).toBeNull();

    updateOptimistically({ report_frequency: "custom", report_day: "Friday" });
    expect(latest().initialData).toEqual({
      report_frequency: "custom",
      report_day: "Friday",
    });
  });
});
