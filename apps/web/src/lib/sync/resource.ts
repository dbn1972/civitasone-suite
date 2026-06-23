"use client";

/**
 * WEB-1c (01-T3) — offline-capable read hook for domain list/detail screens.
 *
 * Reads the cached API response instantly (stale-while-revalidate), fetches the
 * live endpoint through /api/proxy, and falls back to the cache when offline or
 * the request fails. The response shape matches the domain API exactly (unlike
 * the mailbox sync store), so screens migrate by swapping their server loader
 * for this hook with the same mapper.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { readCache, writeCache } from "./responseCache";
import { buildSyncHeaders } from "./headers";

export type ResourceSource = "cache" | "live";

export type OfflineResource<T> = {
  data: T;
  source: ResourceSource;
  loading: boolean;
  revalidating: boolean;
  offline: boolean;
  /** ISO timestamp of the cached copy, when serving from cache */
  cachedAt: string | null;
  error: string | null;
  refresh: () => void;
};

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export type UseOfflineResourceOptions<TApi, T> = {
  /** map the raw API payload to the screen's shape (mirror the server loader) */
  map: (raw: TApi) => T;
  /** data rendered before anything resolves (e.g. SSR result or []) */
  initialData: T;
};

/**
 * @param cacheKey stable per-screen key (include params for detail pages)
 * @param path     domain path under /api/proxy, e.g. "/notification/notifications"
 */
export function useOfflineResource<TApi, T>(
  cacheKey: string,
  path: string,
  opts: UseOfflineResourceOptions<TApi, T>,
): OfflineResource<T> {
  const { map, initialData } = opts;
  const [data, setData] = useState<T>(initialData);
  const [source, setSource] = useState<ResourceSource>("cache");
  const [loading, setLoading] = useState(true);
  const [revalidating, setRevalidating] = useState(false);
  const [offline, setOffline] = useState(isOffline());
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let active = true;

    void (async () => {
      setLoading(true);
      setError(null);

      // 1) instant paint from cache.
      const cached = await readCache<T>(cacheKey);
      if (active && cached) {
        setData(cached.value);
        setCachedAt(cached.cachedAt);
        setSource("cache");
        setLoading(false);
        setRevalidating(true);
      }

      // 2) offline: keep cache, stop.
      if (isOffline()) {
        if (active) {
          setOffline(true);
          setLoading(false);
          setRevalidating(false);
        }
        return;
      }

      // 3) revalidate from the live endpoint.
      try {
        const res = await fetch(`/api/proxy${path}`, {
          headers: { "content-type": "application/json", ...buildSyncHeaders() },
          credentials: "same-origin",
        });
        if (!res.ok) throw new Error(`HTTP_${res.status}`);
        const raw = (await res.json()) as TApi;
        const mapped = map(raw);
        if (!active) return;
        setData(mapped);
        setSource("live");
        setCachedAt(null);
        await writeCache(cacheKey, mapped);
      } catch (err) {
        // Network failed mid-session: fall back to cache if we have it.
        if (active) {
          if (!cached) setError(err instanceof Error ? err.message : "load failed");
          setOffline(isOffline());
        }
      } finally {
        if (active) {
          setLoading(false);
          setRevalidating(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [cacheKey, path, map, tick]);

  // Revalidate on reconnect / background-sync signal.
  useEffect(() => {
    const onOnline = () => {
      setOffline(false);
      setTick((t) => t + 1);
    };
    const onOffline = () => setOffline(true);
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === "CIVITASONE_SYNC") setTick((t) => t + 1);
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    navigator.serviceWorker?.addEventListener?.("message", onMessage);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      navigator.serviceWorker?.removeEventListener?.("message", onMessage);
    };
  }, []);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  return useMemo(
    () => ({ data, source, loading, revalidating, offline, cachedAt, error, refresh }),
    [data, source, loading, revalidating, offline, cachedAt, error, refresh],
  );
}

/**
 * Cache-seeding variant for screens whose data is mapped server-side (complex
 * loaders that can't run in the client bundle). The server component passes its
 * already-mapped result as `initialData`; this seeds the encrypted offline cache
 * when that data is fresh, and serves the cache when the server result is empty
 * or errored (e.g. offline). No mapper duplication — the server loader stays the
 * single source of truth.
 */
export type SeededResource<T> = {
  data: T;
  fromCache: boolean;
  offline: boolean;
  cachedAt: string | null;
};

export function useSeededResource<T>(
  cacheKey: string,
  initialData: T,
  serverSource: "api" | "error",
  isEmpty: (data: T) => boolean,
): SeededResource<T> {
  const [data, setData] = useState<T>(initialData);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [offline, setOffline] = useState(isOffline());

  useEffect(() => {
    let active = true;
    void (async () => {
      const serverUsable = serverSource === "api" && !isEmpty(initialData);
      if (serverUsable) {
        // Fresh server data — render it and refresh the offline copy.
        setData(initialData);
        setFromCache(false);
        await writeCache(cacheKey, initialData);
        return;
      }
      // Server gave nothing (offline / error) — fall back to the cached copy.
      const cached = await readCache<T>(cacheKey);
      if (active && cached && !isEmpty(cached.value)) {
        setData(cached.value);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
      }
    })();
    return () => {
      active = false;
    };
    // initialData identity changes each server render; key + source gate the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, serverSource]);

  useEffect(() => {
    const onOnline = () => setOffline(false);
    const onOffline = () => setOffline(true);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  return useMemo(() => ({ data, fromCache, offline, cachedAt }), [data, fromCache, offline, cachedAt]);
}
