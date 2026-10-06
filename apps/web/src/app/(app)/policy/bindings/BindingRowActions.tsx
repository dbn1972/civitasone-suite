"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ConfirmDialog } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";

/**
 * GAP-POLICY-BINDINGS-05: a Revoke row action. Revoking removes access, so it
 * goes through a ConfirmDialog that requires a reason; the policy-service
 * DELETE /v1/policy/bindings/:id endpoint (admin-gated, audited by the revoke
 * consumer) performs the change. On success the list is refreshed.
 */
export function BindingRowActions({
  bindingId,
  label,
  status,
}: {
  bindingId: string;
  label: string;
  status: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const formError = useFormError("role binding");
  const [error, setError] = useState("");

  if (status !== "active") return <span style={{ color: "var(--mut, #64748b)" }}>—</span>;

  async function revoke(reason?: string) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/proxy/v1/policy/bindings/${bindingId}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...(reason ? { reason } : {}) }),
      });
      if (!res.ok) {
        setError((await formError.fromResponse(res, "save")).message);
        setBusy(false);
        return;
      }
      setOpen(false);
      setBusy(false);
      router.refresh();
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Revoke
      </Button>
      <ConfirmDialog
        open={open}
        title="Revoke binding?"
        description={<>Revoke <strong>{label}</strong>? The user loses this role immediately.</>}
        confirmLabel="Revoke"
        danger
        requireReason
        reasonLabel="Reason for revocation"
        busy={busy}
        errorMessage={error || undefined}
        onConfirm={(reason) => void revoke(reason)}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
