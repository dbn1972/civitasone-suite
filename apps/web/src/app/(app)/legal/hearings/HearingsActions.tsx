"use client";

import { userFacingErrorFromResponse } from "@/lib/api/userFacingFromResponse";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/app/_components/ds";

/**
 * Header actions for the Hearings page.
 *
 * GAP-LEGAL-HEARINGS-03: the legal service does not expose a dedicated cause-
 * list "sync" command, so this control is an honest "Refresh": it re-pulls the
 * latest hearings from the read endpoint and refreshes the server-rendered
 * list. It no longer claims to "sync" court data it cannot sync, and the
 * result (success or error) is shown visibly as well as via an aria-live
 * region. The previous "Calendar view" link pointed at this same page and has
 * been removed until a real calendar route exists.
 */
export function HearingsActions() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  async function refresh() {
    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      const res = await fetch("/api/proxy/v1/legal/hearings", {
        method: "GET",
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) throw await userFacingErrorFromResponse(res, "save");
      router.refresh();
      setMessage("Hearings refreshed.");
    } catch (err) {
      setFailed(true);
      setMessage(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        onClick={() => void refresh()}
        disabled={busy}
        aria-busy={busy}
      >
        {busy ? "Refreshing…" : "Refresh"}
      </Button>
      {message ? (
        <span
          role="status"
          aria-live="polite"
          style={{ fontSize: "0.8125rem", color: failed ? "var(--bad)" : "var(--good, #047857)" }}
        >
          {message}
        </span>
      ) : (
        <span role="status" aria-live="polite" className="sr-only" />
      )}
    </>
  );
}
