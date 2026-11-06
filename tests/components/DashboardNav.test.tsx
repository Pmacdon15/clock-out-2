import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pathname: "/",
  isAdmin: false,
}));

vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));
vi.mock("@clerk/nextjs", () => ({
  Show: ({
    when,
    children,
  }: {
    when: { role: string };
    children: React.ReactNode;
  }) => (when.role === "org:admin" && mocks.isAdmin ? children : null),
}));

import DashboardNav from "@/components/DashboardNav";

beforeEach(() => {
  mocks.pathname = "/";
  mocks.isAdmin = false;
});

const link = (name: string) => screen.getByRole("link", { name });

describe("DashboardNav", () => {
  it("links every member to each dashboard page", () => {
    render(<DashboardNav />);
    expect(screen.getByRole("navigation", { name: "Dashboard" })).toHaveClass(
      // Scrolls sideways on phones instead of widening the page.
      "max-w-full",
      "overflow-x-auto",
    );
    expect(link("Time Clock")).toHaveAttribute("href", "/");
    expect(link("Hours")).toHaveAttribute("href", "/hours");
    expect(link("Notifications")).toHaveAttribute("href", "/notifications");
    expect(link("Schedule")).toHaveAttribute("href", "/schedule");
    expect(link("Time Off")).toHaveAttribute("href", "/time-off");
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
  });

  it("adds Settings for admins", () => {
    mocks.isAdmin = true;
    render(<DashboardNav />);
    expect(link("Settings")).toHaveAttribute("href", "/settings");
  });

  it("marks the page being viewed", () => {
    mocks.pathname = "/hours";
    render(<DashboardNav />);
    expect(link("Hours")).toHaveAttribute("aria-current", "page");
    expect(link("Hours")).toHaveClass("bg-white");
    expect(link("Time Clock")).not.toHaveAttribute("aria-current");
    expect(link("Time Clock")).not.toHaveClass("bg-white");
  });
});
