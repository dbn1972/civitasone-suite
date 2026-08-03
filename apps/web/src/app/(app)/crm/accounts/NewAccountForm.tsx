"use client";

import type { CRMAccountSummary } from "@civitasone/types";
import { useRouter } from "next/navigation";
import { useState } from "react";

const inputStyle = { width: "100%", padding: 8, minHeight: 44, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;

/**
 * Creates an account, then optionally attaches it under a parent. The create
 * command is queue-backed (202 Accepted), so the parent is set in a follow-up
 * PATCH once the id is known.
 */
export function NewAccountForm({ accounts }: { accounts: CRMAccountSummary[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", industry: "", website: "", parentId: "" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const res = await fetch("/api/proxy/v1/crm/accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          industry: form.industry || undefined,
          website: form.website || undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.text()) || "Could not create the account.");
      const body = (await res.json().catch(() => ({}))) as { id?: string };

      if (form.parentId && body.id) {
        const link = await fetch(`/api/proxy/v1/crm/accounts/${body.id}/parent`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ parentId: form.parentId }),
        });
        if (!link.ok) {
          setMessage("Account created. The parent could not be set — you can set it from the account page.");
          setOpen(false);
          router.refresh();
          return;
        }
      }

      setMessage("Account created. It appears in the list once processing completes.");
      setOpen(false);
      setForm({ name: "", industry: "", website: "", parentId: "" });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the account.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn primary" onClick={() => setOpen(true)} style={{ minHeight: 44 }}>
        New Account
      </button>
      {open ? (
        <div className="card" style={{ marginTop: 16 }}>
          <form onSubmit={submit} className="pad" style={{ maxWidth: 560 }}>
            <h4 style={{ marginTop: 0 }}>New account</h4>
            <label htmlFor="account-name" style={labelStyle}>Account name</label>
            <input
              id="account-name"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Directorate of Industries"
              style={inputStyle}
            />
            <label htmlFor="account-industry" style={{ ...labelStyle, marginTop: 12 }}>Industry</label>
            <input
              id="account-industry"
              value={form.industry}
              onChange={(e) => setForm({ ...form, industry: e.target.value })}
              placeholder="Government, Manufacturing…"
              style={inputStyle}
            />
            <label htmlFor="account-website" style={{ ...labelStyle, marginTop: 12 }}>Website</label>
            <input
              id="account-website"
              value={form.website}
              onChange={(e) => setForm({ ...form, website: e.target.value })}
              placeholder="https://example.gov.in"
              style={inputStyle}
            />
            <label htmlFor="account-parent" style={{ ...labelStyle, marginTop: 12 }}>Reports to</label>
            <select
              id="account-parent"
              value={form.parentId}
              onChange={(e) => setForm({ ...form, parentId: e.target.value })}
              style={inputStyle}
            >
              <option value="">Top level (no parent)</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <button type="submit" className="btn primary" disabled={busy} style={{ marginTop: 16, minHeight: 44 }}>
              {busy ? "Creating…" : "Create account"}
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
