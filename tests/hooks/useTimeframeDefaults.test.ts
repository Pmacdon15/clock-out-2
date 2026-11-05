import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({
  replace: vi.fn(),
  params: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace }),
  usePathname: () => "/",
  useSearchParams: () => nav.params,
}));

import { useTimeframeDefaults } from "@/hooks/useTimeframeDefaults";
import type { PayPeriodSettingsData } from "@/lib/types";

const payPeriods = (
  overrides: Partial<PayPeriodSettingsData> = {},
): PayPeriodSettingsData => ({
  org_id: "org_1",
  enabled: true,
  frequency: "weekly",
  // A Friday; each period runs Saturday to Friday, paid a week later.
  anchor_payday: "2026-11-13",
  holdback_days: 7,
  ...overrides,
});

/** Renders the hook with the given query string and returns the replaced URL's params. */
function renderWith(query: string, settings?: PayPeriodSettingsData | null) {
  nav.params = new URLSearchParams(query);
  renderHook(() => useTimeframeDefaults(settings));
  if (nav.replace.mock.calls.length === 0) return null;
  const [url, options] = nav.replace.mock.calls[0];
  expect(options).toEqual({ scroll: false });
  expect(url.startsWith("/?")).toBe(true);
  return new URLSearchParams(url.slice(2));
}

describe("useTimeframeDefaults", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // Feb 10 falls in week 2 of the month.
    vi.setSystemTime(new Date("2026-02-10T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fills in timezone and the current week when nothing is set", () => {
    const params = renderWith("");
    expect(params?.get("timezone")).toBe("UTC");
    expect(params?.get("timeframe")).toBe("week");
    expect(params?.get("start")).toBe("2026-02-08T00:00:00.000");
    expect(params?.get("end")).toBe("2026-02-14T23:59:59.999");
  });

  it("caps the week at 4 late in the month", () => {
    vi.setSystemTime(new Date("2026-01-30T12:00:00Z"));
    const params = renderWith("timezone=UTC");
    expect(params?.get("start")).toBe("2026-01-22T00:00:00.000");
    expect(params?.get("end")).toBe("2026-01-31T23:59:59.999");
  });

  it("fills in the current month for the month timeframe", () => {
    const params = renderWith("timezone=America/Regina&timeframe=month");
    expect(params?.get("timezone")).toBe("America/Regina");
    expect(params?.get("start")).toBe("2026-02-01T00:00:00.000");
    expect(params?.get("end")).toBe("2026-02-28T23:59:59.999");
  });

  it("fills in the current year for the year timeframe", () => {
    const params = renderWith("timezone=UTC&timeframe=year&start=x");
    expect(params?.get("start")).toBe("2026-01-01T00:00:00.000");
    expect(params?.get("end")).toBe("2026-12-31T23:59:59.999");
  });

  it("leaves dates unset for timeframes without a default range", () => {
    const params = renderWith("timezone=UTC&timeframe=custom");
    expect(params?.get("timeframe")).toBe("custom");
    expect(params?.has("start")).toBe(false);
    expect(params?.has("end")).toBe(false);
  });

  it("only adds the timezone when the range is already complete", () => {
    const params = renderWith("timeframe=week&start=a&end=b");
    expect(params?.get("timezone")).toBe("UTC");
    expect(params?.get("start")).toBe("a");
    expect(params?.get("end")).toBe("b");
  });

  it("defaults to the current pay period when pay periods are on", () => {
    const params = renderWith("timezone=UTC", payPeriods());
    expect(params?.get("timeframe")).toBe("pay-period");
    expect(params?.get("start")).toBe("2026-02-07T00:00:00.000");
    expect(params?.get("end")).toBe("2026-02-13T23:59:59.999");
  });

  it("falls back to the week when pay periods are off", () => {
    const params = renderWith("timezone=UTC", payPeriods({ enabled: false }));
    expect(params?.get("timeframe")).toBe("week");
    expect(params?.get("start")).toBe("2026-02-08T00:00:00.000");
  });

  it("swaps a pay-period link for the week when pay periods are off", () => {
    const params = renderWith("timezone=UTC&timeframe=pay-period", null);
    expect(params?.get("timeframe")).toBe("week");
    expect(params?.get("start")).toBe("2026-02-08T00:00:00.000");
  });

  it("keeps an explicit timeframe when pay periods are on", () => {
    const params = renderWith("timezone=UTC&timeframe=month", payPeriods());
    expect(params?.get("timeframe")).toBe("month");
    expect(params?.get("start")).toBe("2026-02-01T00:00:00.000");
  });

  it("does nothing when every param is present", () => {
    expect(renderWith("timezone=UTC&timeframe=week&start=a&end=b")).toBeNull();
  });
});
