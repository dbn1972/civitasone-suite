"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Header actions for the Hearings page.
 *
 * "Sync cause list" re-pulls the latest hearing/cause-list data from the
 * legal service. The legal service does not expose a dedicated "sync" command
 * endpoint, so this performs a live fetch against the read endpoint
 * (/api/v1/legal/hearings) to confirm connectivity and then refreshes the
 * server-rendered list. Errors are surfaced via an aria-live region.
 */
export function HearingsActions() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function sync() {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/proxy/v1/legal/hearings", {
        method: "GET",
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
      setMessage("Cause list synced.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Link href="/legal/hearings" className="btn ghost">Calendar view</Link>
      <button
        type="button"
        className="btn primary"
        onClick={() => void sync()}
        disabled={busy}
        aria-busy={busy}
      >
        {busy ? "Syncing…" : "Sync cause list"}
      </button>
      <span role="status" aria-live="polite" className="sr-only">{message}</span>
    </>
  );
}
