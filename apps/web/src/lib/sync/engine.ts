import { runSyncCycle, type MailboxName, type SyncApiClient } from "@civitasone/client-core";
import { createIndexedDbAdapter, type StoreNamespace } from "./indexedDb";

/**
 * WEB-1d (01-T4): push sends `If-Match` with the client's last-known cursor/etag
 * so the server (sync protocol, prompt 03) can detect a stale edit and answer
 * 409. Until the server emits true 409s, a conflict surfaces as a per-mutation
 * `conflicts[]` entry; the engine marks those outbox rows `failed` (not silently
 * "done"), which the UI renders as a conflict rather than a generic error.
 */
const syncApi: SyncApiClient = {
  async push(req, headers) {
    const res = await fetch(`/api/proxy/v1/sync/push`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(req),
      credentials: "same-origin",
    });
    if (res.status === 409) {
      // Server detected a conflict for the whole batch; represent each mutation
      // as a conflict so the outbox marks them failed with server state.
      const body = (await res.json().catch(() => ({}))) as { conflicts?: unknown };
      return {
        mailbox: req.mailbox,
        cursor: req.cursor,
        applied: [],
        conflicts: req.mutations.map((m) => ({ clientMutationId: m.clientMutationId, reason: "conflict" })),
        ...(typeof body === "object" ? body : {}),
      };
    }
    if (!res.ok) throw new Error(`SYNC_PUSH_FAILED: ${res.status}`);
    return res.json();
  },
  async pull(req, headers) {
    const res = await fetch(`/api/proxy/v1/sync/pull`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(req),
      credentials: "same-origin",
    });
    if (!res.ok) throw new Error(`SYNC_PULL_FAILED: ${res.status}`);
    return res.json();
  },
};

export async function syncMailbox(
  mailbox: MailboxName,
  headers: Record<string, string>,
  deviceId: string,
  ns: StoreNamespace | null = null,
): Promise<{ pushed: number; pulled: number }> {
  return runSyncCycle(mailbox, createIndexedDbAdapter(ns), syncApi, headers, deviceId);
}

export { syncApi };
