/**
 * IndexedDB storage adapter — Gmail-style local cache + outbox (web native).
 */
import type { MailboxName, OutboxEntry, SyncEntity, SyncStorageAdapter } from "@civitasone/client-core";

const DB_NAME = "civitasone";
const DB_VERSION = 1;

type StoreName = "mailboxes" | "entities" | "outbox" | "meta";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("mailboxes")) {
        db.createObjectStore("mailboxes", { keyPath: "mailbox" });
      }
      if (!db.objectStoreNames.contains("entities")) {
        db.createObjectStore("entities", { keyPath: "id" });
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

function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
    t.oncomplete = () => db.close();
  }));
}

export function createIndexedDbAdapter(): SyncStorageAdapter {
  return {
    async getCursor(mailbox) {
      const row = await tx<{ cursor: string } | undefined>("mailboxes", "readonly", (s) => s.get(mailbox));
      return row?.cursor ?? "0";
    },
    async setCursor(mailbox, cursor) {
      await tx("mailboxes", "readwrite", (s) => s.put({ mailbox, cursor, lastSyncedAt: new Date().toISOString() }));
    },
    async listOutbox(mailbox) {
      const all = await tx<OutboxEntry[]>("outbox", "readonly", (s) => s.getAll());
      return mailbox ? all.filter((e) => e.mailbox === mailbox) : all;
    },
    async enqueueOutbox(entry) {
      await tx("outbox", "readwrite", (s) => s.put(entry));
    },
    async updateOutbox(id, patch) {
      const existing = await tx<OutboxEntry | undefined>("outbox", "readonly", (s) => s.get(id));
      if (!existing) return;
      await tx("outbox", "readwrite", (s) => s.put({ ...existing, ...patch }));
    },
    async upsertEntity(entity) {
      await tx("entities", "readwrite", (s) => s.put(entity));
    },
    async getEntity(id) {
      return (await tx<SyncEntity | undefined>("entities", "readonly", (s) => s.get(id))) ?? null;
    },
    async listEntities(mailbox) {
      const all = await tx<SyncEntity[]>("entities", "readonly", (s) => s.getAll());
      return all.filter((e) => e.mailbox === mailbox);
    },
    async deleteEntity(id) {
      await tx("entities", "readwrite", (s) => s.delete(id));
    },
  };
}

export async function registerServiceWorker(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("/sw.js");
  } catch {
    // non-fatal in dev
  }
}

export type { MailboxName };
