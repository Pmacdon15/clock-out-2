import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DaysWorkedBreakdown } from "@/components/ViewHours/DaysWorkedBreakdown";
import { makeEntry } from "../../utils";

/** The "N shift(s)" label next to the given weekday. */
const countFor = (shortLabel: string) =>
  screen.getByText(shortLabel).parentElement?.lastElementChild?.textContent;

const at = (iso: string, user_id = "u1") =>
  makeEntry({ clock_in: new Date(iso), user_id });

describe("DaysWorkedBreakdown", () => {
  it("counts unique days worked per weekday", () => {
    render(
      <DaysWorkedBreakdown
        entries={[
          at("2026-01-05T09:00:00Z"), // Monday
          at("2026-01-05T13:00:00Z"), // same Monday, counted once
          at("2026-01-12T09:00:00Z"), // another Monday
          at("2026-01-11T09:00:00Z"), // Sunday
        ]}
      />,
    );
    expect(countFor("Mon")).toBe("2 shifts");
    expect(countFor("Sun")).toBe("1 shift");
    expect(countFor("Tue")).toBe("0 shifts");
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(
      screen.getByText(
        "How your working days are distributed across the week.",
      ),
    ).toBeInTheDocument();
  });

  it("counts each member separately when viewing everyone", () => {
    render(
      <DaysWorkedBreakdown
        entries={[
          at("2026-01-06T09:00:00Z", "u1"),
          at("2026-01-06T09:00:00Z", "u2"),
          at("2026-01-06T15:00:00Z", "u2"),
        ]}
        isViewingAll
      />,
    );
    expect(countFor("Tue")).toBe("2 shifts");
    expect(
      screen.getByText(
        "Cumulative distribution of workdays completed by team members.",
      ),
    ).toBeInTheDocument();
  });

  it("renders empty bars when there are no entries", () => {
    render(<DaysWorkedBreakdown entries={[]} />);
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(countFor("Fri")).toBe("0 shifts");
  });
});
