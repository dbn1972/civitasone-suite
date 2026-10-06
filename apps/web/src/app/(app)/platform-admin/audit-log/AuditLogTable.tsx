"use client";

import { Fragment, useMemo, useState } from "react";
import { Button } from "@/app/_components/ds";
import { formatIndianDateTime, istDatePart } from "@/lib/formatters";

/* ─── Types ─────────────────────────────────────────────────────────── */
export type PlatformAuditEvent = {
  id: string;
  timestamp: string;
  actor: string;
  actorRole: string;
  ipAddress?: string;
  actionType: string;
  action: string;
  targetEntity: string;
  targetId?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  outcome: "success" | "failure" | string;
};

const ACTION_TYPES = ["All", "CREATE", "UPDATE", "DELETE", "LOGIN", "LOGOUT", "EXPORT", "ROLE_CHANGE", "SETTINGS_CHANGE", "PERMISSION_CHANGE"] as const;

/**
 * GAP-PLATFORM-ADMIN-AUDIT-LOG-05: neutralise CSV formula injection. A cell
 * whose value begins with = + - @ (or a leading tab/CR) is interpreted as a
 * formula by Excel/Sheets; prefix it with a single quote so it is treated as
 * text. Still quote-wrap and escape embedded quotes.
 */
function csvCell(value: unknown): string {
  let s = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

function exportCsv(events: PlatformAuditEvent[]) {
  const headers = ["Timestamp", "Actor", "Role", "IP", "Action Type", "Action", "Target", "Outcome"];
  const rows = events.map((e) => [
    e.timestamp, e.actor, e.actorRole, e.ipAddress ?? "", e.actionType, e.action, e.targetEntity, e.outcome,
  ]);
  const csv = [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function Diff({ before, after }: { before?: Record<string, unknown>; after?: Record<string, unknown> }) {
  if (!before && !after) return null;
  const keys = Array.from(new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]));
  if (keys.length === 0) return null;
  return (
    <div style={{ marginTop: 8, fontSize: 12, background: "var(--line2, #f8fafc)", borderRadius: 6, overflow: "hidden", border: "1px solid var(--line)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", background: "var(--line, #e2e8f0)", fontSize: 11, fontWeight: 700, color: "var(--ink2)" }}>
        <div style={{ padding: "4px 10px" }}>Before</div>
        <div style={{ padding: "4px 10px", borderInlineStart: "1px solid var(--line)" }}>After</div>
      </div>
      {keys.map((k) => {
        const bv = String(before?.[k] ?? "—");
        const av = String(after?.[k] ?? "—");
        const changed = bv !== av;
        return (
          <div key={k} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", borderTop: "1px solid var(--line)" }}>
            <div style={{ padding: "4px 10px", color: changed ? "var(--bad, #b42318)" : "var(--ink2)", fontFamily: "monospace" }}>
              <span style={{ fontWeight: 600, color: "var(--ink2)" }}>{k}: </span>{bv}
            </div>
            <div style={{ padding: "4px 10px", borderInlineStart: "1px solid var(--line)", color: changed ? "var(--good, #027a48)" : "var(--ink2)", fontFamily: "monospace" }}>
              <span style={{ fontWeight: 600, color: "var(--ink2)" }}>{k}: </span>{av}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const PAGE_SIZE = 20;

/* ─── Component ─────────────────────────────────────────────────────── */
export function AuditLogTable({ events, canExport = true }: { events: PlatformAuditEvent[]; canExport?: boolean }) {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [actorSearch, setActorSearch] = useState("");
  const [actionType, setActionType] = useState("All");
  const [outcomeFilter, setOutcomeFilter] = useState("All");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    return events.filter((e) => {
      // GAP-PLATFORM-ADMIN-AUDIT-LOG-05/03: compare on the event's IST
      // calendar day, inclusive of both bounds, rather than a raw ISO string
      // compare (which dropped the last second and used UTC not IST).
      if (dateFrom || dateTo) {
        const day = istDatePart(e.timestamp);
        if (!day) return false;
        if (dateFrom && day < dateFrom) return false;
        if (dateTo && day > dateTo) return false;
      }
      if (actorSearch && !e.actor.toLowerCase().includes(actorSearch.toLowerCase())) return false;
      if (actionType !== "All" && e.actionType !== actionType) return false;
      if (outcomeFilter !== "All" && e.outcome !== outcomeFilter.toLowerCase()) return false;
      return true;
    });
  }, [events, dateFrom, dateTo, actorSearch, actionType, outcomeFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const inpSty: React.CSSProperties = { padding: "7px 10px", borderRadius: 7, border: "1px solid var(--line)", fontSize: 12.5, fontFamily: "inherit", color: "var(--ink)", background: "var(--bg)", minWidth: 0 };
  const selSty: React.CSSProperties = { ...inpSty, paddingInlineEnd: 28 };

  return (
    <div className="card">
      <div className="card-h">
        <h3 id="platform-audit-heading">Platform audit log</h3>
        {canExport && (
          <Button variant="ghost" size="sm" onClick={() => exportCsv(filtered)}>
            Export current filtered view ({filtered.length})
          </Button>
        )}
      </div>

      {/* Filters */}
      <div style={{ padding: "12px 16px", display: "flex", flexWrap: "wrap", gap: 10, borderBottom: "1px solid var(--line)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <label htmlFor="audit-log-date-from" style={{ fontSize: 11, fontWeight: 650, color: "var(--ink2)" }}>From</label>
          <input id="audit-log-date-from" type="date" style={inpSty} value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(0); }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <label htmlFor="audit-log-date-to" style={{ fontSize: 11, fontWeight: 650, color: "var(--ink2)" }}>To</label>
          <input id="audit-log-date-to" type="date" style={inpSty} value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(0); }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <label htmlFor="audit-log-actor-search" style={{ fontSize: 11, fontWeight: 650, color: "var(--ink2)" }}>Actor</label>
          <input id="audit-log-actor-search" type="search" placeholder="Name or email…" style={{ ...inpSty, minWidth: 160 }} value={actorSearch} onChange={(e) => { setActorSearch(e.target.value); setPage(0); }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <label htmlFor="audit-log-action-type" style={{ fontSize: 11, fontWeight: 650, color: "var(--ink2)" }}>Action type</label>
          <select id="audit-log-action-type" style={selSty} value={actionType} onChange={(e) => { setActionType(e.target.value); setPage(0); }}>
            {ACTION_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <label htmlFor="audit-log-outcome" style={{ fontSize: 11, fontWeight: 650, color: "var(--ink2)" }}>Outcome</label>
          <select id="audit-log-outcome" style={selSty} value={outcomeFilter} onChange={(e) => { setOutcomeFilter(e.target.value); setPage(0); }}>
            {["All", "Success", "Failure"].map((o) => <option key={o}>{o}</option>)}
          </select>
        </div>
        {(dateFrom || dateTo || actorSearch || actionType !== "All" || outcomeFilter !== "All") && (
          <div style={{ display: "flex", flexDirection: "column", gap: 3, justifyContent: "flex-end" }}>
            <Button variant="ghost" size="sm" onClick={() => { setDateFrom(""); setDateTo(""); setActorSearch(""); setActionType("All"); setOutcomeFilter("All"); setPage(0); }}>
              Clear filters
            </Button>
          </div>
        )}
      </div>

      {/* Table */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }} aria-labelledby="platform-audit-heading">
          <thead>
            <tr style={{ background: "var(--line2, #f8fafc)", borderBottom: "1px solid var(--line)" }}>
              {["Timestamp", "Actor", "Action type", "Action", "Target", "IP", "Result"].map((h) => (
                <th key={h} style={{ padding: "10px 14px", textAlign: "start", fontSize: 11.5, fontWeight: 650, color: "var(--ink2)", whiteSpace: "nowrap" }}>{h}</th>
              ))}
              {/* GAP-PLATFORM-ADMIN-AUDIT-LOG-04/06: the expander column needs
                  an accessible name even though its header is visually blank. */}
              <th style={{ padding: "10px 14px", width: 60 }}>
                <span className="sr-only">Show changes</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: "32px 16px", textAlign: "center", color: "var(--ink2)", fontSize: 13 }}>
                  {events.length === 0 ? "No audit events recorded yet." : "No events match the current filters."}
                </td>
              </tr>
            ) : pageRows.map((e) => {
              const expanded = expandedId === e.id;
              const hasDiff = !!(e.before ?? e.after);
              return (
                <Fragment key={e.id}>
                  <tr
                    style={{ borderBottom: "1px solid var(--line)", cursor: hasDiff ? "pointer" : "default" }}
                    onClick={() => hasDiff ? setExpandedId(expanded ? null : e.id) : undefined}
                  >
                    <td style={{ padding: "10px 14px", whiteSpace: "nowrap", fontSize: 12.5, color: "var(--ink2)" }}>{formatIndianDateTime(e.timestamp)}</td>
                    <td style={{ padding: "10px 14px" }}>
                      <div className="who">
                        <div className="av" aria-hidden="true" style={{ fontSize: 10, width: 28, height: 28, borderRadius: "50%", background: "var(--primary-light, #eff6ff)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--primary-d)", fontWeight: 700, flexShrink: 0 }}>
                          {e.actor.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{e.actor}</div>
                          <div style={{ fontSize: 11, color: "var(--ink2)" }}>{e.actorRole || "Unknown"}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      <span className="mono" style={{ fontSize: 11.5 }}>{e.actionType}</span>
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      <span className="mono" style={{ fontSize: 12 }}>{e.action}</span>
                    </td>
                    <td style={{ padding: "10px 14px", fontSize: 12.5 }}>
                      <div>{e.targetEntity}</div>
                      {e.targetId && <div style={{ fontSize: 11, color: "var(--ink2)", fontFamily: "monospace" }}>{e.targetId}</div>}
                    </td>
                    <td style={{ padding: "10px 14px", fontFamily: "monospace", fontSize: 12, color: "var(--ink2)" }}>
                      {e.ipAddress ?? "—"}
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      {e.outcome === "success"
                        ? <span className="pill good">Success</span>
                        : e.outcome === "failure"
                        ? <span className="pill bad">Failure</span>
                        : <span className="pill info">{e.outcome}</span>}
                    </td>
                    <td style={{ padding: "10px 14px", textAlign: "center" }}>
                      {hasDiff && (
                        <button
                          type="button"
                          aria-expanded={expanded}
                          aria-controls={`diff-${e.id}`}
                          aria-label={`Show changes for ${e.action}`}
                          onClick={(ev) => { ev.stopPropagation(); setExpandedId(expanded ? null : e.id); }}
                          style={{ background: "transparent", border: "none", cursor: "pointer", padding: 4, color: "var(--ink2)", fontSize: 16, lineHeight: 1, display: "inline-block", transition: "transform 0.15s", transform: expanded ? "rotate(90deg)" : "none" }}
                        >
                          ›
                        </button>
                      )}
                    </td>
                  </tr>
                  {expanded && hasDiff && (
                    <tr id={`diff-${e.id}`} style={{ background: "var(--line2, #f8fafc)" }}>
                      <td colSpan={8} style={{ padding: "0 14px 12px 56px" }}>
                        <Diff before={e.before} after={e.after} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderTop: "1px solid var(--line)", fontSize: 12.5, color: "var(--ink2)" }}>
        <span>{filtered.length} event{filtered.length === 1 ? "" : "s"}</span>
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="ghost" size="sm" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>← Prev</Button>
          <span style={{ alignSelf: "center" }}>Page {safePage + 1} / {totalPages}</span>
          <Button variant="ghost" size="sm" disabled={safePage >= totalPages - 1} onClick={() => setPage(safePage + 1)}>Next →</Button>
        </div>
      </div>
    </div>
  );
}
