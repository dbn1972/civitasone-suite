"use client";

import { useEffect } from "react";
import { getOrCreateDeviceId, computeBrowserFingerprint, defaultDeviceLabel } from "@civitasone/client-core";
import { registerServiceWorker } from "@/lib/sync/indexedDb";
import { syncMailbox } from "@/lib/sync/engine";

const TRUST_KEY = "civitasone_device_trust";

function getTrustToken(): string | undefined {
  if (typeof sessionStorage === "undefined") return undefined;
  return sessionStorage.getItem(TRUST_KEY) ?? undefined;
}

function setTrustToken(token: string): void {
  sessionStorage.setItem(TRUST_KEY, token);
}

/** Gmail-style background sync — BFF /api/proxy with device + trust headers. */
export function SyncProvider() {
  useEffect(() => {
    void registerServiceWorker();

    const deviceId = getOrCreateDeviceId();
    const buildHeaders = (): Record<string, string> => {
      const h: Record<string, string> = { "x-device-id": deviceId };
      const trust = getTrustToken();
      if (trust) h["x-device-trust-token"] = trust;
      return h;
    };

    void (async () => {
      try {
        const fp = await computeBrowserFingerprint();
        const res = await fetch(`/api/proxy/v1/devices/register`, {
          method: "POST",
          headers: { "content-type": "application/json", ...buildHeaders() },
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
      } catch { /* retry on next sync */ }

      const headers = buildHeaders();
      for (const mailbox of ["approvals", "notifications", "applications"] as const) {
        try { await syncMailbox(mailbox, headers, deviceId); } catch { /* offline */ }
      }
    })();

    const onOnline = () => {
      const headers = buildHeaders();
      for (const mailbox of ["approvals", "notifications", "applications"] as const) {
        void syncMailbox(mailbox, headers, deviceId);
      }
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  return null;
}
