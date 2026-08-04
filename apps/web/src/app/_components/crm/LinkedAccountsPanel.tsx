"use client";
/**
 * LinkedAccountsPanel — AC-004 (framework, live sync deferred). Connect an email
 * or calendar provider so it can later sync into CRM. Connecting records a
 * PENDING link — we are explicit that automatic sync is not live yet, and never
 * pretend items are flowing. Existing links are listed with an honest status and
 * disconnected via ConfirmDialog. A failed load shows the saved-info badge.
 */
import { useEffect, useId, useState } from "react";
import { DataSourceBadge } from "../DataSourceBadge";
import { ConfirmDialog, EmptyState } from "../ds";
import {
  getLinkedAccounts,
  connectLinkedAccount,
  deleteLinkedAccount,
  LINKED_PROVIDERS,
  LINKED_PROVIDER_LABELS,
  type LinkedAccount,
  type LinkedProvider,
  type LinkedStatus,
  type AaSource,
} from "@/lib/crm/activityAccount";

const inputStyle = { width: "100%", padding: 8, minHeight: 44, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const STATUS_LABEL: Record<LinkedStatus, string> = {
  pending: "Pending — sync not live yet",
  connected: "Connected",
  error: "Needs attention",
  revoked: "Disconnected",
};

export function LinkedAccountsPanel() {
  const [accounts, setAccounts] = useState<LinkedAccount[]>([]);
  const [source, setSource] = useState<AaSource | "loading">("loading");
  const [provider, setProvider] = useState<LinkedProvider>("google");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const headingId = useId();

  async function load(isLive: () => boolean = () => true) {
    setSource("loading");
    const { data, source: s } = await getLinkedAccounts();
    if (!isLive()) return;
    setAccounts(data);
    setSource(s);
  }

  useEffect(() => {
    let live = true;
    void load(() => live);
    return () => {
      live = false;
    };
  }, []);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    setError("");
    if (!EMAIL_RE.test(email.trim())) {
      setError("Enter the mailbox or calendar email to connect.");
      return;
    }
    setBusy(true);
    try {
      await connectLinkedAccount(provider, email.trim());
      setMessage("Connection requested. It is pending — automatic sync is not live yet.");
      setEmail("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not request the connection.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDisconnect(id: string) {
    setBusy(true);
    setError("");
    try {
      await deleteLinkedAccount(id);
      setMessage("Connection removed.");
      setConfirmId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove the connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card-h">
        <h3 id={headingId}>Connect email &amp; calendar</h3>
        {source === "error" ? <DataSourceBadge source="error" /> : null}
      </div>
      <div className="pad" style={{ display: "grid", gap: 14 }}>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
          Connecting a provider registers it for future sync of emails, meetings and tasks. Live two-way sync is not
          switched on yet, so connections stay <strong>pending</strong> and no items are imported.
        </p>

        <form onSubmit={connect} aria-labelledby={headingId} style={{ display: "grid", gap: 10 }}>
          <div>
            <label htmlFor={`${headingId}-provider`} style={labelStyle}>Provider</label>
            <select id={`${headingId}-provider`} value={provider} onChange={(e) => setProvider(e.target.value as LinkedProvider)} style={inputStyle}>
              {LINKED_PROVIDERS.map((p) => <option key={p} value={p}>{LINKED_PROVIDER_LABELS[p]}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`${headingId}-email`} style={labelStyle}>Email address</label>
            <input
              id={`${headingId}-email`}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.gov.in"
              aria-required="true"
              aria-invalid={email.trim() && !EMAIL_RE.test(email.trim()) ? true : undefined}
              style={inputStyle}
            />
          </div>
          <div>
            <button type="submit" className="btn primary" disabled={busy} style={{ minHeight: 44 }}>
              {busy ? "Connecting…" : "Connect provider"}
            </button>
          </div>
          {message ? <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", margin: 0 }}>{message}</p> : null}
          {error ? <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", margin: 0 }}>{error}</p> : null}
        </form>

        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <h4 style={{ margin: "0 0 8px" }}>Connected accounts</h4>
          {source === "loading" ? (
            <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>Loading connections…</p>
          ) : source === "error" ? (
            <p role="alert" style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
              — Connections unavailable right now. <DataSourceBadge source="error" />
            </p>
          ) : accounts.length === 0 ? (
            <EmptyState icon="🔌" title="No connected accounts" message="Connect a mailbox or calendar above to get started." />
          ) : (
            <table className="tbl">
              <thead><tr><th>Provider</th><th>Email</th><th>Status</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id ?? `${a.provider}-${a.externalEmail}`}>
                    <td>{LINKED_PROVIDER_LABELS[a.provider]}</td>
                    <td style={{ fontSize: 13 }}>{a.externalEmail || "—"}</td>
                    <td><span className="pill info">{STATUS_LABEL[a.status]}</span></td>
                    <td style={{ textAlign: "right" }}>
                      <button type="button" className="btn danger" aria-label={`Disconnect ${a.externalEmail || a.provider}`} disabled={busy || !a.id} onClick={() => a.id && setConfirmId(a.id)} style={{ minHeight: 36 }}>
                        Disconnect
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmId !== null}
        title="Disconnect this account?"
        description="The provider connection will be removed. No further sync will be attempted."
        confirmLabel="Disconnect"
        danger
        busy={busy}
        onCancel={() => setConfirmId(null)}
        onConfirm={() => confirmId && void confirmDisconnect(confirmId)}
      />
    </div>
  );
}
