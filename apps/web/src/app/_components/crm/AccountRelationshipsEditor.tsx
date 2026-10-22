"use client";
/**
 * AccountRelationshipsEditor — CM-002. Relate an account to other accounts
 * (parent / subsidiary / group / branch / partner / affiliate) and navigate the
 * resulting web. Adding a relationship needs a target account; existing links
 * are grouped by type and removed via ConfirmDialog. A failed load shows the
 * saved-info badge, never an empty web presented as fact.
 *
 * The related account is picked through a server-side search (EntityPicker over
 * GET /v1/crm/accounts?search=), not from a pre-loaded list, so it works for a
 * tenant with more accounts than the capped list endpoint returns
 * (GAP-CRM-ACCOUNTS-DETAIL-01).
 */
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { DataSourceBadge } from "../DataSourceBadge";
import { ConfirmDialog, EmptyState, Button, EntityPicker, type EntityOption } from "../ds";
import { resolveCrmAccounts, searchCrmAccounts } from "@/lib/entityAdapters/crmAccount";
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

interface Props {
  accountId: string;
}

export function AccountRelationshipsEditor({ accountId }: Props) {
  const t = useTranslations("crmAccountRelationships");
  const [rels, setRels] = useState<AccountRelationship[]>([]);
  const [source, setSource] = useState<AaSource | "loading">("loading");
  const [relType, setRelType] = useState<RelationshipType>("subsidiary");
  const [toAccountId, setToAccountId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const headingId = useId();

  // An account cannot relate to itself, so it is hidden from the picker; the
  // server rejects a self-loop as well.
  const searchAccounts = useCallback(
    (query: string, signal: AbortSignal): Promise<EntityOption[]> =>
      searchCrmAccounts(query, signal, { excludeIds: [accountId], strict: true }),
    [accountId],
  );
  /** A neutral label for a link whose target name was not returned -- never the raw id. */
  const nameOf = (r: AccountRelationship) => r.toAccountName ?? t("unnamedAccount");

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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- load is redefined each render but only closes over values already listed in this array; nothing else it reads can change independently.
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
              {RELATIONSHIP_TYPES.map((type) => <option key={type} value={type}>{RELATIONSHIP_TYPE_LABELS[type]}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`${headingId}-to`} style={labelStyle}>Related account</label>
            <EntityPicker
              id={`${headingId}-to`}
              value={toAccountId || null}
              onChange={(next) => setToAccountId(typeof next === "string" ? next : "")}
              search={searchAccounts}
              resolve={resolveCrmAccounts}
              placeholder={t("searchPlaceholder")}
              noResultsText={t("noMatches")}
              searchingText={t("searching")}
              searchErrorText={t("searchError")}
            />
          </div>
          <div>
            <Button type="submit" disabled={busy} style={{ minHeight: 44 }}>
              {busy ? "Saving…" : "Add relationship"}
            </Button>
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
              {RELATIONSHIP_TYPES.filter((type) => grouped.has(type)).map((type) => (
                <div key={type}>
                  <h4 style={{ margin: "0 0 6px", fontSize: 13 }}>{RELATIONSHIP_TYPE_LABELS[type]}</h4>
                  <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
                    {grouped.get(type)!.map((r) => (
                      <li key={r.id ?? r.toAccountId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <a href={`/crm/accounts/${encodeURIComponent(r.toAccountId)}`}>{nameOf(r)}</a>
                        <Button
                          type="button"
                          variant="danger"
                          aria-label={`Remove ${RELATIONSHIP_TYPE_LABELS[type]} link to ${nameOf(r)}`}
                          disabled={busy || !r.id}
                          onClick={() => r.id && setConfirmId(r.id)}
                          style={{ minHeight: 36 }}
                        >
                          Remove
                        </Button>
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
