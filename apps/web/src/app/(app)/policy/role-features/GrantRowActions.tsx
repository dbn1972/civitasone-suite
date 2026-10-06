"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ConfirmDialog } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";

/**
 * GAP-POLICY-ROLE-FEATURES-01: per-row Revoke/Restore for a role-feature grant.
 *  - Revoke a currently-granted feature → DELETE /v1/policy/role-features/:id
 *    (admin-gated + audited server-side; needs a reason since it hides UI from
 *    a whole role).
 *  - Restore a revoked grant → re-grant the same role/feature (POST granted:true).
 * On success the list refreshes.
 */
export function GrantRowActions({
  grantId,
  roleName,
  featureKey,
  granted,
}: {
  grantId: string;
  roleName: string;
  featureKey: string;
  granted: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const formError = useFormError("role feature grant");

  async function run(reason?: string) {
    setBusy(true);
    setError("");
    try {
      const res = granted
        ? await fetch(`/api/proxy/v1/policy/role-features/${grantId}`, {
            method: "DELETE",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ...(reason ? { reason } : {}) }),
          })
        : await fetch("/api/proxy/v1/policy/role-features", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ roleName, featureKey, granted: true, ...(reason ? { reason } : {}) }),
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
      <Button variant={granted ? "danger" : "ghost"} size="sm" onClick={() => setOpen(true)}>
        {granted ? "Revoke" : "Restore"}
      </Button>
      <ConfirmDialog
        open={open}
        title={granted ? "Revoke feature?" : "Restore feature?"}
        description={
          granted ? (
            <>
              Revoke <strong>{featureKey}</strong> from <strong>{roleName}</strong>? Everyone with this role
              loses the feature.
            </>
          ) : (
            <>
              Restore <strong>{featureKey}</strong> for <strong>{roleName}</strong>?
            </>
          )
        }
        confirmLabel={granted ? "Revoke" : "Restore"}
        danger={granted}
        requireReason={granted}
        optionalReason={!granted}
        reasonLabel={granted ? "Reason for revocation" : "Reason (optional)"}
        busy={busy}
        errorMessage={error || undefined}
        onConfirm={(reason) => void run(reason)}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
