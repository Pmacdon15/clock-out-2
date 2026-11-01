import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TimeOffSummary } from "@/components/ViewHours/TimeOffSummary";
import type { TimeOffRequest } from "@/lib/types";

let nextId = 1;
function request(overrides: Partial<TimeOffRequest> = {}): TimeOffRequest {
  return {
    id: nextId++,
    org_id: "org_1",
    user_id: "u1",
    request_type: "vacation",
    start_date: "2026-03-09",
    end_date: "2026-03-10",
    hours_per_day: 8,
    note: null,
    status: "approved",
    reviewed_by: "a",
    reviewed_at: null,
    ...overrides,
  };
}

const members = [{ id: "u1", name: "Ada" }];

function renderSummary(requests: TimeOffRequest[], userId: string | null) {
  return render(
    <TimeOffSummary
      endDate="2026-03-14"
      members={members}
      requests={requests}
      startDate="2026-03-08"
      userId={userId}
    />,
  );
}

describe("TimeOffSummary", () => {
  it("renders nothing without approved time off in range", () => {
    const { container } = renderSummary(
      [
        request({ status: "pending" }),
        request({ status: "denied" }),
        request({ start_date: "2026-04-01", end_date: "2026-04-02" }),
        request({ user_id: "u2" }),
      ],
      "u1",
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("lists one member's time off clipped to the range, oldest first", () => {
    renderSummary(
      [
        request({
          request_type: "sick",
          start_date: "2026-03-12",
          end_date: "2026-03-12",
          hours_per_day: 7.5,
        }),
        // Only Mar 8 is in range.
        request({ start_date: "2026-03-05", end_date: "2026-03-08" }),
      ],
      "u1",
    );
    expect(screen.getByText("Approved time off")).toBeVisible();
    expect(screen.getByText("15.5h")).toBeVisible();
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Vacation · Mar 5 – Mar 8, 2026");
    expect(items[0]).toHaveTextContent("8h");
    expect(items[1]).toHaveTextContent("Sick day · Mar 12, 2026");
    expect(screen.queryByText(/Ada/)).toBeNull();
  });

  it("names each member in the org view", () => {
    renderSummary([request(), request({ user_id: "gone" })], null);
    expect(screen.getByText(/Ada ·/)).toBeVisible();
    expect(screen.getByText(/Unknown member ·/)).toBeVisible();
    expect(screen.getByText("32h")).toBeVisible();
  });
});
