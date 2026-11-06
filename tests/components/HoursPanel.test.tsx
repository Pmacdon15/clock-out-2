import { act, render, screen } from "@testing-library/react";
import { startTransition } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HoursPanelProps } from "@/components/HoursPanel";
import type { EntryAction } from "@/lib/reducers/time-entries";
import type { TimeEntry } from "@/lib/types";
import { makeEntry, resolved } from "../utils";

const captured = vi.hoisted(() => ({
  props: [] as Record<string, unknown>[],
}));

vi.mock("@/components/ViewHours", () => ({
  default: (props: Record<string, unknown>) => {
    captured.props.push(props);
    return <div data-testid="view-hours" />;
  },
}));

import HoursPanel from "@/components/HoursPanel";

const ok = <T,>(value: T) => resolved({ ok: true as const, value });
const failed = () =>
  resolved({ ok: false as const, error: { reason: "boom" } });
const latest = () => captured.props[captured.props.length - 1];

const settings = {
  breaks: { org_id: "org_1" } as never,
  overtime: { org_id: "org_1", daily_threshold: 8 } as never,
  payPeriod: { org_id: "org_1", enabled: true } as never,
  payRates: [{ user_id: "u1", hourly_rate: 20 }] as never,
  payroll: { settings: null } as never,
};

function renderPanel(overrides: Partial<HoursPanelProps> = {}) {
  const orgTimeEntriesPromise = ok([]);
  const timeframePromise = resolved("month");
  render(
    <HoursPanel
      breakSettingsPromise={ok(settings.breaks)}
      entriesPromise={ok([makeEntry({ id: 3 })])}
      isAdminPromise={resolved(true)}
      orgTimeEntriesPromise={orgTimeEntriesPromise}
      overtimeSettingsPromise={ok(settings.overtime)}
      payPeriodSettingsPromise={ok(settings.payPeriod)}
      payRatesPromise={ok(settings.payRates)}
      payrollPromise={ok(settings.payroll)}
      timeframePromise={timeframePromise}
      {...overrides}
    />,
  );
  return { props: latest() ?? {}, orgTimeEntriesPromise, timeframePromise };
}

beforeEach(() => {
  captured.props = [];
});

describe("HoursPanel", () => {
  it("hands the hours view its entries, settings and URL filters", () => {
    const { props, orgTimeEntriesPromise, timeframePromise } = renderPanel();
    expect(screen.getByTestId("view-hours")).toBeInTheDocument();
    expect((props.entries as TimeEntry[]).map((e) => e.id)).toEqual([3]);
    expect(props).toMatchObject({
      isAdmin: true,
      breakSettings: settings.breaks,
      overtimeSettings: settings.overtime,
      payPeriodSettings: settings.payPeriod,
      payRates: settings.payRates,
      payroll: settings.payroll,
    });
    expect(props.orgTimeEntriesPromise).toBe(orgTimeEntriesPromise);
    expect(props.timeframePromise).toBe(timeframePromise);
  });

  it("falls back to empty settings when their reads fail", () => {
    const { props } = renderPanel({
      breakSettingsPromise: failed(),
      overtimeSettingsPromise: failed(),
      payPeriodSettingsPromise: failed(),
      payRatesPromise: failed(),
      payrollPromise: failed(),
    });
    expect(props).toMatchObject({
      breakSettings: null,
      overtimeSettings: null,
      payPeriodSettings: null,
      payRates: [],
      payroll: null,
    });
  });

  it("shows the error when entries fail to load", () => {
    renderPanel({ entriesPromise: failed() });
    expect(
      screen.getByText("Error fetching time entries: boom"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("view-hours")).toBeNull();
  });

  it("treats a missing entry list as empty", () => {
    const { props } = renderPanel({ entriesPromise: ok(null as never) });
    expect(props.entries).toEqual([]);
  });

  it("shows an edit optimistically", () => {
    const { props } = renderPanel();
    const update = props.setOptimisticEntries as (a: EntryAction) => void;
    act(() => {
      // Optimistic state holds while its transition is pending.
      startTransition(async () => {
        update({ type: "REMOVE", payload: 3 });
        await new Promise(() => {});
      });
    });
    expect(latest()?.entries).toEqual([]);
  });
});
