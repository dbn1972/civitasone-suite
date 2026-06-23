"use client";

/**
 * WEB-1b (01-T2): route mutations through the durable outbox instead of a bare
 * `fetch`. Previously every form POSTed directly, so a mutation made offline was
 * simply lost. Now a mutation is:
 *   1. optimistically written to the local entity store (instant UI feedback)
 *   2. durably enqueued in the IndexedDB outbox (survives reload / restart)
 *   3. pushed immediately when online; left queued when offline
 *   4. registered for Background Sync so it flushes on reconnect (01-T6)
 */
import { getOrCreateDeviceId, type MailboxName, type OutboxEntry } from "@civitasone/client-core";
import { createIndexedDbAdapter, requestBackgroundSync } from "./indexedDb";
import { resolveNamespace } from "./identity";
import { syncMailbox } from "./engine";
import { buildSyncHeaders } from "./headers";

export type SubmitResult = {
  clientMutationId: string;
  /** true if the push reached the server in this call */
  synced: boolean;
  /** true if it is durably queued for a later flush (offline / push failed) */
  queued: boolean;
};

export type SubmitInput<T extends Record<string, unknown>> = {
  mailbox: MailboxName;
  operation: OutboxEntry["operation"];
  entityId: string;
  payload: T;
};

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `m_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export async function submitMutation<T extends Record<string, unknown>>(
  input: SubmitInput<T>,
): Promise<SubmitResult> {
  const ns = await resolveNamespace();
  const storage = createIndexedDbAdapter(ns);
  const clientMutationId = newId();
  const now = new Date().toISOString();

  const entry: OutboxEntry<T> = {
    id: clientMutationId,
    mailbox: input.mailbox,
    operation: input.operation,
    payload: { id: input.entityId, ...input.payload },
    createdAt: now,
    status: "queued",
    retryCount: 0,
  };

  // 1) optimistic local entity so synced reads reflect the change immediately.
  if (input.operation === "delete") {
    await storage.deleteEntity(input.entityId);
  } else {
    await storage.upsertEntity({
      id: input.entityId,
      mailbox: input.mailbox,
      data: { id: input.entityId, ...input.payload },
      updatedAt: now,
      syncState: "pending_push",
    });
  }

  // 2) durable enqueue.
  await storage.enqueueOutbox(entry as OutboxEntry);

  // 3) attempt an immediate push.
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    await requestBackgroundSync();
    return { clientMutationId, synced: false, queued: true };
  }

  try {
    await syncMailbox(input.mailbox, buildSyncHeaders(), getOrCreateDeviceId(), ns);
    const remaining = (await storage.listOutbox(input.mailbox)).find((e) => e.id === clientMutationId);
    const done = !remaining || remaining.status === "done";
    if (!done) await requestBackgroundSync();
    return { clientMutationId, synced: done, queued: !done };
  } catch {
    // Network blip after we went "online" — keep it queued and let bg sync retry.
    await requestBackgroundSync();
    return { clientMutationId, synced: false, queued: true };
  }
}
