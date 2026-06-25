"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = { userId: string };

/**
 * P0 security controls for a tenant-admin user detail page. Replaces the dead
 * bare <button>s that had no handler. Calls the identity-service via the web
 * proxy and refreshes the server component on success.
 *
 * WCAG: real <button>s with disabled/busy states; a single polite aria-live
 * region announces success, and an assertive region announces errors.
 */
export function UserSecurityActions({ userId }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "reset" | "revokeAll">(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  async function post(path: string, kind: "reset" | "revokeAll", okMessage: string) {
    setBusy(kind);
    setStatus("");
    setError("");
    try {
      const res = await fetch(path, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      setStatus(okMessage);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <button
        className="btn ghost"
        disabled={busy !== null}
        aria-busy={busy === "reset"}
        onClick={() => void post(`/api/proxy/identity/users/${userId}/reset-password`, "reset", "Password reset requested.")}
      >
        {busy === "reset" ? "Resetting…" : "Reset password"}
      </button>
      <button
        className="btn ghost"
        disabled={busy !== null}
        aria-busy={busy === "revokeAll"}
        onClick={() => void post(`/api/proxy/identity/users/${userId}/sessions/revoke-all`, "revokeAll", "All sessions revoked.")}
      >
        {busy === "revokeAll" ? "Revoking…" : "Revoke all sessions"}
      </button>
      <span role="status" aria-live="polite" style={{ fontSize: 12, color: "#067647", alignSelf: "center" }}>{status}</span>
      <span role="alert" aria-live="assertive" style={{ fontSize: 12, color: "#b91c1c", alignSelf: "center" }}>{error}</span>
    </>
  );
}
