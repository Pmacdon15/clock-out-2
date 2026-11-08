import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CalendarSubscribe from "@/components/CalendarSubscribe";
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
});
