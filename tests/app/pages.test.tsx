import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "font-sans-var" }),
  Geist_Mono: () => ({ variable: "font-mono-var" }),
}));
vi.mock("@vercel/analytics/next", () => ({
  Analytics: () => <div data-testid="analytics" />,
}));
vi.mock("@/components/Providers", () => ({
  Providers: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="providers">{children}</div>
  ),
}));
vi.mock("@/components/Footer", () => ({
  default: () => <footer data-testid="footer" />,
}));
vi.mock("@clerk/nextjs", () => ({
  PricingTable: ({ for: forType }: { for: string }) => (
    <div data-testid="pricing">{forType}</div>
  ),
}));

import RootLayout, { metadata } from "@/app/layout";
import PlansPage from "@/app/plans/page";
import PrivacyPage from "@/app/privacy/page";
import TOSPage from "@/app/tos/page";

describe("RootLayout", () => {
  it("wraps pages with fonts, providers, analytics and the footer", () => {
    const html = renderToStaticMarkup(
      <RootLayout>
        <p>page body</p>
      </RootLayout>,
    );
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.documentElement.getAttribute("lang")).toBe("en");
    expect(doc.body.className).toContain("font-sans-var");
    expect(doc.body.className).toContain("font-mono-var");
    const providers = doc.querySelector('[data-testid="providers"]');
    expect(providers?.querySelector("main")?.textContent).toBe("page body");
    expect(
      providers?.querySelector('[data-testid="analytics"]'),
    ).not.toBeNull();
    expect(providers?.querySelector('[data-testid="footer"]')).not.toBeNull();
  });

  it("describes the app in its metadata", () => {
    expect(metadata).toEqual({
      title: "Clock Out | Simple Time Tracking",
      description: "Clean and efficient time tracking for your organization.",
    });
  });
});

describe("PlansPage", () => {
  it("shows the organization pricing table and a way back", () => {
    render(<PlansPage />);
    expect(
      screen.getByRole("heading", { name: "Simple, Transparent Pricing." }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("pricing")).toHaveTextContent("organization");
    expect(
      screen.getByRole("link", { name: /Back to Dashboard/ }),
    ).toHaveAttribute("href", "/");
    expect(screen.getByText("patrick@patmac.ca")).toBeInTheDocument();
  });
});

describe.each([
  ["PrivacyPage", PrivacyPage, "Privacy Policy"],
  ["TOSPage", TOSPage, "Terms of Service"],
])("%s", (_name, Page, title) => {
  it("renders the policy with a contact link", () => {
    render(<Page />);
    expect(
      screen.getByRole("heading", { level: 1, name: title }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 }).length).toBeGreaterThan(
      1,
    );
    expect(
      screen
        .getAllByRole("link")
        .some(
          (link) => link.getAttribute("href") === "mailto:patrick@patmac.ca",
        ),
    ).toBe(true);
  });
});
