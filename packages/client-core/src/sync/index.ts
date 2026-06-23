/**
 * Gmail-style sync protocol — mailbox cursors, outbox queue, delta pull.
 * Web: IndexedDB adapter. Mobile: SQLite/drift adapter. Same protocol.
 */

export type MailboxName = "approvals" | "notifications" | "applications" | "grievances";

export type SyncState = "synced" | "pending_push" | "conflict" | "tombstone";

export type OutboxStatus = "queued" | "pushing" | "failed" | "done";

export type SyncCursor = {
  mailbox: MailboxName;
  cursor: string;
  lastSyncedAt: string;
};

export type SyncEntity<T = Record<string, unknown>> = {
  id: string;
  mailbox: MailboxName;
  data: T;
  updatedAt: string;
  etag?: string;
  syncState: SyncState;
};

export type OutboxEntry<T = Record<string, unknown>> = {
  id: string;
  mailbox: MailboxName;
  operation: "create" | "update" | "delete";
  payload: T;
  createdAt: string;
  status: OutboxStatus;
  retryCount: number;
  lastError?: string;
};

export type SyncPushRequest = {
  deviceId: string;
  mailbox: MailboxName;
  cursor: string;
  mutations: Array<{
    clientMutationId: string;
    operation: OutboxEntry["operation"];
    entityId: string;
    payload: Record<string, unknown>;
    clientUpdatedAt: string;
    /** SYN-1c: last-known server etag for this entity, for conflict detection */
    baseEtag?: string;
  }>;
};

export type SyncMutationResult = {
  clientMutationId: string;
  status: "applied" | "conflict" | "failed";
  etag?: string;
  serverData?: Record<string, unknown>;
  reason?: string;
};

export type SyncPushResponse = {
  mailbox: MailboxName;
  cursor: string;
  applied: string[];
  conflicts: Array<{ clientMutationId: string; reason: string }>;
  /** SYN-1d: precise per-mutation outcomes (preferred over applied/conflicts) */
  results?: SyncMutationResult[];
};

export type SyncPullRequest = {
  deviceId: string;
  mailbox: MailboxName;
  cursor: string;
  limit?: number;
};

export type SyncPullResponse = {
  mailbox: MailboxName;
  cursor: string;
  hasMore: boolean;
  entities: Array<{
    id: string;
    operation: "upsert" | "delete";
    data?: Record<string, unknown>;
    updatedAt: string;
    etag: string;
  }>;
};

export type SyncStorageAdapter = {
  getCursor(mailbox: MailboxName): Promise<string>;
  setCursor(mailbox: MailboxName, cursor: string): Promise<void>;
  listOutbox(mailbox?: MailboxName): Promise<OutboxEntry[]>;
  enqueueOutbox(entry: OutboxEntry): Promise<void>;
  updateOutbox(id: string, patch: Partial<OutboxEntry>): Promise<void>;
  upsertEntity(entity: SyncEntity): Promise<void>;
  getEntity(id: string): Promise<SyncEntity | null>;
  listEntities(mailbox: MailboxName): Promise<SyncEntity[]>;
  deleteEntity(id: string): Promise<void>;
};

export type SyncApiClient = {
  push(req: SyncPushRequest, headers: Record<string, string>): Promise<SyncPushResponse>;
  pull(req: SyncPullRequest, headers: Record<string, string>): Promise<SyncPullResponse>;
};

const MAX_OUTBOX_RETRIES = 5;

/** Gmail-like: push outbox first, then pull deltas. */
export async function runSyncCycle(
  mailbox: MailboxName,
  storage: SyncStorageAdapter,
  api: SyncApiClient,
  headers: Record<string, string>,
  deviceId: string,
): Promise<{ pushed: number; pulled: number }> {
  let pushed = 0;
  let pulled = 0;
  const cursor = await storage.getCursor(mailbox);
  const outbox = (await storage.listOutbox(mailbox)).filter((e) => e.status === "queued" || e.status === "failed");

  if (outbox.length > 0) {
    // Attach the last-known etag per entity so the server can detect a stale
    // edit (SYN-1c). Marking conflicts precisely needs the per-mutation results.
    const mutations = await Promise.all(
      outbox.map(async (e) => {
        const entityId = (e.payload.id as string) ?? e.id;
        const known = await storage.getEntity(entityId);
        return {
          clientMutationId: e.id,
          operation: e.operation,
          entityId,
          payload: e.payload,
          clientUpdatedAt: e.createdAt,
          ...(known?.etag ? { baseEtag: known.etag } : {}),
        };
      }),
    );

    const pushRes = await api.push({ deviceId, mailbox, cursor, mutations }, headers);

    if (pushRes.results && pushRes.results.length > 0) {
      // SYN-1d: precise per-mutation handling.
      for (const r of pushRes.results) {
        if (r.status === "applied") {
          await storage.updateOutbox(r.clientMutationId, { status: "done" });
          pushed++;
        } else if (r.status === "conflict") {
          await storage.updateOutbox(r.clientMutationId, { status: "failed", lastError: r.reason ?? "conflict" });
          // Adopt the server's current state so the client stops diverging.
          if (r.serverData) {
            await storage.upsertEntity({
              id: (r.serverData.id as string) ?? r.clientMutationId,
              mailbox,
              data: r.serverData,
              updatedAt: new Date().toISOString(),
              ...(r.etag ? { etag: r.etag } : {}),
              syncState: "conflict",
            });
          }
        } else {
          await storage.updateOutbox(r.clientMutationId, { status: "failed", lastError: r.reason ?? "failed" });
        }
      }
    } else {
      // Backward-compatible path for servers that only return applied/conflicts.
      for (const id of pushRes.applied) {
        await storage.updateOutbox(id, { status: "done" });
        pushed++;
      }
      for (const c of pushRes.conflicts) {
        await storage.updateOutbox(c.clientMutationId, { status: "failed", lastError: c.reason });
      }
    }
    await storage.setCursor(mailbox, pushRes.cursor);
  }

  let nextCursor = await storage.getCursor(mailbox);
  let hasMore = true;
  while (hasMore) {
    const pullRes = await api.pull({ deviceId, mailbox, cursor: nextCursor, limit: 100 }, headers);
    for (const item of pullRes.entities) {
      if (item.operation === "delete") {
        await storage.deleteEntity(item.id);
      } else {
        await storage.upsertEntity({
          id: item.id,
          mailbox,
          data: item.data ?? {},
          updatedAt: item.updatedAt,
          etag: item.etag,
          syncState: "synced",
        });
      }
      pulled++;
    }
    nextCursor = pullRes.cursor;
    await storage.setCursor(mailbox, nextCursor);
    hasMore = pullRes.hasMore;
  }

  return { pushed, pulled };
}

export function shouldRetryOutbox(entry: OutboxEntry): boolean {
  return entry.status === "failed" && entry.retryCount < MAX_OUTBOX_RETRIES;
}
