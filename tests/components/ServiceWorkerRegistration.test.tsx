import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ServiceWorkerRegistration from "@/components/ServiceWorkerRegistration";

describe("ServiceWorkerRegistration", () => {
  const originalNavigator = global.navigator;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers /sw.js when serviceWorker is present in navigator", () => {
    const registerMock = vi
      .fn()
      .mockResolvedValue({} as ServiceWorkerRegistration);
    Object.defineProperty(global, "navigator", {
      value: {
        ...originalNavigator,
        serviceWorker: {
          register: registerMock,
        },
      },
      configurable: true,
      writable: true,
    });

    render(<ServiceWorkerRegistration />);
    expect(registerMock).toHaveBeenCalledWith("/sw.js");
  });

  it("handles serviceWorker registration failure without throwing", async () => {
    const _consoleDebugSpy = vi
      .spyOn(console, "debug")
      .mockImplementation(() => {});
    const registerMock = vi
      .fn()
      .mockRejectedValue(new Error("Registration failed"));

    Object.defineProperty(global, "navigator", {
      value: {
        ...originalNavigator,
        serviceWorker: {
          register: registerMock,
        },
      },
      configurable: true,
      writable: true,
    });

    render(<ServiceWorkerRegistration />);
    expect(registerMock).toHaveBeenCalledWith("/sw.js");

    // Flush microtasks
    await Promise.resolve();
    await Promise.resolve();
  });

  it("safely does nothing when serviceWorker is not supported", () => {
    Object.defineProperty(global, "navigator", {
      value: {
        ...originalNavigator,
        serviceWorker: undefined,
      },
      configurable: true,
      writable: true,
    });

    expect(() => render(<ServiceWorkerRegistration />)).not.toThrow();
  });
});
