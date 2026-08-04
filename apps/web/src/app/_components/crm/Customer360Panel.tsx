"use client";
/**
 * Customer360Panel — CM-004. One honest, aggregated view of a contact or
 * account: activities, communications, deals, quotations, next actions, roles,
 * addresses, consent and score. Every count is gated on source==="error" → we
 * render "—" + the saved-info badge, never a fabricated zero. The external
 * section (cases in Helpdesk, documents in Knowledge) is a declared stub: its
 * counts arrive as null, so we show "—", label it as an unsynced external
 * source, and give a link across rather than inventing a "0".
 */
import { useEffect, useId, useState } from "react";
import { DataSourceBadge } from "../DataSourceBadge";
import { StatGrid, StatCard, EmptyState } from "../ds";
import { formatIndianDate, formatMoney } from "@/lib/formatters";
import {
  getContact360,
  getAccount360,
  ADDRESS_TYPE_LABELS,
  CONTACT_ROLE_LABELS,
  type Customer360,
  type AaSource,
  type AddressType,
  type ContactRoleType,
} from "@/lib/crm/activityAccount";

interface Props {
  subjectType: "contact" | "account";
  subjectId: string;
}

function count(source: AaSource | "loading", n: number): string {
  if (source === "loading") return "…";
  if (source === "error") return "—";
  return n.toLocaleString("en-IN");
}

function money(amount: number | undefined): string {
  if (amount === undefined) return "—";
  try {
    return formatMoney(amount);
  } catch {
    return "—";
  }
}

/** Small honest marker for an external, not-yet-synced source. */
function ExternalTag() {
  return (
    <span
      className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600"
      style={{ border: "1px solid var(--line)", borderRadius: 999, padding: "1px 8px", fontSize: 12, color: "var(--muted)" }}
    >
      External · not synced
    </span>
  );
}

export function Customer360Panel({ subjectType, subjectId }: Props) {
  const [view, setView] = useState<Customer360 | null>(null);
  const [source, setSource] = useState<AaSource | "loading">("loading");
  const headingId = useId();

  useEffect(() => {
    let live = true;
    setSource("loading");
    const loader = subjectType === "account" ? getAccount360 : getContact360;
    void loader(subjectId).then(({ data, source: s }) => {
      if (!live) return;
      setView(data);
      setSource(s);
    });
    return () => {
      live = false;
    };
  }, [subjectType, subjectId]);

  const v = view;
  const isError = source === "error";

  return (
    <div className="card">
      <div className="card-h">
        <h3 id={headingId}>360° view</h3>
        {isError ? <DataSourceBadge source="error" /> : null}
      </div>
      <div className="pad" style={{ display: "grid", gap: 16 }}>
        <StatGrid>
          <StatCard icon="📋" iconBg="#eef2ff" label="Activities" value={count(source, v?.activities.length ?? 0)} />
          <StatCard icon="💬" iconBg="#fce7ee" label="Communications" value={count(source, v?.communications.length ?? 0)} />
          <StatCard icon="💼" iconBg="#ecfdf5" label="Deals" value={count(source, v?.deals.length ?? 0)} />
          <StatCard
            icon="⭐"
            iconBg="#fef3c7"
            label="Score"
            value={source === "loading" ? "…" : isError || v?.score === null || v?.score === undefined ? "—" : String(v.score)}
          />
        </StatGrid>

        {/* Consent (surfaced honestly; never assumed) */}
        <section aria-label="Consent">
          <h4 style={{ margin: "0 0 6px" }}>Consent</h4>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
            {isError
              ? "— Consent unavailable right now."
              : v?.consent == null
                ? "No consent on record."
                : v.consent.marketing === null
                  ? "Marketing consent not recorded."
                  : v.consent.marketing
                    ? `Marketing consent given${v.consent.updatedAt ? ` on ${formatIndianDate(v.consent.updatedAt)}` : ""}.`
                    : "Marketing consent withheld."}
          </p>
        </section>

        {/* Next actions */}
        <section aria-label="Next actions" style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <h4 style={{ margin: "0 0 8px" }}>Next actions</h4>
          {isError ? (
            <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>— Unavailable. <DataSourceBadge source="error" /></p>
          ) : (v?.nextActions.length ?? 0) === 0 ? (
            <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>Nothing scheduled.</p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
              {v!.nextActions.map((n) => (
                <li key={n.id}>{n.title}{n.dueAt ? ` — due ${formatIndianDate(n.dueAt)}` : ""} <span className="pill info">{n.status}</span></li>
              ))}
            </ul>
          )}
        </section>

        {/* Deals + quotations */}
        <section aria-label="Deals and quotations" style={{ borderTop: "1px solid var(--line)", paddingTop: 12, display: "grid", gap: 12 }}>
          <div>
            <h4 style={{ margin: "0 0 8px" }}>Deals</h4>
            {isError ? (
              <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>— Unavailable. <DataSourceBadge source="error" /></p>
            ) : (v?.deals.length ?? 0) === 0 ? (
              <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>No linked deals.</p>
            ) : (
              <table className="tbl">
                <thead><tr><th>Deal</th><th>Stage</th><th style={{ textAlign: "right" }}>Amount</th></tr></thead>
                <tbody>
                  {v!.deals.map((d) => (
                    <tr key={d.id}><td><a href={`/crm/deals/${d.id}`}>{d.name}</a></td><td>{d.stage.replace(/_/g, " ") || "—"}</td><td className="num">{money(d.amount)}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div>
            <h4 style={{ margin: "0 0 8px" }}>Quotations</h4>
            {isError ? (
              <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>— Unavailable. <DataSourceBadge source="error" /></p>
            ) : (v?.quotations.length ?? 0) === 0 ? (
              <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>No quotations.</p>
            ) : (
              <table className="tbl">
                <thead><tr><th>Reference</th><th>Status</th><th style={{ textAlign: "right" }}>Amount</th></tr></thead>
                <tbody>
                  {v!.quotations.map((q) => (
                    <tr key={q.id}><td>{q.reference}</td><td>{q.status || "—"}</td><td className="num">{money(q.amount)}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {/* Roles + addresses */}
        <section aria-label="Roles and addresses" style={{ borderTop: "1px solid var(--line)", paddingTop: 12, display: "grid", gap: 12 }}>
          <div>
            <h4 style={{ margin: "0 0 8px" }}>Roles</h4>
            {isError ? (
              <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>— Unavailable. <DataSourceBadge source="error" /></p>
            ) : (v?.roles.length ?? 0) === 0 ? (
              <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>No roles recorded.</p>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {v!.roles.map((r) => (
                  <span key={r.id ?? `${r.dealId}-${r.role}`} className="pill info">
                    {CONTACT_ROLE_LABELS[r.role as ContactRoleType] ?? r.role}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div>
            <h4 style={{ margin: "0 0 8px" }}>Addresses</h4>
            {isError ? (
              <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>— Unavailable. <DataSourceBadge source="error" /></p>
            ) : (v?.addresses.length ?? 0) === 0 ? (
              <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>No addresses on file.</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                {v!.addresses.map((a, i) => (
                  <li key={a.id ?? i}>
                    <strong>{ADDRESS_TYPE_LABELS[a.addressType as AddressType] ?? a.addressType}</strong>
                    {a.isPrimary ? <span className="pill info" style={{ marginLeft: 6 }}>Primary</span> : null}
                    {" — "}
                    {[a.line1, a.city, a.state, a.pincode].filter(Boolean).join(", ") || "—"}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* External stub — honest link-across, never a fabricated 0 */}
        <section aria-label="Linked external systems" style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <h4 style={{ margin: 0 }}>Cases &amp; documents</h4>
            <ExternalTag />
          </div>
          <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 0 }}>
            Live counts from Helpdesk and Knowledge are not synced into CRM yet. Open the source system to view them.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div className="card" style={{ padding: 12 }}>
              <div className="lab">Cases (Helpdesk)</div>
              <div className="val" style={{ fontSize: 20 }}>{v?.external.caseCount ?? "—"}</div>
              <a className="btn ghost" href="/helpdesk" style={{ marginTop: 6, minHeight: 40, display: "inline-flex", alignItems: "center" }}>View in Helpdesk</a>
            </div>
            <div className="card" style={{ padding: 12 }}>
              <div className="lab">Documents (Knowledge)</div>
              <div className="val" style={{ fontSize: 20 }}>{v?.external.documentCount ?? "—"}</div>
              <a className="btn ghost" href="/knowledge" style={{ marginTop: 6, minHeight: 40, display: "inline-flex", alignItems: "center" }}>View in Knowledge</a>
            </div>
          </div>
        </section>

        {source !== "loading" && !isError && v && v.activities.length === 0 && v.communications.length === 0 && v.deals.length === 0 ? (
          <EmptyState icon="🧭" title="Nothing linked yet" message="Log activity, communications or deals to build this 360° view." />
        ) : null}
      </div>
    </div>
  );
}
