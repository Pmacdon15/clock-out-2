const CACHE_NAME = "clock-out-v1";
const PRECACHE_ASSETS = [
  "/offline.html",
  "/icon-192.png",
  "/icon-512.png",
  "/icon.svg",
  "/favicon.ico",
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
