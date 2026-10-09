import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { Button, Card, Skeleton } from "@/components/ui";
import {
  ExternalLinkIcon,
  FileTextIcon,
  MailIcon,
  ShieldIcon,
} from "@/components/ui/Icons";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

describe("Card", () => {
  it("merges classes and forwards refs and props", () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <Card className="p-8" data-testid="card" ref={ref}>
        body
      </Card>,
    );
    const card = screen.getByTestId("card");
    expect(card).toHaveClass("rounded-xl", "p-8");
    expect(ref.current).toBe(card);
  });
});

describe("Button", () => {
  it("uses the default variant and size", () => {
    render(<Button>Go</Button>);
    expect(screen.getByRole("button", { name: "Go" })).toHaveClass(
      "bg-zinc-900",
      "h-10",
    );
  });

  it.each([
    ["outline", "border-zinc-200"],
    ["ghost", "hover:bg-zinc-100"],
    ["destructive", "bg-red-500"],
  ] as const)("applies the %s variant", (variant, cls) => {
    render(<Button variant={variant}>Go</Button>);
    expect(screen.getByRole("button")).toHaveClass(cls);
  });

  it.each([
    ["sm", "h-9"],
    ["lg", "h-11"],
  ] as const)("applies the %s size", (size, cls) => {
    render(<Button size={size}>Go</Button>);
    expect(screen.getByRole("button")).toHaveClass(cls);
  });

  it("passes through button props", () => {
    const onClick = vi.fn();
    render(
      <Button className="extra" onClick={onClick}>
        Go
      </Button>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalled();
    expect(screen.getByRole("button")).toHaveClass("extra");
  });
});

describe("Skeleton", () => {
  it("renders a pulsing placeholder", () => {
    render(<Skeleton className="h-4" data-testid="sk" />);
    expect(screen.getByTestId("sk")).toHaveClass("animate-pulse", "h-4");
  });
});

describe("Icons", () => {
  it.each([
    [ExternalLinkIcon, "External Link"],
    [MailIcon, "Email"],
    [ShieldIcon, "Security Shield"],
    [FileTextIcon, "Document"],
  ])("renders %o with an accessible title", (Icon, title) => {
    const { container } = render(<Icon className="h-4" />);
    expect(screen.getByTitle(title)).toBeInTheDocument();
    expect(container.querySelector("svg")).toHaveClass("h-4");
  });
});

describe("Tabs", () => {
  function Example(props: Partial<Parameters<typeof Tabs>[0]>) {
    return (
      <Tabs className="tabs" {...props}>
        <TabsList className="list">
          <TabsTrigger className="t" value="a">
            A
          </TabsTrigger>
          <TabsTrigger value="b">B</TabsTrigger>
        </TabsList>
        <TabsContent className="c" value="a">
          Panel A
        </TabsContent>
        <TabsContent value="b">Panel B</TabsContent>
      </Tabs>
    );
  }

  it("shows the default tab and switches on click", () => {
    const onValueChange = vi.fn();
    render(<Example defaultValue="a" onValueChange={onValueChange} />);
    expect(screen.getByText("Panel A")).toBeInTheDocument();
    expect(screen.queryByText("Panel B")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "A" })).toHaveClass("bg-white");

    fireEvent.click(screen.getByRole("button", { name: "B" }));
    expect(screen.getByText("Panel B")).toBeInTheDocument();
    expect(onValueChange).toHaveBeenCalledWith("b");
  });

  it("works without a change handler", () => {
    render(<Example defaultValue="a" />);
    fireEvent.click(screen.getByRole("button", { name: "B" }));
    expect(screen.getByText("Panel B")).toBeInTheDocument();
  });

  it("follows the controlled value", () => {
    const { rerender } = render(<Example value="b" />);
    expect(screen.getByText("Panel B")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "A" }));
    expect(screen.getByText("Panel B")).toBeInTheDocument();
    rerender(<Example value="a" />);
    expect(screen.getByText("Panel A")).toBeInTheDocument();
  });

  it("shows nothing when no tab is selected", () => {
    render(<Example />);
    expect(screen.queryByText(/Panel/)).not.toBeInTheDocument();
  });

  it("requires a Tabs parent", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<TabsTrigger value="a">A</TabsTrigger>)).toThrow(
      "TabsTrigger must be used within Tabs",
    );
    expect(() => render(<TabsContent value="a">A</TabsContent>)).toThrow(
      "TabsContent must be used within Tabs",
    );
  });
});
