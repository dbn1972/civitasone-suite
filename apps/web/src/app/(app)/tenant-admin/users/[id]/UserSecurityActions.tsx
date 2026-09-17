"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "../../../../_components/ds";
import { useFormError } from "@/lib/useFormError";

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
  const formError = useFormError("security action");

  async function post(path: string, kind: "reset" | "revokeAll", okMessage: string) {
    setBusy(kind);
    setStatus("");
    setError("");
    formError.clear();
    try {
      const res = await fetch(path, { method: "POST" });
      if (!res.ok) {
        setError((await formError.fromResponse(res, "save")).message);
        return;
      }
      setStatus(okMessage);
      router.refresh();
    } catch {
      setError(formError.fromException("save").message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        disabled={busy !== null}
        aria-busy={busy === "reset"}
        onClick={() => void post(`/api/proxy/identity/users/${userId}/reset-password`, "reset", "Password reset requested.")}
      >
        {busy === "reset" ? "Resetting…" : "Reset password"}
      </Button>
      <Button
        variant="ghost"
        disabled={busy !== null}
        aria-busy={busy === "revokeAll"}
        onClick={() => void post(`/api/proxy/identity/users/${userId}/sessions/revoke-all`, "revokeAll", "All sessions revoked.")}
      >
        {busy === "revokeAll" ? "Revoking…" : "Revoke all sessions"}
      </Button>
      <span role="status" aria-live="polite" style={{ fontSize: 12, color: "#067647", alignSelf: "center" }}>{status}</span>
      <span role="alert" aria-live="assertive" style={{ fontSize: 12, color: "var(--bad)", alignSelf: "center" }}>{error}</span>
    </>
  );
}
