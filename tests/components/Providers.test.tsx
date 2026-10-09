import { useQueryClient } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs", () => ({
  ClerkProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="clerk">{children}</div>
  ),
}));
vi.mock("sonner", () => ({
  Toaster: ({ position }: { position: string }) => (
    <div data-testid="toaster">{position}</div>
  ),
}));

import { Providers } from "@/components/Providers";

function UsesQueryClient() {
  const client = useQueryClient();
  return <span>{client ? "has client" : "no client"}</span>;
}

describe("Providers", () => {
  it("wraps children in Clerk and React Query and mounts the toaster", () => {
    render(
      <Providers>
        <UsesQueryClient />
      </Providers>,
    );
    expect(screen.getByTestId("clerk")).toContainElement(
      screen.getByText("has client"),
    );
    expect(screen.getByTestId("toaster")).toHaveTextContent("bottom-right");
  });
});
