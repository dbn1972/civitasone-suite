"use client";

import type { CRMAccountSummary } from "@civitasone/types";
import { useRouter } from "next/navigation";
import { useState } from "react";

const inputStyle = { width: "100%", padding: 8, minHeight: 44, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;

type Props = {
  accountId: string;
  accountName: string;
  currentParentId: string | null;
  options: CRMAccountSummary[];
};

/**
 * Re-parents an account. The service rejects cycles with 422 CYCLE_DETECTED,
 * which is surfaced verbatim so the user understands why the move was refused.
 */
export function AccountParentForm({ accountId, accountName, currentParentId, options }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [parentId, setParentId] = useState(currentParentId ?? "");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const res = await fetch(`/api/proxy/v1/crm/accounts/${accountId}/parent`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parentId: parentId || null }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
        throw new Error(
          body.code === "CYCLE_DETECTED"
            ? "That move would make the account its own ancestor. Pick a different parent."
            : body.message || "Could not change the parent account.",
        );
      }
      setMessage("Hierarchy updated. The change appears once processing completes.");
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change the parent account.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn primary" onClick={() => setOpen(true)} style={{ minHeight: 44 }}>
        Change Parent
      </button>
      {open ? (
        <div className="card" style={{ marginTop: 16 }}>
          <form onSubmit={submit} className="pad" style={{ maxWidth: 520 }}>
            <h4 style={{ marginTop: 0 }}>Move {accountName}</h4>
            <label htmlFor="parent-select" style={labelStyle}>Reports to</label>
            <select id="parent-select" value={parentId} onChange={(e) => setParentId(e.target.value)} style={inputStyle}>
              <option value="">Top level (no parent)</option>
              {options.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <button type="submit" className="btn primary" disabled={busy} style={{ marginTop: 16, minHeight: 44 }}>
              {busy ? "Saving…" : "Save hierarchy"}
            </button>
            <button type="button" className="btn ghost" style={{ marginLeft: 8, marginTop: 16, minHeight: 44 }} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </form>
        </div>
      ) : null}
      {message ? (
        <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", marginTop: 8 }}>{message}</p>
      ) : null}
      {error ? (
        <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", marginTop: 8 }}>{error}</p>
      ) : null}
    </>
  );
}
