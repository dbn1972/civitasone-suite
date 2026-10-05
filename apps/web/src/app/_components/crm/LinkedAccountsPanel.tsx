"use client";
/**
 * LinkedAccountsPanel — AC-004 (framework, live sync deferred). Connect an email
 * or calendar provider so it can later sync into CRM. Connecting records a
 * PENDING link — we are explicit that automatic sync is not live yet, and never
 * pretend items are flowing. Existing links are listed with an honest status and
 * disconnected via ConfirmDialog. A failed load shows the saved-info badge.
 */
import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { DataSourceBadge } from "../DataSourceBadge";
import { ConfirmDialog, EmptyState, Button } from "../ds";
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

/**
 * GAP-CRM-LINKED-ACCOUNTS-02: every status used to render in the same "pill info"
 * so "Needs attention" and "Disconnected" looked identical to "Connected". Map each
 * status to a distinct pill tone, and prefix a non-colour glyph so the status is not
 * conveyed by colour alone (WCAG 1.4.1).
 */
const STATUS_TONE: Record<LinkedStatus, "warn" | "good" | "bad" | "mut"> = {
  pending: "warn",
  connected: "good",
  error: "bad",
  revoked: "mut",
};
const STATUS_GLYPH: Record<LinkedStatus, string> = {
  pending: "⏳",
  connected: "✓",
  error: "!",
  revoked: "—",
};

export function LinkedAccountsPanel() {
  const t = useTranslations("crmLinkedAccountsPanel");
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
    // GAP-CRM-LINKED-ACCOUNTS-04: don't let a user add a connection they can't see.
    // When the existing list failed to load we don't know what is already linked, so
    // block the request rather than risk a blind duplicate.
    if (source === "error" || source === "loading") {
      setError(t("existingNotLoaded"));
      return;
    }
    // Client-side duplicate guard: a non-revoked link with the same provider and
    // (case-insensitive) email already exists. The backend remains the real
    // uniqueness guard; this just avoids an obviously pointless POST.
    const target = email.trim().toLowerCase();
    const dup = accounts.some(
      (a) => a.provider === provider && a.status !== "revoked" && (a.externalEmail ?? "").trim().toLowerCase() === target,
    );
    if (dup) {
      setError(t("alreadyConnected"));
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

  // GAP-CRM-LINKED-ACCOUNTS-04: while the existing links are loading or failed to
  // load, the connect form is disabled so a user cannot add a (possibly duplicate)
  // link without seeing what is already connected.
  const formDisabled = source === "loading" || source === "error";

  return (
    <div className="card">
      <div className="card-h">
        <h3 id={headingId}>Connect email &amp; calendar</h3>
        {source === "error" ? <DataSourceBadge source="error" /> : null}
      </div>
      <div className="pad" style={{ display: "grid", gap: 14 }}>
        <p role="note" style={{ fontSize: 13, margin: 0, padding: "10px 12px", borderRadius: 8, background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e" }}>
          Connecting a provider registers it for future sync of emails, meetings and tasks. Live two-way sync is not
          switched on yet, so connections stay <strong>pending</strong> and no items are imported.
        </p>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
          {t.rich("ownershipNotice", { strong: (chunks) => <strong>{chunks}</strong> })}
        </p>

        <form onSubmit={connect} aria-labelledby={headingId} style={{ display: "grid", gap: 10 }}>
          <div>
            <label htmlFor={`${headingId}-provider`} style={labelStyle}>Provider</label>
            <select id={`${headingId}-provider`} value={provider} disabled={formDisabled} onChange={(e) => setProvider(e.target.value as LinkedProvider)} style={inputStyle}>
              {LINKED_PROVIDERS.map((p) => <option key={p} value={p}>{LINKED_PROVIDER_LABELS[p]}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`${headingId}-email`} style={labelStyle}>Email address</label>
            <input
              id={`${headingId}-email`}
              type="email"
              value={email}
              disabled={formDisabled}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.gov.in"
              aria-required="true"
              aria-invalid={email.trim() && !EMAIL_RE.test(email.trim()) ? true : undefined}
              style={inputStyle}
            />
          </div>
          <div>
            <Button type="submit" disabled={busy || formDisabled} style={{ minHeight: 44 }}>
              {busy ? t("requesting") : t("requestConnection")}
            </Button>
          </div>
          {message ? <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", margin: 0 }}>{message}</p> : null}
          {error ? <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", margin: 0 }}>{error}</p> : null}
        </form>

        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <h4 style={{ margin: "0 0 8px" }}>Connected accounts</h4>
          {source === "loading" ? (
            <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>Loading connections…</p>
          ) : source === "error" ? (
            <p role="alert" style={{ fontSize: 13, color: "var(--muted)", margin: 0, display: "flex", gap: 8, alignItems: "center" }}>
              {t("connectionsUnavailable")}
              <Button type="button" variant="ghost" size="sm" onClick={() => void load()}>{t("retry")}</Button>
              <DataSourceBadge source="error" />
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
                    <td><span className={`pill ${STATUS_TONE[a.status]}`}><span aria-hidden="true">{STATUS_GLYPH[a.status]}</span> {STATUS_LABEL[a.status]}</span></td>
                    <td style={{ textAlign: "end" }}>
                      <Button type="button" variant="danger" aria-label={`Disconnect ${a.externalEmail || a.provider}`} disabled={busy || !a.id} onClick={() => a.id && setConfirmId(a.id)} style={{ minHeight: 36 }}>
                        Disconnect
                      </Button>
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
