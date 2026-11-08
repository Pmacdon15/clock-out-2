import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithClient, resolved } from "../utils";

const mocks = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn() },
  sync: vi.fn(),
  user: null as unknown,
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/lib/actions", () => ({
  syncMyShiftsToGoogleCalendarAction: mocks.sync,
}));
vi.mock("@clerk/nextjs", () => ({ useUser: () => ({ user: mocks.user }) }));

import AddShiftsToCalendar, {
  RETURN_PARAM,
  syncedMessage,
} from "@/components/AddShiftsToCalendar";
import { GOOGLE_CALENDAR_SCOPE } from "@/lib/calendar-feed-links";

const GOOGLE_URL = "https://accounts.google.com/o/oauth2/auth?x=1";
const verification = {
  verification: { externalVerificationRedirectURL: new URL(GOOGLE_URL) },
};

let location: { href: string; origin: string };
const original = window.location;

beforeEach(() => {
  location = {
    href: "https://clockout.app/schedule",
    origin: "https://clockout.app",
  };
  Object.defineProperty(window, "location", {
    configurable: true,
    value: location,
  });
  mocks.user = {
    externalAccounts: [],
    createExternalAccount: vi.fn(async () => verification),
  };
});
afterEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: original,
  });
  vi.clearAllMocks();
});

const renderCard = (feed: string | null = "/api/calendar/tok.ics") =>
  renderWithClient(<AddShiftsToCalendar feedPathPromise={resolved(feed)} />);

const addButton = () =>
  screen.findByRole("button", { name: "Add my shifts to Google Calendar" });

describe("syncedMessage", () => {
  it("words the result", () => {
    expect(syncedMessage({ added: 0, updated: 0, removed: 0 })).toMatch(
      /no upcoming shifts/,
    );
    expect(syncedMessage({ added: 2, updated: 1, removed: 1 })).toBe(
      "Your shifts are in Google Calendar (2 added, 1 already there, 1 cancelled removed). New and changed shifts will update automatically.",
    );
  });
});

describe("AddShiftsToCalendar", () => {
  it("adds the shifts when Google is already connected", async () => {
    mocks.sync.mockResolvedValue({
      ok: true,
      added: 3,
      updated: 0,
      removed: 0,
    });
    renderCard();
    fireEvent.click(await addButton());
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith(
        expect.stringContaining("3 added"),
      ),
    );
  });

  it("connects a Google account, then comes back to finish", async () => {
    mocks.sync.mockResolvedValue({
      ok: false,
      reason: "x",
      connect: "not_connected",
    });
    renderCard();
    fireEvent.click(await addButton());
    await waitFor(() => expect(location.href).toBe(GOOGLE_URL));
    const user = mocks.user as {
      createExternalAccount: ReturnType<typeof vi.fn>;
    };
    expect(user.createExternalAccount).toHaveBeenCalledWith({
      strategy: "oauth_google",
      additionalScopes: [GOOGLE_CALENDAR_SCOPE],
      redirectUrl: `https://clockout.app/schedule?${RETURN_PARAM}=sync`,
    });
  });

  it("asks an existing Google account for calendar access", async () => {
    const reauthorize = vi.fn(async () => verification);
    mocks.user = { externalAccounts: [{ provider: "google", reauthorize }] };
    mocks.sync.mockResolvedValue({
      ok: false,
      reason: "x",
      connect: "missing_scope",
    });
    renderCard();
    fireEvent.click(await addButton());
    await waitFor(() => expect(location.href).toBe(GOOGLE_URL));
    expect(reauthorize).toHaveBeenCalledWith({
      additionalScopes: [GOOGLE_CALENDAR_SCOPE],
      redirectUrl: `https://clockout.app/schedule?${RETURN_PARAM}=sync`,
    });
  });

  it("finishes the add on return, without looping back to Google", async () => {
    const replaceState = vi
      .spyOn(window.history, "replaceState")
      .mockImplementation(() => {});
    location.href = `https://clockout.app/schedule?${RETURN_PARAM}=sync`;
    mocks.sync.mockResolvedValue({
      ok: false,
      reason: "Still not allowed",
      connect: "missing_scope",
    });
    renderCard();
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("Still not allowed"),
    );
    expect(replaceState).toHaveBeenCalledWith(
      null,
      "",
      "https://clockout.app/schedule",
    );
    const user = mocks.user as {
      createExternalAccount: ReturnType<typeof vi.fn>;
    };
    expect(user.createExternalAccount).not.toHaveBeenCalled();
    replaceState.mockRestore();
  });

  it("shows errors from the sync and from Google", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.sync.mockResolvedValueOnce({ ok: false, reason: "Upgrade needed" });
    renderCard();
    fireEvent.click(await addButton());
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("Upgrade needed"),
    );

    mocks.sync.mockRejectedValueOnce(new Error("network"));
    fireEvent.click(await addButton());
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(
        "Couldn't update Google Calendar. Try again.",
      ),
    );

    mocks.sync.mockResolvedValue({
      ok: false,
      reason: "x",
      connect: "not_connected",
    });
    const user = mocks.user as {
      createExternalAccount: ReturnType<typeof vi.fn>;
    };
    user.createExternalAccount.mockResolvedValueOnce({ verification: null });
    fireEvent.click(await addButton());
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(
        "Couldn't open Google. Try again.",
      ),
    );
    user.createExternalAccount.mockRejectedValueOnce(new Error("clerk"));
    fireEvent.click(await addButton());
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(
        "Couldn't connect to Google. Try again.",
      ),
    );
    error.mockRestore();
  });

  it("waits for the user to load", async () => {
    mocks.user = null;
    renderCard(null);
    expect(await addButton()).toBeDisabled();
    expect(
      screen.queryByText("Use Apple Calendar or Outlook instead?"),
    ).toBeNull();
  });

  it("offers Apple Calendar and Outlook subscriptions", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    renderCard();
    fireEvent.click(
      await screen.findByText("Use Apple Calendar or Outlook instead?"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Outlook" }));
    expect(
      new URL(open.mock.calls[0][0] as string).searchParams.get("url"),
    ).toBe("https://clockout.app/api/calendar/tok.ics");
    fireEvent.click(screen.getByRole("button", { name: "Apple Calendar" }));
    expect(location.href).toBe("webcal://clockout.app/api/calendar/tok.ics");
  });
});
