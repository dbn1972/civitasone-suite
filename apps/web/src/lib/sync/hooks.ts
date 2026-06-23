"use client";

/**
 * WEB-1c (01-T3): sync-aware data hooks. The local IndexedDB store was previously
 * write-only — no screen read from it. These hooks read the local store first
 * (instant, works offline), revalidate via a sync cycle in the background, and
 * fall back to cache when the network is unavailable. Migrate a screen by
 * swapping its `fetch('/api/proxy/...')` for `useSyncedList(mailbox)`.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { getOrCreateDeviceId, type MailboxName, type SyncEntity } from "@civitasone/client-core";
import { createIndexedDbAdapter } from "./indexedDb";
import { resolveNamespace } from "./identity";
import { syncMailbox } from "./engine";
import { buildSyncHeaders } from "./headers";

export type SyncSource = "cache" | "live";

export type SyncedListState<T> = {
  items: Array<SyncEntity<T>>;
  source: SyncSource;
  loading: boolean;
  /** true while we hold cached data that is being revalidated */
  revalidating: boolean;
  offline: boolean;
  error: string | null;
  refresh: () => void;
};

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export function useSyncedList<T extends Record<string, unknown>>(mailbox: MailboxName): SyncedListState<T> {
  const [items, setItems] = useState<Array<SyncEntity<T>>>([]);
  const [source, setSource] = useState<SyncSource>("cache");
  const [loading, setLoading] = useState(true);
  const [revalidating, setRevalidating] = useState(false);
  const [offline, setOffline] = useState(isOffline());
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const readLocal = useCallback(async () => {
    const ns = await resolveNamespace();
    const storage = createIndexedDbAdapter(ns);
    const rows = (await storage.listEntities(mailbox)) as Array<SyncEntity<T>>;
    setItems(rows);
    return rows;
  }, [mailbox]);

  useEffect(() => {
    let active = true;

    void (async () => {
      setLoading(true);
      try {
        const local = await readLocal();
        if (!active) return;
        if (local.length > 0) {
          setSource("cache");
          setLoading(false);
          setRevalidating(true);
        }
      } catch {
        /* first run: empty store */
      }

      if (isOffline()) {
        if (active) {
          setOffline(true);
          setLoading(false);
          setRevalidating(false);
        }
        return;
      }

      try {
        const ns = await resolveNamespace();
        await syncMailbox(mailbox, buildSyncHeaders(), getOrCreateDeviceId(), ns);
        if (!active) return;
        await readLocal();
        setSource("live");
        setError(null);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "sync failed");
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
  }, [mailbox, readLocal, tick]);

  // Revalidate when connectivity returns or the SW signals a background sync.
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
    () => ({ items, source, loading, revalidating, offline, error, refresh }),
    [items, source, loading, revalidating, offline, error, refresh],
  );
}

export function useSyncedEntity<T extends Record<string, unknown>>(
  mailbox: MailboxName,
  id: string,
): { entity: SyncEntity<T> | null; loading: boolean; offline: boolean } {
  const { items, loading, offline } = useSyncedList<T>(mailbox);
  const entity = useMemo(() => items.find((e) => e.id === id) ?? null, [items, id]);
  return { entity, loading, offline };
}
