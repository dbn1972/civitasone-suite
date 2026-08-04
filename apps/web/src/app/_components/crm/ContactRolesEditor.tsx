"use client";
/**
 * ContactRolesEditor — CM-003. Record the role a contact plays on a specific
 * deal, using the expanded vocabulary (the original decision_maker / influencer
 * / champion / end_user / approver / technical plus beneficiary / partner /
 * billing_contact). A role needs a deal id before it can be added. Existing
 * roles are listed and removed via ConfirmDialog; a failed load shows the
 * saved-info badge rather than an empty set presented as fact.
 */
import { useEffect, useId, useState } from "react";
import { DataSourceBadge } from "../DataSourceBadge";
import { ConfirmDialog, EmptyState } from "../ds";
import { formatIndianDate } from "@/lib/formatters";
import {
  getContactRoles,
  createContactRole,
  deleteContactRole,
  CONTACT_ROLES,
  CONTACT_ROLE_LABELS,
  type ContactRole,
  type ContactRoleType,
  type AaSource,
} from "@/lib/crm/activityAccount";

const inputStyle = { width: "100%", padding: 8, minHeight: 44, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ContactRolesEditor({ contactId }: { contactId: string }) {
  const [roles, setRoles] = useState<ContactRole[]>([]);
  const [source, setSource] = useState<AaSource | "loading">("loading");
  const [role, setRole] = useState<ContactRoleType>("decision_maker");
  const [dealId, setDealId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const headingId = useId();

  async function load(isLive: () => boolean = () => true) {
    setSource("loading");
    const { data, source: s } = await getContactRoles(contactId);
    if (!isLive()) return;
    setRoles(data);
    setSource(s);
  }

  useEffect(() => {
    let live = true;
    void load(() => live);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    setError("");
    if (!UUID_RE.test(dealId.trim())) {
      setError("Enter the deal id this role applies to.");
      return;
    }
    setBusy(true);
    try {
      const { accepted } = await createContactRole(contactId, dealId.trim(), role);
      setMessage(accepted ? "Role submitted — it may take a moment to appear." : "Role added.");
      setDealId("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the role.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmRemove(id: string) {
    setBusy(true);
    setError("");
    try {
      await deleteContactRole(contactId, id);
      setMessage("Role removed.");
      setConfirmId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove the role.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card-h">
        <h3 id={headingId}>Deal roles</h3>
        {source === "error" ? <DataSourceBadge source="error" /> : null}
      </div>
      <div className="pad" style={{ display: "grid", gap: 14 }}>
        <form onSubmit={add} aria-labelledby={headingId} style={{ display: "grid", gap: 10 }}>
          <div>
            <label htmlFor={`${headingId}-role`} style={labelStyle}>Role</label>
            <select id={`${headingId}-role`} value={role} onChange={(e) => setRole(e.target.value as ContactRoleType)} style={inputStyle}>
              {CONTACT_ROLES.map((r) => <option key={r} value={r}>{CONTACT_ROLE_LABELS[r]}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`${headingId}-deal`} style={labelStyle}>Deal id</label>
            <input
              id={`${headingId}-deal`}
              value={dealId}
              onChange={(e) => setDealId(e.target.value)}
              placeholder="Deal this role applies to"
              aria-required="true"
              aria-invalid={dealId.trim() && !UUID_RE.test(dealId.trim()) ? true : undefined}
              style={inputStyle}
            />
          </div>
          <div>
            <button type="submit" className="btn primary" disabled={busy} style={{ minHeight: 44 }}>
              {busy ? "Saving…" : "Add role"}
            </button>
          </div>
          {message ? <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", margin: 0 }}>{message}</p> : null}
          {error ? <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", margin: 0 }}>{error}</p> : null}
        </form>

        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          {source === "loading" ? (
            <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>Loading roles…</p>
          ) : source === "error" ? (
            <p role="alert" style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
              — Roles unavailable right now. <DataSourceBadge source="error" />
            </p>
          ) : roles.length === 0 ? (
            <EmptyState icon="🎭" title="No deal roles yet" message="Record how this contact influences a deal above." />
          ) : (
            <table className="tbl">
              <thead><tr><th>Role</th><th>Deal</th><th>Added</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {roles.map((r) => (
                  <tr key={r.id}>
                    <td><span className="pill info">{CONTACT_ROLE_LABELS[r.role as ContactRoleType] ?? r.role}</span></td>
                    <td>{r.dealId ? <a href={`/crm/deals/${r.dealId}`}>{r.dealId.slice(0, 8)}…</a> : "—"}</td>
                    <td style={{ fontSize: 13 }}>{r.createdAt ? formatIndianDate(r.createdAt) : "—"}</td>
                    <td style={{ textAlign: "right" }}>
                      <button type="button" className="btn danger" aria-label={`Remove ${CONTACT_ROLE_LABELS[r.role as ContactRoleType] ?? r.role} role`} disabled={busy} onClick={() => r.id && setConfirmId(r.id)} style={{ minHeight: 36 }}>
                        Remove
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
        title="Remove this role?"
        description="The contact's role on this deal will be removed."
        confirmLabel="Remove role"
        danger
        busy={busy}
        onCancel={() => setConfirmId(null)}
        onConfirm={() => confirmId && void confirmRemove(confirmId)}
      />
    </div>
  );
}
