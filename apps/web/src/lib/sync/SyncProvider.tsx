"use client";

import { useEffect } from "react";
import { getOrCreateDeviceId, computeBrowserFingerprint, defaultDeviceLabel } from "@civitasone/client-core";
import { registerServiceWorker, requestBackgroundSync } from "@/lib/sync/indexedDb";
import { syncMailbox } from "@/lib/sync/engine";
import { resolveNamespace } from "@/lib/sync/identity";
import { buildSyncHeaders, setTrustToken } from "@/lib/sync/headers";
import { flushRequestQueue } from "@/lib/sync/requestQueue";

const MAILBOXES = ["approvals", "notifications", "applications"] as const;

/** Gmail-style background sync — BFF /api/proxy with device + trust headers. */
export function SyncProvider() {
  useEffect(() => {
    void registerServiceWorker();

    const deviceId = getOrCreateDeviceId();

    const runAll = async () => {
      // Drain queued domain writes first, then refresh mailbox reads.
      try {
        await flushRequestQueue();
      } catch {
        /* still offline */
      }
      const ns = await resolveNamespace();
      const headers = buildSyncHeaders();
      for (const mailbox of MAILBOXES) {
        try {
          await syncMailbox(mailbox, headers, deviceId, ns);
        } catch {
          /* offline — Background Sync / online listener will retry */
        }
      }
    };

    void (async () => {
      try {
        const fp = await computeBrowserFingerprint();
        const res = await fetch(`/api/proxy/v1/devices/register`, {
          method: "POST",
          headers: { "content-type": "application/json", ...buildSyncHeaders() },
          body: JSON.stringify({
            deviceId,
            platform: "web",
            label: defaultDeviceLabel("web"),
            fingerprint: fp,
          }),
        });
        if (res.ok) {
          const data = (await res.json()) as { trustToken?: string };
          if (data.trustToken) setTrustToken(data.trustToken);
        }
      } catch {
        /* retry on next sync */
      }
      await runAll();
    })();

    // Flush when connectivity returns and register Background Sync as a backup
    // for when the tab is closed (01-T6).
    const onOnline = () => {
      void runAll();
      void requestBackgroundSync();
    };
    // The SW posts CIVITASONE_SYNC from its `sync` event after reconnect.
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === "CIVITASONE_SYNC") void runAll();
    };

    window.addEventListener("online", onOnline);
    navigator.serviceWorker?.addEventListener?.("message", onMessage);
    return () => {
      window.removeEventListener("online", onOnline);
      navigator.serviceWorker?.removeEventListener?.("message", onMessage);
    };
  }, []);

  return null;
}
