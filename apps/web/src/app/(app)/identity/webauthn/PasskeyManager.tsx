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
 * - Rename: wired to PATCH /v1/identity/webauthn/credentials/:id with a
 *   deviceName body (1–200 chars). Inline edit: clicking "Rename" opens an
 *   input pre-filled with the current name; Escape or Cancel reverts it.
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

  // Rename state
  const [renaming, setRenaming] = useState<WebauthnCredential | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState<string | undefined>(undefined);
  const renameFormError = useFormError("passkey-rename");

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

  async function rename() {
    if (!renaming) return;
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setRenameError("Name must not be blank.");
      return;
    }
    if (trimmed.length > 200) {
      setRenameError("Name must be 200 characters or fewer.");
      return;
    }
    setRenameBusy(true);
    setRenameError(undefined);
    renameFormError.clear();
    try {
      const res = await fetch(`/api/proxy/v1/identity/webauthn/credentials/${renaming.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceName: trimmed }),
      });
      if (!res.ok) {
        setRenameError((await renameFormError.fromResponse(res, "save")).message);
        return;
      }
      setNotice(`Passkey renamed to "${trimmed}".`);
      setRenaming(null);
      router.refresh();
    } catch (caught) {
      setRenameError(renameFormError.fromException("save", caught).message);
    } finally {
      setRenameBusy(false);
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
              render: (c) => {
                if (renaming?.id === c.id) {
                  return (
                    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                      <input
                        aria-label="New passkey name"
                        value={renameValue}
                        maxLength={200}
                        style={{ font: "inherit", padding: "2px 6px", borderRadius: 4, border: "1px solid var(--border)", width: 160 }}
                        disabled={renameBusy}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { void rename(); }
                          if (e.key === "Escape") { setRenaming(null); setRenameError(undefined); }
                        }}
                        autoFocus
                      />
                      <Button size="sm" disabled={renameBusy} onClick={() => void rename()}>Save</Button>
                      <Button size="sm" variant="ghost" disabled={renameBusy} onClick={() => { setRenaming(null); setRenameError(undefined); }}>Cancel</Button>
                      {renameError ? <span role="alert" style={{ fontSize: 12, color: "var(--danger)" }}>{renameError}</span> : null}
                    </span>
                  );
                }
                return <>{c.deviceName ?? "Unnamed passkey"}</>;
              },
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
                <span style={{ display: "inline-flex", gap: 6 }}>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy || renameBusy}
                    onClick={() => {
                      setRenameError(undefined);
                      setRenameValue(c.deviceName ?? "");
                      setRenaming(c as WebauthnCredential);
                    }}
                  >
                    Rename
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={busy || renameBusy}
                    onClick={() => {
                      setError(undefined);
                      setPending(c as WebauthnCredential);
                    }}
                  >
                    Remove
                  </Button>
                </span>
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
