import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InstallPrompt from "@/components/InstallPrompt";

describe("InstallPrompt", () => {
  const originalMatchMedia = window.matchMedia;
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    mockStorage = {};
    const storageMock = {
      getItem: vi.fn((key: string) => mockStorage[key] ?? null),
      setItem: vi.fn((key: string, val: string) => {
        mockStorage[key] = String(val);
      }),
      removeItem: vi.fn((key: string) => {
        delete mockStorage[key];
      }),
      clear: vi.fn(() => {
        mockStorage = {};
      }),
    };

    Object.defineProperty(window, "localStorage", {
      value: storageMock,
      configurable: true,
      writable: true,
    });

    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    vi.restoreAllMocks();
  });

  it("does not render when running in standalone mode", () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("display-mode: standalone"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    render(<InstallPrompt />);
    expect(
      screen.queryByRole("region", { name: /install mobile app/i }),
    ).not.toBeInTheDocument();
  });

  it("does not render when previously dismissed in localStorage", () => {
    window.localStorage.setItem("clockout_install_dismissed", "true");

    render(<InstallPrompt />);
    expect(
      screen.queryByRole("region", { name: /install mobile app/i }),
    ).not.toBeInTheDocument();
  });

  it("displays prompt when beforeinstallprompt fires and installs on click", async () => {
    render(<InstallPrompt />);
    expect(
      screen.queryByRole("region", { name: /install mobile app/i }),
    ).not.toBeInTheDocument();

    const promptMock = vi.fn().mockResolvedValue(undefined);
    const event = Object.assign(new Event("beforeinstallprompt"), {
      prompt: promptMock,
      userChoice: Promise.resolve({ outcome: "accepted" as const }),
    });

    window.dispatchEvent(event);

    const banner = await screen.findByRole("region", {
      name: /install mobile app/i,
    });
    expect(banner).toBeInTheDocument();
    expect(
      screen.getByText("Install Clock Out on your phone"),
    ).toBeInTheDocument();

    const installButton = screen.getByRole("button", { name: /install app/i });
    fireEvent.click(installButton);

    expect(promptMock).toHaveBeenCalled();
  });

  it("dismisses prompt and persists dismissal", async () => {
    render(<InstallPrompt />);

    const event = Object.assign(new Event("beforeinstallprompt"), {
      prompt: vi.fn().mockResolvedValue(undefined),
      userChoice: Promise.resolve({ outcome: "dismissed" as const }),
    });
    window.dispatchEvent(event);

    const banner = await screen.findByRole("region", {
      name: /install mobile app/i,
    });
    expect(banner).toBeInTheDocument();

    const dismissButton = screen.getByRole("button", {
      name: /dismiss install prompt/i,
    });
    fireEvent.click(dismissButton);

    expect(
      screen.queryByRole("region", { name: /install mobile app/i }),
    ).not.toBeInTheDocument();
    expect(window.localStorage.getItem("clockout_install_dismissed")).toBe(
      "true",
    );
  });

  it("shows iOS specific instructions on iOS devices", () => {
    const originalNavigator = window.navigator;
    Object.defineProperty(window, "navigator", {
      value: {
        ...originalNavigator,
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)",
      },
      configurable: true,
      writable: true,
    });

    render(<InstallPrompt />);

    expect(
      screen.getByRole("region", { name: /install mobile app/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Share → Add to Home Screen/i)).toBeInTheDocument();
  });
});
