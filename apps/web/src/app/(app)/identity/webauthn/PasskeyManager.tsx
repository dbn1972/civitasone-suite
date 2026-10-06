"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ConfirmDialog, DataTable, EmptyState } from "../../../_components/ds";
import { formatIndianDateTime } from "@/lib/formatters";
import { useFormError } from "@/lib/useFormError";
import type { WebauthnCredential } from "../_data";

/**
 * GAP-IDENTITY-WEBAUTHN-02 / WEBAUTHN-03: manage the signed-in user's own
 * passkeys. The identity-service credentials endpoint is self-scoped
 * (ctx.actorId), so this is "My passkeys" — the page title says so.
 *
 * - Remove: wired to the real, ownership-scoped DELETE
 *   /v1/identity/webauthn/credentials/:id (services/identity-service
 *   webauthn/routes.ts), behind a ConfirmDialog that warns a passkey removal
 *   can lock the user out, keep another factor.
 * - Register: the backend register ceremony currently returns 501
 *   NOT_IMPLEMENTED (full FIDO2 cryptographic verification is not yet built —
 *   see webauthn/routes.ts POST /register). Rather than offer a button that is
 *   guaranteed to fail or — worse — fabricate a success, we show an honest
 *   "not available yet" note. This is the rules' "honest not-available state"
 *   over a UI-only pretence.
 */
export function PasskeyManager({ credentials }: { credentials: WebauthnCredential[] }) {
  const router = useRouter();
  const [pending, setPending] = useState<WebauthnCredential | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState("");
  const formError = useFormError("passkey");

  async function remove() {
    if (!pending) return;
    setBusy(true);
    setError(undefined);
    formError.clear();
    try {
      const res = await fetch(`/api/proxy/v1/identity/webauthn/credentials/${pending.id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
      });
      if (!res.ok) {
        setError((await formError.fromResponse(res, "save")).message);
        return;
      }
      setNotice(`Passkey "${pending.deviceName ?? "device"}" removed.`);
      setPending(null);
      router.refresh();
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card-h">
        <h3 id="passkeys-table-heading">My passkeys</h3>
      </div>

      <p
        role="note"
        style={{ fontSize: 12.5, color: "var(--mut)", margin: 0, padding: "0 16px 8px" }}
      >
        Registering a new passkey is not available yet. You can review and remove the passkeys
        already registered to your account below.
      </p>

      {notice ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12.5, color: "#067647", margin: 0, padding: "8px 16px 0" }}>
          {notice}
        </p>
      ) : null}

      {credentials.length === 0 ? (
        <EmptyState icon="🔐" title="No passkeys" message="You have no passkeys registered yet." />
      ) : (
        <DataTable<WebauthnCredential & Record<string, unknown>>
          columns={[
            {
              key: "deviceName",
              label: "Device",
              render: (c) => c.deviceName ?? "Unnamed passkey",
            },
            { key: "createdAt", label: "Registered", render: (c) => formatIndianDateTime(c.createdAt) },
            {
              key: "lastUsedAt",
              label: "Last used",
              render: (c) => (c.lastUsedAt ? formatIndianDateTime(c.lastUsedAt) : "Never"),
            },
            {
              key: "id",
              label: "Actions",
              sortable: false,
              render: (c) => (
                <Button
                  variant="danger"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    setError(undefined);
                    setPending(c);
                  }}
                >
                  Remove
                </Button>
              ),
            },
          ]}
          rows={credentials as (WebauthnCredential & Record<string, unknown>)[]}
        />
      )}

      <ConfirmDialog
        open={pending !== null}
        title="Remove this passkey?"
        description={
          <>
            This removes <b>{pending?.deviceName ?? "this passkey"}</b> from your account. If it is
            your only sign-in factor you could be locked out — make sure you have another way to
            sign in first. This cannot be undone.
          </>
        }
        confirmLabel="Remove passkey"
        danger
        busy={busy}
        errorMessage={error}
        onConfirm={() => void remove()}
        onCancel={() => {
          if (!busy) {
            setPending(null);
            setError(undefined);
          }
        }}
      />
    </div>
  );
}
