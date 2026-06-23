/* CivitasOne service worker — offline-first app shell + runtime caching.
 *
 * WEB-1a (prompt 01-T1): the SW previously had only `sync`+`message` listeners
 * and no `fetch` handler, so the app could not load offline at all. This version
 * adds:
 *   - precache of the app shell + offline fallback on install
 *   - navigation requests: network-first, fall back to cached shell / offline page
 *   - static assets (_next/static, icons, fonts): stale-while-revalidate
 *   - GET /api/proxy/* : network-first with cache fallback (last-known data offline)
 *   - Background Sync: notify open clients to drain the outbox on reconnect (01-T6)
 *
 * Cache names are versioned; bumping CACHE_VERSION invalidates old caches on
 * activate so a deploy never serves stale shells indefinitely.
 */
const CACHE_VERSION = "v1";
const SHELL_CACHE = `civitasone-shell-${CACHE_VERSION}`;
const STATIC_CACHE = `civitasone-static-${CACHE_VERSION}`;
const DATA_CACHE = `civitasone-data-${CACHE_VERSION}`;
const OFFLINE_URL = "/offline";

// Minimal app shell precached on install. Hashed Next.js chunks are cached at
// runtime (their URLs are not known at build time without a manifest).
const PRECACHE_URLS = ["/", "/offline", "/dashboard"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // addAll fails the whole install if any URL 404s; add individually so a
      // single missing route never blocks SW installation.
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          try {
            const res = await fetch(url, { credentials: "same-origin" });
            if (res.ok) await cache.put(url, res.clone());
          } catch {
            /* offline at install time — runtime cache will fill in later */
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("civitasone-") && ![SHELL_CACHE, STATIC_CACHE, DATA_CACHE].includes(k))
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/fonts/") ||
    /\.(?:js|css|woff2?|png|jpg|jpeg|svg|webp|ico)$/.test(url.pathname)
  );
}

function isApiGet(request, url) {
  return request.method === "GET" && url.pathname.startsWith("/api/proxy/");
}

// Network-first: try the network, fall back to cache. Used for navigations + API GETs.
async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (fallbackUrl) {
      const fallback = await caches.match(fallbackUrl);
      if (fallback) return fallback;
    }
    return new Response(
      JSON.stringify({ code: "OFFLINE", message: "You are offline and no cached copy is available." }),
      { status: 503, headers: { "content-type": "application/json" } },
    );
  }
}

// Stale-while-revalidate: serve cache immediately, refresh in the background.
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => cached);
  return cached ?? network;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin requests; cross-origin (gateway, Keycloak) pass through.
  if (url.origin !== self.location.origin) return;

  // Never cache auth/session mutations — always go to network.
  if (url.pathname.startsWith("/api/auth/")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, SHELL_CACHE, OFFLINE_URL));
    return;
  }
  if (isStaticAsset(url)) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
    return;
  }
  if (isApiGet(request, url)) {
    event.respondWith(networkFirst(request, DATA_CACHE));
    return;
  }
  // Other requests (API writes etc.) are left to the network/outbox layer.
});

// Background Sync (01-T6): when connectivity returns, ask every open tab to
// drain its IndexedDB outbox. The page owns the credentials/keys, so the SW
// delegates the actual push rather than replaying requests itself.
self.addEventListener("sync", (event) => {
  if (event.tag !== "civitasone-sync") return;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) client.postMessage({ type: "CIVITASONE_SYNC" });
    }),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
