"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, ConfirmDialog, useToast } from "../../../../_components/ds";
import { useFormError } from "@/lib/useFormError";

type Props = {
  userId: string;
  /** The user's email, so dialog copy and the success toast can name the recipient (DETAIL-04). */
  email: string;
  /** Active session count — Revoke all is disabled when 0 (DETAIL-05). */
  activeSessionCount: number;
  /** Current account status — drives the Suspend vs Reactivate action (USERS-05 / DETAIL-03). */
  status: string;
};

type Action = "reset" | "revokeAll" | "suspend" | "reactivate";

/**
 * Security controls for a tenant-admin user detail page.
 *
 * GAP-TENANT-ADMIN-USERS-DETAIL-01: both actions are destructive/security-
 * sensitive, so each now opens a ConfirmDialog (danger, requireReason) exactly
 * like tenant-admin/sessions/SessionsTable — no fetch fires until a reason is
 * confirmed, and the reason is sent as a JSON {reason} body which the
 * identity-service records in the audit trail.
 *
 * WCAG: real <button>s; the dialog traps focus; success is announced via a
 * toast (persists, DETAIL-04) and errors render inside the dialog.
 */
export function UserSecurityActions({ userId, email, activeSessionCount, status }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const formError = useFormError("security action");

  const isSuspended = status === "suspended";

  async function confirm(reason?: string) {
    if (!pending) return;
    const action = pending;
    setBusy(true);
    setError(undefined);
    formError.clear();
    try {
      let res: Response;
      if (action === "suspend" || action === "reactivate") {
        // USERS-05 / DETAIL-03: suspend/reactivate via the audited status route
        // (identity-service PATCH /identity/users/:id/status, {status, reason}).
        res = await fetch(`/api/proxy/identity/users/${userId}/status`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: action === "suspend" ? "suspended" : "active", reason }),
        });
      } else {
        const path =
          action === "reset"
            ? `/api/proxy/identity/users/${userId}/reset-password`
            : `/api/proxy/identity/users/${userId}/sessions/revoke-all`;
        res = await fetch(path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason }),
        });
      }
      if (!res.ok) {
        setError((await formError.fromResponse(res, "save")).message);
        return;
      }
      setPending(null);
      toast.success(
        action === "reset"
          ? `Password reset link sent to ${email}.`
          : action === "revokeAll"
            ? `All sessions for ${email} have been revoked.`
            : action === "suspend"
              ? `${email} has been suspended.`
              : `${email} has been reactivated.`,
      );
      router.refresh();
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  const revokeAllDisabled = activeSessionCount === 0;

  return (
    <>
      <Button variant="ghost" disabled={busy} onClick={() => { setError(undefined); setPending("reset"); }}>
        Reset password
      </Button>
      <Button
        variant="ghost"
        disabled={busy || revokeAllDisabled}
        title={revokeAllDisabled ? "This user has no active sessions" : undefined}
        onClick={() => { setError(undefined); setPending("revokeAll"); }}
      >
        Revoke all sessions
      </Button>
      <Button
        variant={isSuspended ? "ghost" : "danger"}
        disabled={busy}
        onClick={() => { setError(undefined); setPending(isSuspended ? "reactivate" : "suspend"); }}
      >
        {isSuspended ? "Reactivate" : "Suspend"}
      </Button>

      <ConfirmDialog
        open={pending === "reset"}
        title="Reset this user's password?"
        description={
          <>
            A password reset link will be sent to <b>{email}</b> (the email on file). The user&apos;s current
            password keeps working until they complete the reset.
          </>
        }
        confirmLabel="Send reset link"
        danger
        requireReason
        minReasonLength={3}
        reasonLabel="Reason (recorded in the audit log)"
        busy={busy}
        errorMessage={error}
        onConfirm={(reason) => void confirm(reason)}
        onCancel={() => { if (!busy) { setPending(null); setError(undefined); } }}
      />

      <ConfirmDialog
        open={pending === "revokeAll"}
        title="Revoke all sessions?"
        description={
          <>
            This immediately signs <b>{email}</b> out of every device and session
            ({activeSessionCount} active). They will need to sign in again everywhere. This cannot be undone.
          </>
        }
        confirmLabel="Revoke all sessions"
        danger
        requireReason
        minReasonLength={3}
        reasonLabel="Reason (recorded in the audit log)"
        busy={busy}
        errorMessage={error}
        onConfirm={(reason) => void confirm(reason)}
        onCancel={() => { if (!busy) { setPending(null); setError(undefined); } }}
      />

      <ConfirmDialog
        open={pending === "suspend" || pending === "reactivate"}
        title={isSuspended ? "Reactivate this user?" : "Suspend this user?"}
        description={
          isSuspended ? (
            <>Reactivating <b>{email}</b> restores their ability to sign in.</>
          ) : (
            <>Suspending <b>{email}</b> blocks them from signing in until reactivated. Existing sessions are not revoked by this action — use &quot;Revoke all sessions&quot; for that.</>
          )
        }
        confirmLabel={isSuspended ? "Reactivate user" : "Suspend user"}
        danger={!isSuspended}
        requireReason
        minReasonLength={3}
        reasonLabel="Reason (recorded in the audit log)"
        busy={busy}
        errorMessage={error}
        onConfirm={(reason) => void confirm(reason)}
        onCancel={() => { if (!busy) { setPending(null); setError(undefined); } }}
      />
    </>
  );
}
