import { act, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveDashboardData } from "@/lib/live-dashboard";
import { resolved } from "../utils";

const mocks = vi.hoisted(() => {
  const refresh = vi.fn();
  // Next's router is the same object on every render.
  return { refresh, router: { refresh } };
});

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
}));

import LiveDashboard, { REFRESH_MS, TICK_MS } from "@/components/LiveDashboard";

const data = (over: Partial<LiveDashboardData> = {}): LiveDashboardData => ({
  members: [
    { id: "u1", name: "Ann" },
    { id: "u2", name: "Bo" },
  ],
  breakSettings: null,
  hourlyRates: { u1: 20 },
  shifts: [
    {
      id: 1,
      userId: "u1",
      clockIn: "2026-03-10T09:00:00Z",
      clockOut: null,
      skipLunch: false,
      breaks: [],
      siteName: "Depot",
    },
    {
      id: 2,
      userId: "u2",
      clockIn: "2026-03-10T10:00:00Z",
      clockOut: null,
      skipLunch: false,
      breaks: [
        {
          break_type: "unpaid_meal",
          break_start: "2026-03-10T14:30:00Z" as never,
          break_end: null,
        },
      ],
      siteName: null,
    },
  ],
  ...over,
});

/** The big number on the stat card with this label. */
const statValue = (label: string) =>
  screen.getByText(label).parentElement?.nextElementSibling ?? null;

const show = (value: LiveDashboardData) =>
  render(<LiveDashboard dataPromise={resolved({ ok: true, value })} />);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-10T15:00:00Z"));
});

describe("LiveDashboard", () => {
  it("shows the headcount, today's hours and cost, and who's working", () => {
    show(data());
    expect(statValue("On the clock")).toHaveTextContent("2");
    expect(screen.getByText("of 2 members")).toBeInTheDocument();
    expect(statValue("On break")).toHaveTextContent("1");
    expect(screen.getByText("0 off the clock")).toBeInTheDocument();
    // Ann 6h + Bo 4.5h net.
    expect(statValue("Hours today")).toHaveTextContent("10h 30m");
    expect(statValue("Labour cost today")).toHaveTextContent("$120.00");
    expect(screen.getByText(/isn't costed: no pay rate for Bo/)).toBeVisible();
    expect(
      screen.getByText("Updated 3:00 PM · refreshes every minute"),
    ).toBeInTheDocument();

    expect(screen.getByText("Ann")).toBeInTheDocument();
    expect(screen.getByText("In since 9:00 AM · Depot")).toBeInTheDocument();
    expect(screen.getByText("In since 10:00 AM")).toBeInTheDocument();
    expect(screen.getByText("Working")).toBeInTheDocument();
    expect(screen.getByText("Meal period")).toBeInTheDocument();
    expect(screen.getByText("$20.00/h")).toBeInTheDocument();
  });

  it("says when nobody is working, with singular wording", () => {
    show(data({ members: [{ id: "u1", name: "Ann" }], shifts: [] }));
    expect(screen.getByText("Nobody is on the clock right now.")).toBeVisible();
    expect(screen.getByText("of 1 member")).toBeInTheDocument();
    expect(screen.queryByText(/isn't costed/)).toBeNull();
  });

  it("ticks forward and refreshes from the server", () => {
    show(data());
    act(() => {
      vi.advanceTimersByTime(TICK_MS);
    });
    expect(mocks.refresh).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(REFRESH_MS - TICK_MS);
    });
    // Only Ann is accruing (Bo is on an unpaid break): a minute later.
    expect(statValue("Hours today")).toHaveTextContent("10h 31m");
    expect(mocks.refresh).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
  });

  it("refreshes when the tab comes back into view", () => {
    const { unmount } = show(data());
    const state = vi.spyOn(document, "visibilityState", "get");
    state.mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(mocks.refresh).not.toHaveBeenCalled();
    state.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);

    unmount();
    document.dispatchEvent(new Event("visibilitychange"));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("shows the reason when the read failed", () => {
    render(
      <LiveDashboard
        dataPromise={resolved({ ok: false, error: { reason: "Admins only" } })}
      />,
    );
    expect(screen.getByText("Admins only")).toBeInTheDocument();
  });

  it("renders a loading state on the server, before the local clock is known", () => {
    const html = renderToString(
      <LiveDashboard dataPromise={resolved({ ok: true, value: data() })} />,
    );
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain("On the clock");
  });
});
