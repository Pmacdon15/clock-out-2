import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

describe("Service Worker and Offline Page", () => {
  it("offline.html exists and contains necessary mobile PWA meta tags and content", () => {
    const offlineHtmlPath = path.resolve(
      process.cwd(),
      "public",
      "offline.html",
    );
    expect(fs.existsSync(offlineHtmlPath)).toBe(true);

    const content = fs.readFileSync(offlineHtmlPath, "utf-8");
    expect(content).toContain("viewport-fit=cover");
    expect(content).toContain("You're Offline");
    expect(content).toContain("Retry Connection");
  });

  it("registers install, activate, and fetch listeners and precaches offline assets", async () => {
    const swPath = path.resolve(process.cwd(), "public", "sw.js");
    expect(fs.existsSync(swPath)).toBe(true);

    const swCode = fs.readFileSync(swPath, "utf-8");

    const listeners: Record<string, (...args: unknown[]) => unknown> = {};
    const cacheOpenMock = vi.fn();
    const cacheAddAllMock = vi.fn().mockResolvedValue(undefined);
    const cacheMatchMock = vi.fn();
    const skipWaitingMock = vi.fn().mockResolvedValue(undefined);
    const clientsClaimMock = vi.fn().mockResolvedValue(undefined);

    const mockCache = {
      addAll: cacheAddAllMock,
      match: cacheMatchMock,
      put: vi.fn(),
    };

    cacheOpenMock.mockResolvedValue(mockCache);

    const sandbox = {
      self: {
        addEventListener: (
          name: string,
          fn: (...args: unknown[]) => unknown,
        ) => {
          listeners[name] = fn;
        },
        skipWaiting: skipWaitingMock,
        clients: {
          claim: clientsClaimMock,
        },
      },
      caches: {
        open: cacheOpenMock,
        keys: vi.fn().mockResolvedValue(["clock-out-v1", "old-cache-v0"]),
        delete: vi.fn().mockResolvedValue(true),
        match: cacheMatchMock,
      },
      fetch: vi
        .fn()
        .mockReturnValue(Promise.resolve({ status: 200, clone: () => ({}) })),
      URL,
    };

    vm.createContext(sandbox);
    vm.runInContext(swCode, sandbox);

    expect(listeners.install).toBeDefined();
    expect(listeners.activate).toBeDefined();
    expect(listeners.fetch).toBeDefined();

    // Test install event
    const installWaitUntil = vi.fn();
    await listeners.install({ waitUntil: installWaitUntil });
    expect(installWaitUntil).toHaveBeenCalled();

    // Test activate event
    const activateWaitUntil = vi.fn();
    await listeners.activate({ waitUntil: activateWaitUntil });
    expect(activateWaitUntil).toHaveBeenCalled();

    // Test fetch event with bypass for API
    const apiRespondWith = vi.fn();
    listeners.fetch({
      request: {
        method: "GET",
        url: "https://example.com/api/test",
      },
      respondWith: apiRespondWith,
    });
    expect(apiRespondWith).not.toHaveBeenCalled();

    // Test fetch event with navigation fallback
    const navRespondWith = vi.fn();
    listeners.fetch({
      request: {
        method: "GET",
        mode: "navigate",
        url: "https://example.com/clock-in",
      },
      respondWith: navRespondWith,
    });
    expect(navRespondWith).toHaveBeenCalled();
  });
});
