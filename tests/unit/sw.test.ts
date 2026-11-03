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

describe("Service worker push alerts", () => {
  function loadWorker(windows: { url: string; focus: () => unknown }[] = []) {
    const swCode = fs.readFileSync(
      path.resolve(process.cwd(), "public", "sw.js"),
      "utf-8",
    );
    const listeners: Record<string, (event: unknown) => void> = {};
    const showNotification = vi.fn().mockResolvedValue(undefined);
    const openWindow = vi.fn().mockResolvedValue(undefined);
    const matchAll = vi.fn().mockResolvedValue(windows);
    const sandbox = {
      self: {
        addEventListener: (name: string, fn: (event: unknown) => void) => {
          listeners[name] = fn;
        },
        registration: { showNotification },
        clients: { matchAll, openWindow, claim: vi.fn() },
        location: { origin: "https://clock.test" },
      },
      caches: {},
      URL,
    };
    vm.createContext(sandbox);
    vm.runInContext(swCode, sandbox);
    return { listeners, showNotification, openWindow, matchAll };
  }

  /** Dispatches an event and waits for what it handed to waitUntil. */
  async function dispatch(
    listener: (event: unknown) => void,
    event: Record<string, unknown>,
  ) {
    let pending: Promise<unknown> = Promise.resolve();
    listener({
      ...event,
      waitUntil: (p: Promise<unknown>) => {
        pending = p;
      },
    });
    return await pending;
  }

  it("shows a pushed alert with the app icon and badge", async () => {
    const { listeners, showNotification } = loadWorker();
    await dispatch(listeners.push, {
      data: {
        json: () => ({
          title: "Still clocked in?",
          body: "10h",
          url: "/?defaultTab=time-clock",
          tag: "forgot:1",
        }),
      },
    });
    const [title, options] = showNotification.mock.calls[0];
    expect(title).toBe("Still clocked in?");
    expect(options).toMatchObject({
      body: "10h",
      icon: "/icon-192.png",
      badge: "/notification-badge.png",
      tag: "forgot:1",
      renotify: true,
      data: { url: "/?defaultTab=time-clock" },
    });
  });

  it("unwraps alerts delivered by Firebase Cloud Messaging", async () => {
    const { listeners, showNotification } = loadWorker();
    await dispatch(listeners.push, {
      data: {
        json: () => ({
          data: {
            title: "Your break is over",
            body: "15m",
            url: "/?defaultTab=time-clock",
            tag: "break:3",
          },
          from: "123",
          priority: "high",
          fcmMessageId: "m-1",
        }),
      },
    });
    const [title, options] = showNotification.mock.calls[0];
    expect(title).toBe("Your break is over");
    expect(options).toMatchObject({ body: "15m", tag: "break:3" });
  });

  it("shows a bare JSON null push with the defaults", async () => {
    const { listeners, showNotification } = loadWorker();
    await dispatch(listeners.push, { data: { json: () => null } });
    expect(showNotification.mock.calls[0][0]).toBe("Clock Out");
  });

  it("falls back for empty and plain-text pushes", async () => {
    const { listeners, showNotification } = loadWorker();
    await dispatch(listeners.push, { data: null });
    expect(showNotification.mock.calls[0][0]).toBe("Clock Out");
    expect(showNotification.mock.calls[0][1]).toMatchObject({
      renotify: false,
      data: { url: "/" },
    });

    await dispatch(listeners.push, {
      data: {
        json: () => {
          throw new Error("not json");
        },
        text: () => "hello",
      },
    });
    expect(showNotification.mock.calls[1][1]).toMatchObject({ body: "hello" });
  });

  it("opens the alert's page, reusing an open window when there is one", async () => {
    const navigate = vi.fn().mockResolvedValue(undefined);
    const focused = { navigate };
    const appWindow = {
      url: "https://clock.test/",
      focus: vi.fn().mockResolvedValue(focused),
    };
    const other = { url: "https://elsewhere.test/", focus: vi.fn() };
    const close = vi.fn();
    const { listeners, openWindow } = loadWorker([other, appWindow]);
    await dispatch(listeners.notificationclick, {
      notification: { close, data: { url: "/?defaultTab=view" } },
    });
    expect(close).toHaveBeenCalled();
    expect(other.focus).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(
      "https://clock.test/?defaultTab=view",
    );
    expect(openWindow).not.toHaveBeenCalled();

    const fresh = loadWorker([]);
    await dispatch(fresh.listeners.notificationclick, {
      notification: { close, data: null },
    });
    expect(fresh.openWindow).toHaveBeenCalledWith("https://clock.test/");
  });
});
