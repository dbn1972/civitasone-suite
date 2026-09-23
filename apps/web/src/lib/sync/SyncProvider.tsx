"use client";

import { useEffect } from "react";
import { getOrCreateDeviceId, computeBrowserFingerprint, defaultDeviceLabel } from "@civitasone/client-core";
import { registerServiceWorker, requestBackgroundSync } from "@/lib/sync/indexedDb";
import { syncMailbox } from "@/lib/sync/engine";
import { resolveNamespace } from "@/lib/sync/identity";
import { buildSyncHeaders, setTrustToken } from "@/lib/sync/headers";
import { flushRequestQueue } from "@/lib/sync/requestQueue";

const MAILBOXES = ["approvals", "notifications", "applications"] as const;

/**
 * SYNC-OFF (2026-09-23): temporarily disabled — see PR that added this comment
 * for the full writeup.
 *
 * `POST /v1/sync/pull` (and /push) requires a *trusted device*
 * (devices.registered_devices), which is only ever created by the
 * identity-service *worker* process consuming the `identity.device.upsert`
 * command that `POST /v1/devices/register` publishes (routes.ts publishes to a
 * queue; it does not write the row itself — see modules/devices/consumer.ts).
 *
 * That worker (PM2 app `identity-worker`, services/identity-service/dist/
 * worker.js) is not currently running in production: absent from `pm2 list`,
 * its log has had no new lines in ~26 days while the paired API server's log
 * is live, and `devices.registered_devices` has zero rows, full stop. So
 * `assertTrustedDevice` (services/identity-service/src/modules/sync/routes.ts)
 * 403s "DEVICE_NOT_TRUSTED" for every actor on every call, independent of role
 * — including super_admin, which already bypasses the separate mailbox-ABAC
 * check (authorizeMailbox) entirely. That fully explains a 403 on literally
 * every page for every role: this component is mounted in the root
 * (app)/layout.tsx, so it fires once per page load for the whole app.
 *
 * This is an operations gap, not a code or design bug: the protocol is fully
 * implemented and tested on both the server (services/identity-service/tests/
 * sync-routes.test.ts) and the mobile client (apps/mobile/lib/core/sync/), and
 * `identity-worker` also hosts the RBAC/MFA/SCIM/session/tenant-onboarding/
 * API-key consumers, none of which have run since it stopped either — a much
 * bigger issue than sync alone, and restarting a live PM2 process is outside
 * what this change does or should do.
 *
 * Re-enable by flipping this back to `true` once `identity-worker` is
 * confirmed running again AND a device can be verified to actually reach
 * "trusted" end-to-end (e.g. registered_devices gets a row after a real
 * register call, and a subsequent pull for that device no longer 403s).
 */
const SYNC_ENABLED = false;

/** Gmail-style background sync — BFF /api/proxy with device + trust headers. */
export function SyncProvider() {
  useEffect(() => {
    if (!SYNC_ENABLED) return;

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
