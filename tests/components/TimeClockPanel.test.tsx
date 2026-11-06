import { act, render, screen } from "@testing-library/react";
import { startTransition } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EntryAction } from "@/lib/reducers/time-entries";
import type { TimeEntry } from "@/lib/types";
import { makeEntry, resolved } from "../utils";

const captured = vi.hoisted(() => ({
  props: [] as Record<string, unknown>[],
}));

vi.mock("@/components/time-clock", () => ({
  default: (props: Record<string, unknown>) => {
    captured.props.push(props);
    return <div data-testid="time-clock" />;
  },
}));

import TimeClockPanel from "@/components/TimeClockPanel";

const ok = <T,>(value: T) => resolved({ ok: true as const, value });
const failed = () =>
  resolved({ ok: false as const, error: { reason: "boom" } });
const latest = () => captured.props[captured.props.length - 1];

const location = { org_id: "org_1", capture_location: true } as never;
const breaks = { org_id: "org_1" } as never;

type Props = Parameters<typeof TimeClockPanel>[0];
function renderPanel(overrides: Partial<Props> = {}) {
  render(
    <TimeClockPanel
      breakSettingsPromise={ok(breaks)}
      hasGeofencingPromise={resolved(true)}
      isAdminPromise={resolved(true)}
      locationSettingsPromise={ok(location)}
      recentEntriesPromise={ok([makeEntry({ id: 7 })])}
      {...overrides}
    />,
  );
  return latest();
}

beforeEach(() => {
  captured.props = [];
});

describe("TimeClockPanel", () => {
  it("hands the clock its entries and settings", () => {
    const props = renderPanel();
    expect(screen.getByTestId("time-clock")).toBeInTheDocument();
    expect((props.initialEntries as TimeEntry[]).map((e) => e.id)).toEqual([7]);
    expect(props.isAdmin).toBe(true);
    expect(props.breakSettings).toBe(breaks);
    expect(props.locationSettings).toBe(location);
  });

  it("captures no location without the geofencing feature", () => {
    expect(
      renderPanel({ hasGeofencingPromise: resolved(false) }).locationSettings,
    ).toBeNull();
  });

  it("falls back to empty settings and entries when reads fail", () => {
    const props = renderPanel({
      breakSettingsPromise: failed(),
      locationSettingsPromise: failed(),
      recentEntriesPromise: failed(),
    });
    expect(props.breakSettings).toBeNull();
    expect(props.locationSettings).toBeNull();
    expect(props.initialEntries).toEqual([]);
  });

  it("treats a missing entry list as empty", () => {
    expect(
      renderPanel({ recentEntriesPromise: ok(null as never) }).initialEntries,
    ).toEqual([]);
  });

  it("shows a punch optimistically", () => {
    const props = renderPanel({ recentEntriesPromise: ok([]) });
    const add = props.setOptimisticEntries as (a: EntryAction) => void;
    act(() => {
      // Optimistic state holds while its transition is pending.
      startTransition(async () => {
        add({ type: "ADD", payload: makeEntry({ id: 99 }) });
        await new Promise(() => {});
      });
    });
    expect((latest().initialEntries as TimeEntry[]).map((e) => e.id)).toEqual([
      99,
    ]);
  });
});
