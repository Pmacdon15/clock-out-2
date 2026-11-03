import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { NotificationSettingsView } from "@/lib/alerts-dal";
import { resolved } from "../utils";

const mocks = vi.hoisted(() => ({ setMyTimezoneAction: vi.fn() }));
vi.mock("@/lib/alert-actions", () => ({
  setMyTimezoneAction: mocks.setMyTimezoneAction,
}));

import TimezoneSync from "@/components/TimezoneSync";

const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

const view = (timezone: string | null): NotificationSettingsView => ({
  preferences: {
    email_enabled: true,
    push_enabled: true,
    shift_alerts: true,
    break_alerts: true,
    admin_alerts: true,
    schedule_alerts: true,
  },
  emailAvailable: true,
  pushAvailable: false,
  vapidPublicKey: null,
  firebase: null,
  timezone,
});

const renderWith = (
  result: Parameters<typeof TimezoneSync>[0]["settingsPromise"],
) => render(<TimezoneSync settingsPromise={result} />);

describe("TimezoneSync", () => {
  it("saves the browser zone when none is stored, and renders nothing", async () => {
    mocks.setMyTimezoneAction.mockResolvedValue({ success: true });
    const { container } = renderWith(resolved({ ok: true, value: view(null) }));
    expect(container).toBeEmptyDOMElement();
    await waitFor(() =>
      expect(mocks.setMyTimezoneAction).toHaveBeenCalledWith(browserTz),
    );
  });

  it("saves when the zone changed, ignoring failures", async () => {
    mocks.setMyTimezoneAction.mockRejectedValue(new Error("offline"));
    renderWith(resolved({ ok: true, value: view("Mars/Olympus") }));
    await waitFor(() =>
      expect(mocks.setMyTimezoneAction).toHaveBeenCalledWith(browserTz),
    );
  });

  it("does nothing when the zone is unchanged or preferences failed to load", () => {
    renderWith(resolved({ ok: true, value: view(browserTz) }));
    renderWith(resolved({ ok: false, error: { reason: "x" } }));
    expect(mocks.setMyTimezoneAction).not.toHaveBeenCalled();
  });

  it("does nothing when the browser reports no zone", () => {
    const spy = vi
      .spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions")
      .mockReturnValue({ timeZone: "" } as Intl.ResolvedDateTimeFormatOptions);
    renderWith(resolved({ ok: true, value: view(null) }));
    expect(mocks.setMyTimezoneAction).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
