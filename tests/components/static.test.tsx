import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs", () => ({
  Show: ({ when, children }: { when: string; children: React.ReactNode }) => (
    <div data-testid={`show-${when}`}>{children}</div>
  ),
  SignInButton: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="sign-in">{children}</div>
  ),
  OrganizationSwitcher: () => <div data-testid="org-switcher" />,
  UserButton: () => <div data-testid="user-button" />,
}));
vi.mock("@clerk/ui/themes", () => ({ dark: {} }));

import Footer from "@/components/Footer";
import DashboardSkeleton from "@/components/fallbacks/home-page-fallback";
import { SettingsFallback } from "@/components/fallbacks/settings-fallback";
import { ViewHoursFallback } from "@/components/fallbacks/view-hours-fallback";
import MainPageHeader from "@/components/headers/main-page-header";

describe("fallbacks", () => {
  it("renders the dashboard skeleton", () => {
    const { container } = render(<DashboardSkeleton />);
    expect(container.firstChild).toHaveClass("animate-pulse");
  });

  it("renders a placeholder for each settings option", () => {
    const { container } = render(<SettingsFallback />);
    expect(container.querySelectorAll(".rounded-2xl")).toHaveLength(4);
  });

  it("renders placeholders for the hours view", () => {
    const { container } = render(<ViewHoursFallback />);
    expect(container.querySelectorAll(".h-8.w-16")).toHaveLength(5);
    expect(container.querySelectorAll(".p-4")).toHaveLength(3);
  });
});

describe("Footer", () => {
  it("links to every public page and the contact address", () => {
    render(<Footer />);
    const hrefs = screen
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual([
      "/",
      "/plans",
      "/privacy",
      "/tos",
      "mailto:patrick@patmac.ca",
    ]);
    expect(screen.getByTitle("Email")).toBeInTheDocument();
  });
});

describe("MainPageHeader", () => {
  it("shows account controls when signed in and a sign-in button otherwise", () => {
    render(<MainPageHeader />);
    expect(
      screen.getByRole("heading", { name: "Clock Out" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Plans" })).toHaveAttribute(
      "href",
      "/plans",
    );
    expect(screen.getByTestId("show-signed-in")).toContainElement(
      screen.getByTestId("org-switcher"),
    );
    expect(screen.getByTestId("show-signed-in")).toContainElement(
      screen.getByTestId("user-button"),
    );
    expect(screen.getByTestId("show-signed-out")).toContainElement(
      screen.getByRole("button", { name: "Sign In" }),
    );
  });
});
