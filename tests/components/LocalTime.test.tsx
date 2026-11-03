import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import LocalTime from "@/components/LocalTime";

describe("LocalTime", () => {
  it("formats the time in the browser", () => {
    render(
      <p>
        Started at <LocalTime>{() => "8:05:00 AM"}</LocalTime>
      </p>,
    );
    expect(screen.getByText("Started at 8:05:00 AM")).toBeInTheDocument();
  });

  it("renders nothing on the server, so UTC text never reaches the page (#86)", () => {
    const formatTime = vi.fn(() => "2:05:00 PM");
    const html = renderToString(
      <p>
        Started at <LocalTime>{formatTime}</LocalTime>
      </p>,
    );
    expect(html).not.toContain("2:05:00 PM");
    expect(formatTime).not.toHaveBeenCalled();
  });
});
