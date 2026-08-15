"use client";

import { useMemo, useState } from "react";

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

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

function Diff({ before, after }: { before?: Record<string, unknown>; after?: Record<string, unknown> }) {
  if (!before && !after) return null;
  const keys = Array.from(new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]));
  if (keys.length === 0) return null;
  return (
    <div style={{ marginTop: 8, fontSize: 12, background: "var(--line2, #f8fafc)", borderRadius: 6, overflow: "hidden", border: "1px solid var(--line)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", background: "var(--line, #e2e8f0)", fontSize: 11, fontWeight: 700, color: "var(--ink2)" }}>
        <div style={{ padding: "4px 10px" }}>Before</div>
        <div style={{ padding: "4px 10px", borderLeft: "1px solid var(--line)" }}>After</div>
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
            <div style={{ padding: "4px 10px", borderLeft: "1px solid var(--line)", color: changed ? "var(--good, #027a48)" : "var(--ink2)", fontFamily: "monospace" }}>
              <span style={{ fontWeight: 600, color: "var(--ink2)" }}>{k}: </span>{av}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function exportCsv(events: PlatformAuditEvent[]) {
  const headers = ["Timestamp", "Actor", "Role", "IP", "Action Type", "Action", "Target", "Outcome"];
  const rows = events.map((e) => [
    e.timestamp, e.actor, e.actorRole, e.ipAddress ?? "", e.actionType, e.action, e.targetEntity, e.outcome,
  ]);
  const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const PAGE_SIZE = 20;

/* ─── Component ─────────────────────────────────────────────────────── */
export function AuditLogTable({ events }: { events: PlatformAuditEvent[] }) {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [actorSearch, setActorSearch] = useState("");
  const [actionType, setActionType] = useState("All");
  const [outcomeFilter, setOutcomeFilter] = useState("All");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    return events.filter((e) => {
      if (dateFrom && e.timestamp < dateFrom) return false;
      if (dateTo && e.timestamp > dateTo + "T23:59:59") return false;
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
  const selSty: React.CSSProperties = { ...inpSty, paddingRight: 28 };

  return (
    <div className="card">
      <div className="card-h">
        <h3 id="platform-audit-heading">Platform audit log</h3>
        <button type="button" className="btn ghost sm" onClick={() => exportCsv(filtered)}>
          Export CSV ({filtered.length})
        </button>
      </div>

      {/* Filters */}
      <div style={{ padding: "12px 16px", display: "flex", flexWrap: "wrap", gap: 10, borderBottom: "1px solid var(--line)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <label style={{ fontSize: 11, fontWeight: 650, color: "var(--ink2)" }}>From</label>
          <input type="date" style={inpSty} value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(0); }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <label style={{ fontSize: 11, fontWeight: 650, color: "var(--ink2)" }}>To</label>
          <input type="date" style={inpSty} value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(0); }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <label style={{ fontSize: 11, fontWeight: 650, color: "var(--ink2)" }}>Actor</label>
          <input type="search" placeholder="Name or email…" style={{ ...inpSty, minWidth: 160 }} value={actorSearch} onChange={(e) => { setActorSearch(e.target.value); setPage(0); }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <label style={{ fontSize: 11, fontWeight: 650, color: "var(--ink2)" }}>Action type</label>
          <select style={selSty} value={actionType} onChange={(e) => { setActionType(e.target.value); setPage(0); }}>
            {ACTION_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <label style={{ fontSize: 11, fontWeight: 650, color: "var(--ink2)" }}>Outcome</label>
          <select style={selSty} value={outcomeFilter} onChange={(e) => { setOutcomeFilter(e.target.value); setPage(0); }}>
            {["All", "Success", "Failure"].map((o) => <option key={o}>{o}</option>)}
          </select>
        </div>
        {(dateFrom || dateTo || actorSearch || actionType !== "All" || outcomeFilter !== "All") && (
          <div style={{ display: "flex", flexDirection: "column", gap: 3, justifyContent: "flex-end" }}>
            <button type="button" className="btn ghost sm" onClick={() => { setDateFrom(""); setDateTo(""); setActorSearch(""); setActionType("All"); setOutcomeFilter("All"); setPage(0); }}>
              Clear filters
            </button>
          </div>
        )}
      </div>

      {/* Table */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }} aria-labelledby="platform-audit-heading">
          <thead>
            <tr style={{ background: "var(--line2, #f8fafc)", borderBottom: "1px solid var(--line)" }}>
              {["Timestamp", "Actor", "Action type", "Action", "Target", "IP", "Result"].map((h) => (
                <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 11.5, fontWeight: 650, color: "var(--ink2)", whiteSpace: "nowrap" }}>{h}</th>
              ))}
              <th style={{ padding: "10px 14px", width: 60 }}></th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: "32px 16px", textAlign: "center", color: "var(--ink2)", fontSize: 13 }}>
                  No events match the current filters.
                </td>
              </tr>
            ) : pageRows.map((e) => {
              const expanded = expandedId === e.id;
              const hasDiff = !!(e.before ?? e.after);
              return (
                <>
                  <tr
                    key={e.id}
                    style={{ borderBottom: "1px solid var(--line)", cursor: hasDiff ? "pointer" : "default" }}
                    onClick={() => hasDiff ? setExpandedId(expanded ? null : e.id) : undefined}
                    aria-expanded={hasDiff ? expanded : undefined}
                  >
                    <td style={{ padding: "10px 14px", whiteSpace: "nowrap", fontSize: 12.5, color: "var(--ink2)" }}>{formatWhen(e.timestamp)}</td>
                    <td style={{ padding: "10px 14px" }}>
                      <div className="who">
                        <div className="av" aria-hidden="true" style={{ fontSize: 10, width: 28, height: 28, borderRadius: "50%", background: "var(--primary-light, #eff6ff)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--primary-d)", fontWeight: 700, flexShrink: 0 }}>
                          {e.actor.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{e.actor}</div>
                          <div style={{ fontSize: 11, color: "var(--ink2)" }}>{e.actorRole}</div>
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
                      {hasDiff && <span style={{ fontSize: 16, color: "var(--ink2)", transition: "transform 0.15s", display: "inline-block", transform: expanded ? "rotate(90deg)" : "none" }}>›</span>}
                    </td>
                  </tr>
                  {expanded && hasDiff && (
                    <tr key={`${e.id}-diff`} style={{ background: "var(--line2, #f8fafc)" }}>
                      <td colSpan={8} style={{ padding: "0 14px 12px 56px" }}>
                        <Diff before={e.before} after={e.after} />
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderTop: "1px solid var(--line)", fontSize: 12.5, color: "var(--ink2)" }}>
        <span>{filtered.length} event{filtered.length === 1 ? "" : "s"}</span>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn ghost sm" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>← Prev</button>
          <span style={{ alignSelf: "center" }}>Page {safePage + 1} / {totalPages}</span>
          <button type="button" className="btn ghost sm" disabled={safePage >= totalPages - 1} onClick={() => setPage(safePage + 1)}>Next →</button>
        </div>
      </div>
    </div>
  );
}
