"use client";

/**
 * Offline read cache for domain GET endpoints.
 *
 * The mailbox sync store (indexedDb.ts) holds raw event payloads from the sync
 * feeder — a different shape from the domain list APIs the screens render. So
 * list/detail screens cache their *actual API response* here instead, giving
 * true offline reads with the correct shape. Entries are encrypted at rest
 * (crypto.ts) and namespaced per tenant+user (identity.ts), same as the rest of
 * the offline layer.
 */
import { encryptJson, decryptJson } from "./crypto";
import { resolveNamespace } from "./identity";

const DB_PREFIX = "civitasone-cache";
const STORE = "responses";
const DB_VERSION = 1;

type CacheRow = { key: string; value: unknown; cachedAt: string };

function dbName(ns: { tenantId: string; userId: string } | null): string {
  if (!ns || (!ns.tenantId && !ns.userId)) return DB_PREFIX;
  return `${DB_PREFIX}:${encodeURIComponent(ns.tenantId)}:${encodeURIComponent(ns.userId)}`;
}

function open(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(name: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open(name).then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const r = fn(t.objectStore(STORE));
        r.onsuccess = () => resolve(r.result as T);
        r.onerror = () => reject(r.error);
        t.oncomplete = () => db.close();
      }),
  );
}

export async function readCache<T>(key: string): Promise<{ value: T; cachedAt: string } | null> {
  // IndexedDB can genuinely be unavailable (SSR-adjacent contexts, older browsers,
  // some private-browsing modes, jsdom in tests) — no-op rather than throw.
  if (typeof indexedDB === "undefined") return null;
  const ns = await resolveNamespace();
  const row = await run<CacheRow | undefined>(dbName(ns), "readonly", (s) => s.get(key));
  if (!row) return null;
  try {
    return { value: (await decryptJson<T>(row.value)) as T, cachedAt: row.cachedAt };
  } catch {
    return null;
  }
}

export async function writeCache(key: string, value: unknown): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const ns = await resolveNamespace();
  const row: CacheRow = { key, value: await encryptJson(value), cachedAt: new Date().toISOString() };
  await run(dbName(ns), "readwrite", (s) => s.put(row));
}

/** Delete the response cache for a namespace (logout / 08-T4). */
export async function wipeResponseCache(ns: { tenantId: string; userId: string } | null): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const names = new Set<string>([DB_PREFIX, dbName(ns)]);
  await Promise.all(
    [...names].map(
      (name) =>
        new Promise<void>((resolve) => {
          const req = indexedDB.deleteDatabase(name);
          req.onsuccess = () => resolve();
          req.onerror = () => resolve();
          req.onblocked = () => resolve();
        }),
    ),
  );
}
