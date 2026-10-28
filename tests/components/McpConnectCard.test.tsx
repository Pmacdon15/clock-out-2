import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import McpConnectCard from "@/components/McpConnectCard";

describe("McpConnectCard", () => {
  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.useFakeTimers();
    Object.assign(navigator, {
      clipboard: { writeText },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("displays the MCP server URL and copies it to the clipboard", async () => {
    render(<McpConnectCard />);

    expect(
      screen.getByRole("heading", {
        name: /Use Clock Out inside Claude, Gemini, and Muse/i,
      }),
    ).toBeInTheDocument();

    const codeEl = screen.getByTestId("mcp-endpoint-url");
    expect(codeEl.textContent).toContain("/api/mcp");

    const copyBtn = screen.getByRole("button", { name: "Copy MCP server URL" });
    expect(copyBtn).toHaveTextContent("Copy URL");

    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(writeText).toHaveBeenCalledWith(codeEl.textContent);
    expect(copyBtn).toHaveTextContent("Copied");

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(copyBtn).toHaveTextContent("Copy URL");
  });

  it("falls back to the default production URL when window.location.origin is empty", () => {
    vi.spyOn(window, "location", "get").mockReturnValue({
      origin: "",
    } as Location);

    render(<McpConnectCard />);
    expect(screen.getByTestId("mcp-endpoint-url")).toHaveTextContent(
      "https://clockout.patmac.ca/api/mcp",
    );
  });
});
