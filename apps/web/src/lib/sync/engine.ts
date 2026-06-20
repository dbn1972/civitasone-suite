import { runSyncCycle, type MailboxName, type SyncApiClient } from "@civitasone/client-core";
import { createIndexedDbAdapter } from "./indexedDb";

const syncApi: SyncApiClient = {
  async push(req, headers) {
    const res = await fetch(`/api/proxy/v1/sync/push`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(req),
      credentials: "same-origin",
    });
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
): Promise<{ pushed: number; pulled: number }> {
  return runSyncCycle(mailbox, createIndexedDbAdapter(), syncApi, headers, deviceId);
}
