import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import NextShiftCard from "@/components/NextShiftCard";
import type { ScheduledShiftWithStatus, ShiftStatus } from "@/lib/types";
import { resolved } from "../utils";

function shift(
  status: ShiftStatus,
  overrides: Partial<ScheduledShiftWithStatus> = {},
): ScheduledShiftWithStatus {
  return {
    id: 1,
    org_id: "org_1",
    user_id: "me",
    shift_start: new Date("2026-11-04T09:00:00Z"),
    shift_end: new Date("2026-11-04T17:00:00Z"),
    note: null,
    created_by: "admin_1",
    status,
    actual_clock_in: null,
    actual_clock_out: null,
    minutes_late: null,
    ...overrides,
  };
}

function renderCard(shifts: ScheduledShiftWithStatus[] | null) {
  return render(
    <NextShiftCard
      schedulePromise={resolved(
        shifts
          ? { ok: true as const, value: shifts }
          : { ok: false as const, error: { reason: "boom" } },
      )}
      userIdPromise={resolved("me")}
    />,
  );
}

describe("NextShiftCard", () => {
  it("renders nothing without a shift or when the schedule failed", () => {
    expect(renderCard([]).container).toBeEmptyDOMElement();
    expect(renderCard(null).container).toBeEmptyDOMElement();
  });

  it("shows the next shift with its note", () => {
    renderCard([shift("scheduled", { note: "Front desk" })]);
    const card = screen.getByRole("region", { name: "Next shift" });
    expect(card).toHaveTextContent("Wed, Nov 4 · 9:00 AM – 5:00 PM");
    expect(card).toHaveTextContent("Front desk");
  });

  it("shows when the current shift ends", () => {
    renderCard([shift("on_time")]);
    expect(screen.getByRole("region", { name: "On shift" })).toHaveTextContent(
      "Until 5:00 PM",
    );
  });

  it("warns a member who hasn't clocked in for a shift that started", () => {
    renderCard([shift("not_clocked_in")]);
    const card = screen.getByRole("region", {
      name: "You're late for your shift",
    });
    expect(card).toHaveTextContent("It started at 9:00 AM. Clock in below.");
    expect(card.className).toContain("bg-red-50");
  });
});
