import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CalendarSubscribe from "@/components/CalendarSubscribe";

const resetCalendarFeedAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/calendar-feed-actions", () => ({ resetCalendarFeedAction }));

import { renderWithClient, resolved } from "../utils";

const FEED = `${window.location.origin}/api/calendar/tok.ics`;

function renderCard(path: string | null = "/api/calendar/tok.ics") {
  return renderWithClient(
    <CalendarSubscribe feedPathPromise={resolved(path)} />,
  );
}

describe("CalendarSubscribe", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renders nothing without a feed", async () => {
    const { container } = renderCard(null);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("is tucked away, and offers no Google subscription", async () => {
    renderCard();
    fireEvent.click(
      await screen.findByText("Use Apple Calendar or Outlook instead?"),
    );
    expect(
      screen.getByRole("button", { name: "Apple Calendar" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Google Calendar" }),
    ).toBeNull();
  });

  it("opens the Outlook subscription in a new tab", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    renderCard();
    fireEvent.click(
      await screen.findByRole("button", { name: "Outlook", hidden: true }),
    );
    const outlook = new URL(open.mock.calls[0][0] as string);
    expect(outlook.searchParams.get("url")).toBe(FEED);
    expect(open.mock.calls[0][1]).toBe("_blank");
  });

  it("hands Apple Calendar a webcal link", async () => {
    const original = window.location;
    const location = { ...original, href: original.href };
    Object.defineProperty(window, "location", {
      configurable: true,
      value: location,
    });
    try {
      renderCard();
      fireEvent.click(
        await screen.findByRole("button", {
          name: "Apple Calendar",
          hidden: true,
        }),
      );
      expect(location.href).toBe(FEED.replace(/^https?:\/\//, "webcal://"));
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: original,
      });
    }
  });

  it("resets the link after confirming, and uses the new one", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    resetCalendarFeedAction.mockResolvedValueOnce({
      status: "ok",
      path: "/api/calendar/new.ics",
    });
    renderCard();
    fireEvent.click(
      await screen.findByRole("button", { name: "Reset link", hidden: true }),
    );
    expect(
      await screen.findByText("Link reset. Subscribe again with the new link."),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Outlook", hidden: true }),
    );
    expect(String(open.mock.calls[0]?.[0])).toContain(
      encodeURIComponent("/api/calendar/new.ics"),
    );
  });

  it("does nothing when the reset isn't confirmed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    resetCalendarFeedAction.mockClear();
    renderCard();
    fireEvent.click(
      await screen.findByRole("button", { name: "Reset link", hidden: true }),
    );
    expect(resetCalendarFeedAction).not.toHaveBeenCalled();
  });

  it("shows the error when a reset fails", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    resetCalendarFeedAction.mockResolvedValueOnce({
      status: "error",
      error: "Couldn't reset the calendar link. Try again.",
    });
    renderCard();
    fireEvent.click(
      await screen.findByRole("button", { name: "Reset link", hidden: true }),
    );
    expect(
      await screen.findByText("Couldn't reset the calendar link. Try again."),
    ).toBeInTheDocument();
  });
});
