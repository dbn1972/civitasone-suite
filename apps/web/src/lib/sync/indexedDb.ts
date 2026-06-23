/**
 * IndexedDB storage adapter — Gmail-style local cache + outbox (web native).
 *
 * WEB-1e (01-T5): the DB is namespaced per `tenantId:userId` so two accounts on
 * one browser profile never share a store, and sensitive payloads are encrypted
 * at rest with a per-session key (see crypto.ts). WEB / SEC (08-T4): wipeLocalStore
 * deletes every CivitasOne DB on this profile at logout.
 */
import type { MailboxName, OutboxEntry, SyncEntity, SyncStorageAdapter } from "@civitasone/client-core";
import { encryptJson, decryptJson } from "./crypto";

const DB_PREFIX = "civitasone";
const DB_VERSION = 1;

type StoreName = "mailboxes" | "entities" | "outbox" | "meta";

export type StoreNamespace = { tenantId: string; userId: string };

function dbNameFor(ns: StoreNamespace | null): string {
  if (!ns || (!ns.tenantId && !ns.userId)) return DB_PREFIX; // anonymous / pre-login fallback
  // Encode to keep the name stable and collision-free across tenants/users.
  return `${DB_PREFIX}:${encodeURIComponent(ns.tenantId)}:${encodeURIComponent(ns.userId)}`;
}

function openDb(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("mailboxes")) {
        db.createObjectStore("mailboxes", { keyPath: "mailbox" });
      }
      if (!db.objectStoreNames.contains("entities")) {
        const e = db.createObjectStore("entities", { keyPath: "id" });
        e.createIndex("mailbox", "mailbox", { unique: false });
      }
      if (!db.objectStoreNames.contains("outbox")) {
        const o = db.createObjectStore("outbox", { keyPath: "id" });
        o.createIndex("mailbox", "mailbox", { unique: false });
        o.createIndex("status", "status", { unique: false });
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txReq<T>(
  dbName: string,
  store: StoreName,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb(dbName).then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
        t.oncomplete = () => db.close();
      }),
  );
}

// On-disk shapes: the sensitive field (`data` / `payload`) is encrypted.
type StoredEntity = Omit<SyncEntity, "data"> & { data: unknown };
type StoredOutbox = Omit<OutboxEntry, "payload"> & { payload: unknown };

export function createIndexedDbAdapter(ns: StoreNamespace | null = null): SyncStorageAdapter {
  const dbName = dbNameFor(ns);
  return {
    async getCursor(mailbox) {
      const row = await txReq<{ cursor: string } | undefined>(dbName, "mailboxes", "readonly", (s) => s.get(mailbox));
      return row?.cursor ?? "0";
    },
    async setCursor(mailbox, cursor) {
      await txReq(dbName, "mailboxes", "readwrite", (s) =>
        s.put({ mailbox, cursor, lastSyncedAt: new Date().toISOString() }),
      );
    },
    async listOutbox(mailbox) {
      const all = await txReq<StoredOutbox[]>(dbName, "outbox", "readonly", (s) => s.getAll());
      const filtered = mailbox ? all.filter((e) => e.mailbox === mailbox) : all;
      return Promise.all(
        filtered.map(async (e) => ({ ...e, payload: await decryptJson<Record<string, unknown>>(e.payload) })),
      );
    },
    async enqueueOutbox(entry) {
      const stored: StoredOutbox = { ...entry, payload: await encryptJson(entry.payload) };
      await txReq(dbName, "outbox", "readwrite", (s) => s.put(stored));
    },
    async updateOutbox(id, patch) {
      const existing = await txReq<StoredOutbox | undefined>(dbName, "outbox", "readonly", (s) => s.get(id));
      if (!existing) return;
      const merged: StoredOutbox = { ...existing, ...patch };
      if (patch.payload !== undefined) merged.payload = await encryptJson(patch.payload);
      await txReq(dbName, "outbox", "readwrite", (s) => s.put(merged));
    },
    async upsertEntity(entity) {
      const stored: StoredEntity = { ...entity, data: await encryptJson(entity.data) };
      await txReq(dbName, "entities", "readwrite", (s) => s.put(stored));
    },
    async getEntity(id) {
      const row = await txReq<StoredEntity | undefined>(dbName, "entities", "readonly", (s) => s.get(id));
      if (!row) return null;
      return { ...row, data: await decryptJson<Record<string, unknown>>(row.data) } as SyncEntity;
    },
    async listEntities(mailbox) {
      const all = await txReq<StoredEntity[]>(dbName, "entities", "readonly", (s) => s.getAll());
      const rows = all.filter((e) => e.mailbox === mailbox);
      return Promise.all(
        rows.map(async (e) => ({ ...e, data: await decryptJson<Record<string, unknown>>(e.data) }) as SyncEntity),
      );
    },
    async deleteEntity(id) {
      await txReq(dbName, "entities", "readwrite", (s) => s.delete(id));
    },
  };
}

/**
 * SEC / 08-T4: wipe every CivitasOne IndexedDB on this browser profile. Called on
 * logout so local entity/outbox/cursor data does not outlive the session. Uses
 * `databases()` where available and falls back to deleting the known namespaces.
 */
export async function wipeLocalStore(knownNamespaces: StoreNamespace[] = []): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const names = new Set<string>([DB_PREFIX, ...knownNamespaces.map(dbNameFor)]);

  const idbAny = indexedDB as IDBFactory & { databases?: () => Promise<Array<{ name?: string }>> };
  if (typeof idbAny.databases === "function") {
    try {
      const dbs = await idbAny.databases();
      for (const d of dbs) if (d.name?.startsWith(DB_PREFIX)) names.add(d.name);
    } catch {
      /* Firefox lacks databases(); fall back to known names */
    }
  }

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

export async function registerServiceWorker(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("/sw.js");
  } catch {
    // non-fatal in dev
  }
}

/** 01-T6: request a Background Sync drain when connectivity returns. */
export async function requestBackgroundSync(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    const reg = (await navigator.serviceWorker.ready) as ServiceWorkerRegistration & {
      sync?: { register: (tag: string) => Promise<void> };
    };
    if (reg.sync) await reg.sync.register("civitasone-sync");
  } catch {
    /* Background Sync unsupported — the online-event listener still drains the outbox */
  }
}

export type { MailboxName };
