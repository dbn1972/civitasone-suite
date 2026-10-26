/* CivitasOne service worker — offline-first app shell + runtime caching.
 *
 * WEB-1a (prompt 01-T1): the SW previously had only `sync`+`message` listeners
 * and no `fetch` handler, so the app could not load offline at all. This version
 * adds:
 *   - precache of the app shell + offline fallback on install
 *   - navigation requests: network-first, fall back to cached shell / offline page
 *   - static assets (_next/static, icons, fonts): stale-while-revalidate
 *   - GET /api/proxy/* : network only, NEVER cached here (authenticated per-user data;
 *     offline reads come from the encrypted, per-user IndexedDB response cache)
 *   - Background Sync: notify open clients to drain the outbox on reconnect (01-T6)
 *
 * V4-A-01: Cache Storage is keyed by URL only and outlives logout, so nothing
 * authenticated may be stored in it: navigation responses are cached only when
 * not Cache-Control no-store/private (except the public /offline fallback),
 * /api/proxy is never cached, and the page sends CIVITASONE_PURGE on logout to drop every civitasone-* cache.
 *
 * Cache names are versioned; bumping CACHE_VERSION invalidates old caches on
 * activate so a deploy never serves stale shells indefinitely.
 */
const CACHE_VERSION = "v2"; // v2: drops v1 caches that may hold authenticated data
const SHELL_CACHE = `civitasone-shell-${CACHE_VERSION}`;
const STATIC_CACHE = `civitasone-static-${CACHE_VERSION}`;
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
            if (cacheableFor(url, res)) await cache.put(url, res.clone());
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
          .filter((k) => k.startsWith("civitasone-") && ![SHELL_CACHE, STATIC_CACHE].includes(k))
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

// V4-A-01: a response may be stored only if it is ok, not a redirect (an
// unauthenticated precache would otherwise store the login page under the
// protected URL) and the server did not mark it no-store / private.
function isCacheable(res) {
  if (!res.ok || res.redirected) return false;
  const cc = res.headers.get("cache-control") || "";
  return !/(?:^|[\s,])(?:no-store|private)(?:[\s,=]|$)/i.test(cc);
}

// /offline is the one exemption from the no-store/private rule: Next.js renders it
// per request (locale cookie via next-intl) and so marks it private/no-store, but it
// is public and user-agnostic (middleware PUBLIC_SEGMENT; locale + static copy only).
// Without this the fallback would never be stored and an offline navigation would get
// the JSON 503 instead of the page. It must still be a direct 200, never a redirect.
function isCacheableOffline(res) {
  return res.ok && !res.redirected;
}

function cacheableFor(path, res) {
  return path === OFFLINE_URL ? isCacheableOffline(res) : isCacheable(res);
}

// Drop every civitasone-* cache (logout), then restore only the public offline page.
async function purgeCaches() {
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => k.startsWith("civitasone-")).map((k) => caches.delete(k)));
  try {
    const res = await fetch(OFFLINE_URL, { credentials: "omit" });
    if (isCacheableOffline(res)) await (await caches.open(SHELL_CACHE)).put(OFFLINE_URL, res.clone());
  } catch {
    /* offline: the fallback is re-precached on the next install */
  }
}

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

// Network-first for navigations: try the network, fall back to a cached copy
// (only ever stored when cacheableFor allows it) or the offline page.
async function networkFirst(request, path, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (cacheableFor(path, res)) cache.put(request, res.clone());
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

// Authenticated API GET: network only. Never written to Cache Storage.
async function networkOnly(request) {
  try {
    return await fetch(request);
  } catch {
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
      if (isCacheable(res)) cache.put(request, res.clone());
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
    event.respondWith(networkFirst(request, url.pathname, SHELL_CACHE, OFFLINE_URL));
    return;
  }
  if (isStaticAsset(url)) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
    return;
  }
  if (isApiGet(request, url)) {
    event.respondWith(networkOnly(request));
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

// Only same-origin clients may command the worker (CodeQL js/missing-origin-check).
function isSameOriginSource(event) {
  const url = event.source && event.source.url;
  if (typeof url !== "string") return false;
  try {
    return new URL(url).origin === self.location.origin;
  } catch {
    return false;
  }
}

self.addEventListener("message", (event) => {
  if (!isSameOriginSource(event)) return;
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data?.type === "CIVITASONE_PURGE") event.waitUntil(purgeCaches());
});
