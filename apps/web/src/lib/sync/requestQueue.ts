"use client";

/**
 * WEB-1b (01-T2): durable HTTP-replay outbox for domain mutations.
 *
 * Domain writes (leave requests, POs, vouchers, …) target their own service
 * endpoints, not the sync/push changelog — and the server-side sync protocol
 * does not yet apply pushes to domain tables (prompt 03-T1). So routing those
 * writes through sync/push would silently drop them. Instead, when a write can't
 * reach the server we persist the *original request* (method, path, body, an
 * idempotency key) in IndexedDB and replay it verbatim on reconnect. The online
 * path is unchanged; only offline/failed writes are queued.
 *
 * Idempotency: each queued request carries `x-idempotency-key`. Server-side
 * dedup by this key is tracked in 04-T4; until then a replay is at-least-once.
 */
import { encryptJson, decryptJson } from "./crypto";
import { resolveNamespace } from "./identity";
import { buildSyncHeaders } from "./headers";
import { requestBackgroundSync } from "./indexedDb";

const DB_PREFIX = "civitasone-reqs";
const STORE = "requests";
const DB_VERSION = 1;

type QueuedRequest = {
  id: string;
  method: string;
  path: string; // relative to /api/proxy, e.g. "/v1/hrms/leave-requests"
  body: unknown; // encrypted at rest
  idempotencyKey: string;
  createdAt: string;
  retryCount: number;
};

function dbName(ns: { tenantId: string; userId: string } | null): string {
  if (!ns || (!ns.tenantId && !ns.userId)) return DB_PREFIX;
  return `${DB_PREFIX}:${encodeURIComponent(ns.tenantId)}:${encodeURIComponent(ns.userId)}`;
}

function open(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
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

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `r_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function enqueueRequest(method: string, path: string, body: unknown, idempotencyKey: string): Promise<void> {
  const ns = await resolveNamespace();
  const stored: QueuedRequest = {
    id: idempotencyKey,
    method,
    path,
    body: await encryptJson(body),
    idempotencyKey,
    createdAt: new Date().toISOString(),
    retryCount: 0,
  };
  await run(dbName(ns), "readwrite", (s) => s.put(stored));
  await requestBackgroundSync();
}

export type QueuedFetchResult = {
  /** the live Response if the request reached the server, else null */
  response: Response | null;
  /** true when the request was durably queued for later replay */
  queued: boolean;
  idempotencyKey: string;
};

/**
 * Perform a mutating request, queuing it durably if we're offline or the network
 * fails. Use this in place of a bare `fetch('/api/proxy/...')` in mutation forms.
 */
export async function fetchOrQueue(
  path: string,
  init: { method: string; body?: unknown },
): Promise<QueuedFetchResult> {
  const idempotencyKey = newId();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-idempotency-key": idempotencyKey,
    ...buildSyncHeaders(),
  };

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    await enqueueRequest(init.method, path, init.body ?? {}, idempotencyKey);
    return { response: null, queued: true, idempotencyKey };
  }

  try {
    const res = await fetch(`/api/proxy${path}`, {
      method: init.method,
      headers,
      body: JSON.stringify(init.body ?? {}),
      credentials: "same-origin",
    });
    // Only queue on transport failure (caught below) or server-unavailable; 4xx
    // are real rejections the user must see, not retried blindly.
    if (res.status >= 500) {
      await enqueueRequest(init.method, path, init.body ?? {}, idempotencyKey);
      return { response: res, queued: true, idempotencyKey };
    }
    return { response: res, queued: false, idempotencyKey };
  } catch {
    await enqueueRequest(init.method, path, init.body ?? {}, idempotencyKey);
    return { response: null, queued: true, idempotencyKey };
  }
}

const MAX_REQUEST_RETRIES = 8;

/** Replay all queued requests. Invoked on reconnect and on SW background-sync. */
export async function flushRequestQueue(): Promise<{ flushed: number; remaining: number }> {
  const ns = await resolveNamespace();
  const name = dbName(ns);
  const all = await run<QueuedRequest[]>(name, "readonly", (s) => s.getAll());
  let flushed = 0;

  for (const q of all) {
    let body: unknown;
    try {
      body = await decryptJson(q.body);
    } catch {
      // Undecryptable (key rotated / logged out) — drop it rather than loop.
      await run(name, "readwrite", (s) => s.delete(q.id));
      continue;
    }
    try {
      const res = await fetch(`/api/proxy${q.path}`, {
        method: q.method,
        headers: { "content-type": "application/json", "x-idempotency-key": q.idempotencyKey, ...buildSyncHeaders() },
        body: JSON.stringify(body),
        credentials: "same-origin",
      });
      if (res.ok || (res.status >= 400 && res.status < 500)) {
        // Success, or a permanent client rejection — stop retrying either way.
        await run(name, "readwrite", (s) => s.delete(q.id));
        flushed++;
      } else if (q.retryCount + 1 >= MAX_REQUEST_RETRIES) {
        await run(name, "readwrite", (s) => s.delete(q.id)); // dead-letter
      } else {
        await run(name, "readwrite", (s) => s.put({ ...q, retryCount: q.retryCount + 1 }));
      }
    } catch {
      // Still offline — leave it queued.
      break;
    }
  }

  const remaining = (await run<QueuedRequest[]>(name, "readonly", (s) => s.getAll())).length;
  return { flushed, remaining };
}

/** Number of pending queued mutations (for UI badges). */
export async function pendingRequestCount(): Promise<number> {
  const ns = await resolveNamespace();
  const all = await run<QueuedRequest[]>(dbName(ns), "readonly", (s) => s.getAll());
  return all.length;
}

/** Delete the queued-request store for the given namespace (logout / 08-T4). */
export async function wipeRequestQueue(ns: { tenantId: string; userId: string } | null): Promise<void> {
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
