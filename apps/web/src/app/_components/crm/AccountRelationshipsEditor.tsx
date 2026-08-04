"use client";
/**
 * AccountRelationshipsEditor — CM-002. Relate an account to other accounts
 * (parent / subsidiary / group / branch / partner / affiliate) and navigate the
 * resulting web. Adding a relationship needs a target account; existing links
 * are grouped by type and removed via ConfirmDialog. A failed load shows the
 * saved-info badge, never an empty web presented as fact.
 */
import { useEffect, useId, useMemo, useState } from "react";
import { DataSourceBadge } from "../DataSourceBadge";
import { ConfirmDialog, EmptyState } from "../ds";
import {
  getAccountRelationships,
  createAccountRelationship,
  deleteAccountRelationship,
  RELATIONSHIP_TYPES,
  RELATIONSHIP_TYPE_LABELS,
  type AccountRelationship,
  type RelationshipType,
  type AaSource,
} from "@/lib/crm/activityAccount";

const inputStyle = { width: "100%", padding: 8, minHeight: 44, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;

interface AccountOption {
  id: string;
  name: string;
}

interface Props {
  accountId: string;
  /** Other accounts for the target picker (self is filtered out). */
  accountOptions?: AccountOption[];
}

export function AccountRelationshipsEditor({ accountId, accountOptions = [] }: Props) {
  const [rels, setRels] = useState<AccountRelationship[]>([]);
  const [source, setSource] = useState<AaSource | "loading">("loading");
  const [relType, setRelType] = useState<RelationshipType>("subsidiary");
  const [toAccountId, setToAccountId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const headingId = useId();

  const options = useMemo(() => accountOptions.filter((a) => a.id !== accountId), [accountOptions, accountId]);
  const nameOf = useMemo(() => {
    const m = new Map(accountOptions.map((a) => [a.id, a.name]));
    return (id: string) => m.get(id) ?? id;
  }, [accountOptions]);

  async function load(isLive: () => boolean = () => true) {
    setSource("loading");
    const { data, source: s } = await getAccountRelationships(accountId);
    if (!isLive()) return;
    setRels(data);
    setSource(s);
  }

  useEffect(() => {
    let live = true;
    void load(() => live);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    setError("");
    if (!toAccountId.trim()) {
      setError("Choose the account to relate to.");
      return;
    }
    setBusy(true);
    try {
      await createAccountRelationship(accountId, toAccountId.trim(), relType);
      setMessage("Relationship added.");
      setToAccountId("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the relationship.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmRemove(id: string) {
    setBusy(true);
    setError("");
    try {
      await deleteAccountRelationship(accountId, id);
      setMessage("Relationship removed.");
      setConfirmId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove the relationship.");
    } finally {
      setBusy(false);
    }
  }

  const grouped = useMemo(() => {
    const m = new Map<RelationshipType, AccountRelationship[]>();
    for (const r of rels) {
      const list = m.get(r.relType) ?? [];
      list.push(r);
      m.set(r.relType, list);
    }
    return m;
  }, [rels]);

  return (
    <div className="card">
      <div className="card-h">
        <h3 id={headingId}>Account relationships</h3>
        {source === "error" ? <DataSourceBadge source="error" /> : null}
      </div>
      <div className="pad" style={{ display: "grid", gap: 14 }}>
        <form onSubmit={add} aria-labelledby={headingId} style={{ display: "grid", gap: 10 }}>
          <div>
            <label htmlFor={`${headingId}-type`} style={labelStyle}>Relationship</label>
            <select id={`${headingId}-type`} value={relType} onChange={(e) => setRelType(e.target.value as RelationshipType)} style={inputStyle}>
              {RELATIONSHIP_TYPES.map((t) => <option key={t} value={t}>{RELATIONSHIP_TYPE_LABELS[t]}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`${headingId}-to`} style={labelStyle}>Related account</label>
            {options.length > 0 ? (
              <select id={`${headingId}-to`} value={toAccountId} onChange={(e) => setToAccountId(e.target.value)} aria-required="true" style={inputStyle}>
                <option value="">— Choose an account —</option>
                {options.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            ) : (
              <input
                id={`${headingId}-to`}
                value={toAccountId}
                onChange={(e) => setToAccountId(e.target.value)}
                placeholder="Related account id"
                aria-required="true"
                aria-invalid={toAccountId.trim() ? undefined : true}
                style={inputStyle}
              />
            )}
          </div>
          <div>
            <button type="submit" className="btn primary" disabled={busy} style={{ minHeight: 44 }}>
              {busy ? "Saving…" : "Add relationship"}
            </button>
          </div>
          {message ? <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", margin: 0 }}>{message}</p> : null}
          {error ? <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", margin: 0 }}>{error}</p> : null}
        </form>

        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          {source === "loading" ? (
            <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>Loading relationships…</p>
          ) : source === "error" ? (
            <p role="alert" style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
              — Relationships unavailable right now. <DataSourceBadge source="error" />
            </p>
          ) : rels.length === 0 ? (
            <EmptyState icon="🕸️" title="No relationships yet" message="Link this account to a parent, subsidiary, branch or partner above." />
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {RELATIONSHIP_TYPES.filter((t) => grouped.has(t)).map((t) => (
                <div key={t}>
                  <h4 style={{ margin: "0 0 6px", fontSize: 13 }}>{RELATIONSHIP_TYPE_LABELS[t]}</h4>
                  <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
                    {grouped.get(t)!.map((r) => (
                      <li key={r.id ?? r.toAccountId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <a href={`/crm/accounts/${r.toAccountId}`}>{r.toAccountName ?? nameOf(r.toAccountId)}</a>
                        <button
                          type="button"
                          className="btn danger"
                          aria-label={`Remove ${RELATIONSHIP_TYPE_LABELS[t]} link to ${r.toAccountName ?? nameOf(r.toAccountId)}`}
                          disabled={busy || !r.id}
                          onClick={() => r.id && setConfirmId(r.id)}
                          style={{ minHeight: 36 }}
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmId !== null}
        title="Remove this relationship?"
        description="The link between the two accounts will be removed."
        confirmLabel="Remove relationship"
        danger
        busy={busy}
        onCancel={() => setConfirmId(null)}
        onConfirm={() => confirmId && void confirmRemove(confirmId)}
      />
    </div>
  );
}
