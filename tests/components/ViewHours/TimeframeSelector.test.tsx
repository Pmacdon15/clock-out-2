import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({
  push: vi.fn(),
  useTimeframeDefaults: vi.fn(),
  params: new URLSearchParams("timezone=UTC"),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push }),
  usePathname: () => "/",
  useSearchParams: () => nav.params,
}));
vi.mock("@/hooks/useTimeframeDefaults", () => ({
  useTimeframeDefaults: nav.useTimeframeDefaults,
}));

import {
  TimeframeSelector,
  type TimeframeValue,
} from "@/components/ViewHours/TimeframeSelector";

const members = [
  { id: "me", name: "Me Myself" },
  { id: "u2", name: "Grace" },
];

function renderSelector(
  props: Partial<Parameters<typeof TimeframeSelector>[0]> = {},
) {
  return render(
    <TimeframeSelector
      availableYears={[2026, 2025]}
      endDate="2026-03-14T23:59:59.999"
      startDate="2026-03-08T00:00:00.000"
      timeframe="week"
      {...props}
    />,
  );
}

/** The params of the URL pushed by the nth navigation. */
const pushed = (n = 0) =>
  new URLSearchParams((nav.push.mock.calls[n][0] as string).split("?")[1]);

beforeEach(() => {
  nav.params = new URLSearchParams("timezone=UTC");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TimeframeSelector member picker", () => {
  it("is hidden for non-admins", () => {
    renderSelector({ members });
    expect(
      screen.queryByText(/Administrative Control/),
    ).not.toBeInTheDocument();
  });

  it("is hidden when there are no members", () => {
    renderSelector({ isAdmin: true, members: [] });
    expect(
      screen.queryByText(/Administrative Control/),
    ).not.toBeInTheDocument();
  });

  it("lists other members and selects one", () => {
    renderSelector({ isAdmin: true, members, currentUserId: "me" });
    expect(nav.useTimeframeDefaults).toHaveBeenCalled();
    const picker = screen.getByDisplayValue("My Own Hours (Self)");
    expect(screen.queryByRole("option", { name: "Me Myself" })).toBeNull();

    fireEvent.change(picker, { target: { value: "u2" } });
    expect(pushed().get("userId")).toBe("u2");
    expect(pushed().get("timezone")).toBe("UTC");
  });

  it("clears the user param when switching back to self", () => {
    nav.params = new URLSearchParams("userId=u2");
    renderSelector({ isAdmin: true, members, selectedUserId: "u2" });
    fireEvent.change(screen.getByDisplayValue("Grace"), {
      target: { value: "" },
    });
    expect(pushed().has("userId")).toBe(false);
  });
});

describe("TimeframeSelector timeframe tabs", () => {
  it.each<[TimeframeValue, string | null, string | null]>([
    ["week", "2026-03-08T00:00:00.000", "2026-03-14T23:59:59.999"],
    ["month", "2026-03-01T00:00:00.000", "2026-03-31T23:59:59.999"],
    ["year", "2026-01-01T00:00:00.000", "2026-12-31T23:59:59.999"],
    ["custom", null, null],
    ["all", null, null],
  ])("switching to %s sets the matching range", (t, start, end) => {
    renderSelector({ timeframe: "all" });
    fireEvent.click(screen.getByRole("button", { name: t.toUpperCase() }));
    const params = pushed();
    expect(params.get("timeframe")).toBe(t);
    expect(params.get("start")).toBe(start);
    expect(params.get("end")).toBe(end);
  });

  it("parses date-only start dates", () => {
    renderSelector({ startDate: "2026-03-20", timeframe: "all" });
    fireEvent.click(screen.getByRole("button", { name: "WEEK" }));
    expect(pushed().get("start")).toBe("2026-03-15T00:00:00.000");
  });

  it("falls back to today when there is no start date", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-02T12:00:00Z"));
    renderSelector({ startDate: "", timeframe: "all" });
    fireEvent.click(screen.getByRole("button", { name: "MONTH" }));
    expect(pushed().get("start")).toBe("2026-05-01T00:00:00.000");
  });
});

describe("TimeframeSelector range pickers", () => {
  it("week view picks a week, month or year", () => {
    renderSelector();
    const [week, month, year] = screen.getAllByRole("combobox");
    expect(
      screen.getByRole("option", { name: "Week 2 (8-14)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Week 4 (24-31)" }),
    ).toBeInTheDocument();

    fireEvent.change(week, {
      target: { value: "2026-03-22T00:00:00.000|2026-03-31T23:59:59.999" },
    });
    expect(pushed(0).get("start")).toBe("2026-03-22T00:00:00.000");
    expect(pushed(0).get("end")).toBe("2026-03-31T23:59:59.999");

    fireEvent.change(month, {
      target: { value: "2026-01-08T00:00:00.000|2026-01-14T23:59:59.999" },
    });
    expect(pushed(1).get("start")).toBe("2026-01-08T00:00:00.000");

    fireEvent.change(year, {
      target: { value: "2025-03-08T00:00:00.000|2025-03-14T23:59:59.999" },
    });
    expect(pushed(2).get("start")).toBe("2025-03-08T00:00:00.000");
  });

  it("month view picks a month or year", () => {
    renderSelector({
      timeframe: "month",
      startDate: "2026-03-01T00:00:00.000",
    });
    const [month, year] = screen.getAllByRole("combobox");
    expect(month).toHaveValue(
      "2026-03-01T00:00:00.000|2026-03-31T23:59:59.999",
    );
    fireEvent.change(year, {
      target: { value: "2025-03-01T00:00:00.000|2025-03-31T23:59:59.999" },
    });
    expect(pushed().get("start")).toBe("2025-03-01T00:00:00.000");
  });

  it("year view picks a year", () => {
    renderSelector({ timeframe: "year", startDate: "2026-01-01T00:00:00.000" });
    const [year] = screen.getAllByRole("combobox");
    fireEvent.change(year, {
      target: { value: "2025-01-01T00:00:00.000|2025-12-31T23:59:59.999" },
    });
    expect(pushed().get("end")).toBe("2025-12-31T23:59:59.999");
  });

  it("custom view edits start and end dates", () => {
    const { container } = renderSelector({
      timeframe: "custom",
      startDate: "2026-03-01",
      endDate: "2026-03-10",
    });
    const start = container.querySelector(
      'input[name="start-date"]',
    ) as HTMLInputElement;
    const end = container.querySelector(
      'input[name="end-date"]',
    ) as HTMLInputElement;
    expect(start).toHaveValue("2026-03-01");
    expect(end).toHaveValue("2026-03-10");

    fireEvent.change(start, { target: { value: "2026-03-02" } });
    expect(pushed(0).get("start")).toBe("2026-03-02");
    fireEvent.change(end, { target: { value: "2026-03-12" } });
    expect(pushed(1).get("end")).toBe("2026-03-12");
  });

  it("all view shows no range picker", () => {
    renderSelector({ timeframe: "all" });
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});
