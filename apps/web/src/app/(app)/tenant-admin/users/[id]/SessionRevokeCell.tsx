"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = { sessionId: string; active: boolean };

/**
 * Per-session "Revoke" control. Replaces the dead <span style="cursor:not-allowed">
 * with a real <button> that calls DELETE /identity/sessions/:id via the proxy.
 * Disabled for sessions that are not active (already revoked/expired).
 */
export function SessionRevokeCell({ sessionId, active }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function revoke() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/proxy/identity/sessions/${sessionId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  if (!active) {
    return <span style={{ fontSize: 12, color: "#98a2b3" }} aria-disabled="true">Revoke</span>;
  }

  return (
    <>
      <button
        className="btn ghost"
        style={{ fontSize: 12, padding: "2px 8px" }}
        disabled={busy}
        aria-busy={busy}
        aria-label="Revoke this session"
        onClick={() => void revoke()}
      >
        {busy ? "Revoking…" : "Revoke"}
      </button>
      {error ? <span role="alert" aria-live="assertive" style={{ fontSize: 11, color: "#b91c1c", marginLeft: 6 }}>{error}</span> : null}
    </>
  );
}
