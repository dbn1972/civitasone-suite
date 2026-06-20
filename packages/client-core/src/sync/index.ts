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
  }>;
};

export type SyncPushResponse = {
  mailbox: MailboxName;
  cursor: string;
  applied: string[];
  conflicts: Array<{ clientMutationId: string; reason: string }>;
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
    const pushRes = await api.push({
      deviceId,
      mailbox,
      cursor,
      mutations: outbox.map((e) => ({
        clientMutationId: e.id,
        operation: e.operation,
        entityId: (e.payload.id as string) ?? e.id,
        payload: e.payload,
        clientUpdatedAt: e.createdAt,
      })),
    }, headers);

    for (const id of pushRes.applied) {
      await storage.updateOutbox(id, { status: "done" });
      pushed++;
    }
    for (const c of pushRes.conflicts) {
      await storage.updateOutbox(c.clientMutationId, { status: "failed", lastError: c.reason });
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
