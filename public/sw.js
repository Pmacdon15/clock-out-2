const CACHE_NAME = "clock-out-v1";
const PRECACHE_ASSETS = [
  "/offline.html",
  "/icon-192.png",
  "/icon-512.png",
  "/icon.svg",
  "/favicon.ico",
  "/notification-badge.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key !== CACHE_NAME) {
              return caches.delete(key);
            }
          }),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only handle GET requests with HTTP/HTTPS schemes
  if (request.method !== "GET" || !request.url.startsWith("http")) {
    return;
  }

  const url = new URL(request.url);

  // Pass through auth, API, webhooks, and telemetry requests without caching
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/trpc/") ||
    url.hostname.includes("clerk") ||
    url.hostname.includes("vercel")
  ) {
    return;
  }

  // Navigation requests: Network-first, fallback to cache, then offline page
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches
          .match(request)
          .then((cached) => cached || caches.match("/offline.html")),
      ),
    );
    return;
  }

  // Static assets: Stale-while-revalidate / cache-first
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.match(/\.(png|svg|ico|css|js|woff2?)$/)
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fetchPromise = fetch(request)
          .then((response) => {
            if (response && response.status === 200) {
              const responseToCache = response.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(request, responseToCache);
              });
            }
            return response;
          })
          .catch(() => cached);

        return cached || fetchPromise;
      }),
    );
  }
});

// ------------------------------------------------------------ push alerts --
// Shift alerts ("forgot to clock out", "still on break") arrive as Web Push
// messages carrying JSON: { title, body, url, tag, icon, badge }.

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "Clock Out";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      // The avatar beside the text (Android, desktop). iOS always shows the
      // Home Screen icon (apple-touch-icon.png) instead.
      icon: data.icon || "/icon-192.png",
      // Monochrome status-bar glyph on Android.
      badge: data.badge || "/notification-badge.png",
      tag: data.tag || undefined,
      renotify: Boolean(data.tag),
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(
    (event.notification.data && event.notification.data.url) || "/",
    self.location.origin,
  ).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windows) => {
        for (const client of windows) {
          if (new URL(client.url).origin === self.location.origin) {
            return client.focus().then((focused) =>
              focused && "navigate" in focused
                ? focused.navigate(target)
                : focused,
            );
          }
        }
        return self.clients.openWindow(target);
      }),
  );
});
