"use client";

/**
 * SEC / 08-T4 (web): logout must wipe local sync data, not just tokens. The
 * previous logout only cleared cookies server-side, leaving the IndexedDB cache
 * (entities/outbox/cursors) and the device-trust token on the device. This wipes
 * the encrypted store, drops the per-session encryption key, clears the trust
 * token, then hands off to the server route that clears the auth cookies.
 */
import { wipeLocalStore } from "./indexedDb";
import { wipeRequestQueue } from "./requestQueue";
import { wipeResponseCache } from "./responseCache";
import { wipeSessionKey } from "./crypto";
import { resolveNamespace, clearNamespaceCache } from "./identity";
import { clearTrustToken } from "./headers";

/**
 * V4-A-01: the service worker's Cache Storage (civitasone-*) is keyed by URL only
 * and outlives the session, so wipe it directly and also ask the worker to purge
 * (it re-seeds only the public /offline fallback). Best-effort, never blocks logout.
 */
async function wipeCacheStorage(): Promise<void> {
  try {
    if (typeof caches !== "undefined") {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("civitasone-")).map((k) => caches.delete(k)));
    }
  } catch {
    /* best-effort */
  }
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: "CIVITASONE_PURGE" });
  } catch {
    /* best-effort */
  }
}

export async function performLogout(): Promise<void> {
  try {
    const ns = await resolveNamespace();
    await Promise.all([wipeLocalStore(ns ? [ns] : []), wipeRequestQueue(ns), wipeResponseCache(ns)]);
  } catch {
    /* best-effort: never block logout on a wipe failure */
  }
  await wipeCacheStorage();
  wipeSessionKey();
  clearTrustToken();
  clearNamespaceCache();

  // Server route clears the httpOnly auth cookies and redirects to /auth/login.
  window.location.href = "/logout";
}
