import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/og", () => ({
  ImageResponse: class {
    constructor(
      public element: ReactElement,
      public options: { width: number; height: number },
    ) {}
  },
}));

import OpengraphImage, { alt, contentType, size } from "@/app/opengraph-image";
import PlansLayout, { metadata as plansMetadata } from "@/app/plans/layout";

describe("opengraph-image", () => {
  it("renders a 1200x630 PNG share card for the site", () => {
    expect(size).toEqual({ width: 1200, height: 630 });
    expect(contentType).toBe("image/png");
    expect(alt).toContain("Clock Out");

    const image = OpengraphImage() as unknown as {
      element: ReactElement;
      options: typeof size;
    };
    expect(image.options).toEqual(size);
    render(image.element);
    expect(screen.getByText("Clock Out")).toBeInTheDocument();
    expect(screen.getByText("Time tracking, simplified.")).toBeInTheDocument();
  });
});

describe("PlansLayout", () => {
  it("gives the plans page its title and canonical", () => {
    expect(plansMetadata).toMatchObject({
      title: "Pricing",
      alternates: { canonical: "/plans" },
    });
    expect(plansMetadata.description).toBeTruthy();
  });

  it("renders its children unchanged", () => {
    render(<PlansLayout>{<p>plans body</p>}</PlansLayout>);
    expect(screen.getByText("plans body")).toBeInTheDocument();
  });
});
