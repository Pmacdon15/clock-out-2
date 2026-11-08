import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithClient, resolved } from "../utils";

const mocks = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import CalendarSubscribe from "@/components/CalendarSubscribe";

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

  it("opens Google Calendar and Outlook subscriptions in a new tab", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    renderCard();
    fireEvent.click(
      await screen.findByRole("button", { name: "Google Calendar" }),
    );
    const google = new URL(open.mock.calls[0][0] as string);
    expect(google.origin).toBe("https://calendar.google.com");
    expect(google.searchParams.get("cid")).toBe(
      FEED.replace(/^https?:\/\//, "webcal://"),
    );
    expect(open.mock.calls[0][1]).toBe("_blank");

    fireEvent.click(screen.getByRole("button", { name: "Outlook" }));
    const outlook = new URL(open.mock.calls[1][0] as string);
    expect(outlook.searchParams.get("url")).toBe(FEED);
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
        await screen.findByRole("button", { name: "Apple Calendar" }),
      );
      expect(location.href).toBe(FEED.replace(/^https?:\/\//, "webcal://"));
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: original,
      });
    }
  });

  it("copies the feed link", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Copy link" }));
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith("Calendar link copied"),
    );
    expect(writeText).toHaveBeenCalledWith(FEED);

    writeText.mockRejectedValueOnce(new Error("denied"));
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("Couldn't copy the link"),
    );
  });
});
