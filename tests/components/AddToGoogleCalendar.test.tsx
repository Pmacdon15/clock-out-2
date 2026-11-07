import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  user: null as unknown,
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/google-calendar-actions", () => ({
  addShiftsToGoogleCalendarAction: mocks.add,
}));
vi.mock("@clerk/nextjs", () => ({ useUser: () => ({ user: mocks.user }) }));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import {
  GoogleCalendarResume,
  RESUME_PARAM,
  useAddToGoogleCalendar,
} from "@/components/AddToGoogleCalendar";
import { GOOGLE_CALENDAR_SCOPE } from "@/lib/google-calendar-scope";

function Harness({
  ids = [7],
  fallbackUrl,
}: {
  ids?: number[];
  fallbackUrl?: string;
}) {
  const { add } = useAddToGoogleCalendar();
  return (
    <button onClick={() => add(ids, { fallbackUrl })} type="button">
      Add
    </button>
  );
}

const consent = (href = "https://accounts.google.com/consent") => ({
  verification: { externalVerificationRedirectURL: new URL(href) },
});

let assign: ReturnType<typeof vi.fn>;
const originalLocation = window.location;

beforeEach(() => {
  vi.clearAllMocks();
  assign = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { href: "https://app.test/dashboard/schedule?tab=1", assign },
  });
});

afterEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: originalLocation,
  });
});

const click = () =>
  fireEvent.click(screen.getByRole("button", { name: "Add" }));

describe("useAddToGoogleCalendar", () => {
  it.each([
    [{ added: 2, updated: 0 }, "Added 2 shifts to your Google Calendar"],
    [
      { added: 1, updated: 1 },
      "Added 1 shift to your Google Calendar, updated 1",
    ],
    [
      { added: 0, updated: 1 },
      "Already on your Google Calendar (1 shift updated)",
    ],
    [
      { added: 0, updated: 3 },
      "Already on your Google Calendar (3 shifts updated)",
    ],
  ])("reports %o", async (counts, message) => {
    mocks.add.mockResolvedValue({ status: "ok", ...counts });
    render(<Harness />);
    click();
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith(message),
    );
  });

  it("asks an existing Google account for calendar access", async () => {
    const reauthorize = vi.fn().mockResolvedValue(consent());
    mocks.user = {
      externalAccounts: [
        { provider: "github" },
        { provider: "google", reauthorize },
      ],
    };
    mocks.add.mockResolvedValue({ status: "connect" });
    render(<Harness ids={[3, 4]} />);
    click();
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith(
        "https://accounts.google.com/consent",
      ),
    );
    const { redirectUrl, additionalScopes } = reauthorize.mock.calls[0][0];
    expect(additionalScopes).toEqual([GOOGLE_CALENDAR_SCOPE]);
    const back = new URL(redirectUrl);
    expect(back.searchParams.get(RESUME_PARAM)).toBe("3,4");
    expect(back.searchParams.get("tab")).toBe("1");
  });

  it("links Google when the user has no Google account", async () => {
    const createExternalAccount = vi.fn().mockResolvedValue(consent());
    mocks.user = { externalAccounts: [], createExternalAccount };
    mocks.add.mockResolvedValue({ status: "connect" });
    render(<Harness />);
    click();
    await waitFor(() => expect(assign).toHaveBeenCalled());
    expect(createExternalAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        strategy: "oauth_google",
        additionalScopes: [GOOGLE_CALENDAR_SCOPE],
      }),
    );
  });

  it("errors when Clerk gives no consent URL", async () => {
    mocks.user = {
      externalAccounts: [],
      createExternalAccount: vi.fn().mockResolvedValue({ verification: null }),
    };
    mocks.add.mockResolvedValue({ status: "connect" });
    render(<Harness />);
    click();
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(
        "Couldn't reach Google Calendar. Try again.",
      ),
    );
    expect(assign).not.toHaveBeenCalled();
  });

  it("asks a signed-out user to sign in again", async () => {
    mocks.user = null;
    mocks.add.mockResolvedValue({ status: "connect" });
    render(<Harness />);
    click();
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(
        "Sign in again to add shifts to Google Calendar",
      ),
    );
  });

  it("shows the error and opens the fallback link", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    mocks.add.mockResolvedValue({ status: "error", error: "Broken" });
    render(<Harness fallbackUrl="https://calendar.google.com/x" />);
    click();
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("Broken"),
    );
    expect(open).toHaveBeenCalledWith(
      "https://calendar.google.com/x",
      "_blank",
      "noopener",
    );
    open.mockRestore();
  });

  it("shows the error without a fallback link", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    mocks.add.mockResolvedValue({ status: "error", error: "Broken" });
    render(<Harness />);
    click();
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("Broken"),
    );
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it("handles the action throwing", async () => {
    mocks.add.mockRejectedValue(new Error("network"));
    render(<Harness />);
    click();
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(
        "Couldn't reach Google Calendar. Try again.",
      ),
    );
  });
});

describe("GoogleCalendarResume", () => {
  let replaceState: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    replaceState = vi
      .spyOn(window.history, "replaceState")
      .mockImplementation(() => {});
  });
  afterEach(() => replaceState.mockRestore());

  const at = (href: string) => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { href, assign },
    });
  };

  it("does nothing without the resume parameter", () => {
    at("https://app.test/dashboard/schedule");
    render(<GoogleCalendarResume />);
    expect(mocks.add).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("finishes the add once and cleans the URL", async () => {
    at(`https://app.test/s?a=1&${RESUME_PARAM}=5,x,0,6`);
    mocks.add.mockResolvedValue({ status: "ok", added: 2, updated: 0 });
    const { rerender } = render(<GoogleCalendarResume />);
    rerender(<GoogleCalendarResume />);
    await waitFor(() => expect(mocks.add).toHaveBeenCalledWith([5, 6]));
    expect(mocks.add).toHaveBeenCalledTimes(1);
    expect(replaceState.mock.calls[0][2]).toBe("https://app.test/s?a=1");
  });

  it("doesn't loop back to Google when access was refused", async () => {
    at(`https://app.test/s?${RESUME_PARAM}=5`);
    mocks.user = { externalAccounts: [], createExternalAccount: vi.fn() };
    mocks.add.mockResolvedValue({ status: "connect" });
    render(<GoogleCalendarResume />);
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(
        "Google Calendar access wasn't allowed, so the shift wasn't added",
      ),
    );
    expect(assign).not.toHaveBeenCalled();
  });

  it("skips an empty list of shifts", async () => {
    at(`https://app.test/s?${RESUME_PARAM}=`);
    render(<GoogleCalendarResume />);
    await act(async () => {});
    expect(mocks.add).not.toHaveBeenCalled();
    expect(replaceState).toHaveBeenCalled();
  });
});
