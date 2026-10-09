import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { COLORS } from "@/components/ViewHours/HoursLineChart";
import { MemberToggles } from "@/components/ViewHours/MemberToggles";

const members = Array.from({ length: 11 }, (_, i) => ({
  id: `u${i}`,
  name: `Member ${i}`,
}));

describe("MemberToggles", () => {
  it("offers to deselect all when every member is visible", () => {
    const toggleAll = vi.fn();
    render(
      <MemberToggles
        members={members}
        toggleAll={toggleAll}
        toggleMember={vi.fn()}
        visibleMemberIds={new Set(members.map((m) => m.id))}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Deselect All" }));
    expect(toggleAll).toHaveBeenCalled();
  });

  it("offers to select all when some members are hidden", () => {
    render(
      <MemberToggles
        members={members}
        toggleAll={vi.fn()}
        toggleMember={vi.fn()}
        visibleMemberIds={new Set(["u0"])}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Select All" }),
    ).toBeInTheDocument();
  });

  it("offers to select all when there are no members", () => {
    render(
      <MemberToggles
        members={[]}
        toggleAll={vi.fn()}
        toggleMember={vi.fn()}
        visibleMemberIds={new Set()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Select All" }),
    ).toBeInTheDocument();
  });

  it("toggles a member and cycles through the palette", () => {
    const toggleMember = vi.fn();
    render(
      <MemberToggles
        members={members}
        toggleAll={vi.fn()}
        toggleMember={toggleMember}
        visibleMemberIds={new Set(["u0"])}
      />,
    );
    const first = screen.getByRole("button", { name: "Member 0" });
    const last = screen.getByRole("button", { name: "Member 10" });
    expect(first.className).toContain("bg-zinc-100");
    expect(last.className).toContain("opacity-50");

    // The 11th member wraps back to the first color.
    const swatch = last.querySelector("div > div") as HTMLElement;
    expect(swatch.style.backgroundColor).toBe(
      first.querySelector<HTMLElement>("div > div")?.style.backgroundColor,
    );
    expect(COLORS).toHaveLength(10);

    fireEvent.click(last);
    expect(toggleMember).toHaveBeenCalledWith("u10");
  });
});
