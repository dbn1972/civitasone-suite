"use client";
/**
 * ServiceBookView — Sprint 14 / Lifecycle Phase 2
 * Paginated read-only chronological table of a complete service record.
 * Columns: date, event type badge, employee, from, to/detail, order ref.
 * Client-side filter by employee name and event type; 15 rows per page.
 */
import { useState, useMemo } from "react";
import { formatIndianDate } from "@/lib/formatters";

export type ServiceEntry = {
  id: string;
  employee?: string;
  employeeId?: string;
  eventType: string;
  fromPosting?: string;
  toPosting?: string;
  effectiveDate: string;
  orderNo?: string;
  detail?: string;
  status?: string;
} & Record<string, unknown>;

const EVENT_CFG: Record<string, { icon: string; color: string; bg: string; label: string }> = {
  join:        { icon: "🎉", color: "#16a34a", bg: "#f0fdf4", label: "Joining" },
  transfer:    { icon: "🔄", color: "#2563eb", bg: "#eff6ff", label: "Transfer" },
  posting:     { icon: "📍", color: "#2563eb", bg: "#eff6ff", label: "Posting" },
  promotion:   { icon: "⬆️", color: "#7c3aed", bg: "#f5f3ff", label: "Promotion" },
  increment:   { icon: "💹", color: "#0891b2", bg: "#ecfeff", label: "Increment" },
  leave:       { icon: "🌴", color: "#d97706", bg: "#fffbeb", label: "Leave" },
  deputation:  { icon: "🏛️", color: "#0891b2", bg: "#ecfeff", label: "Deputation" },
  confirmation:{ icon: "✅", color: "#16a34a", bg: "#f0fdf4", label: "Confirmation" },
  suspension:  { icon: "⛔", color: "#dc2626", bg: "#fef2f2", label: "Suspension" },
  retirement:  { icon: "📤", color: "#64748b", bg: "#f8fafc", label: "Retirement" },
  other:       { icon: "📌", color: "#64748b", bg: "#f8fafc", label: "Other" },
};

function EventBadge({ type }: { type: string }) {
  const cfg = EVENT_CFG[type] ?? EVENT_CFG.other;
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        padding: "2px 10px", borderRadius: 12,
        background: cfg.bg, color: cfg.color,
        fontSize: "0.75rem", fontWeight: 500, whiteSpace: "nowrap",
      }}
    >
      {cfg.icon} {cfg.label}
    </span>
  );
}

const PAGE_SIZE = 15;

interface Props {
  entries: ServiceEntry[];
  /** Pre-filter to a single employee — supplied by parent when rendering a per-employee view */
  employeeId?: string;
}

export function ServiceBookView({ entries, employeeId }: Props) {
  const [page, setPage]           = useState(0);
  const [empFilter, setEmpFilter] = useState(employeeId ?? "");
  const [typeFilter, setTypeFilter] = useState("all");

  const eventTypes = useMemo(
    () => ["all", ...Array.from(new Set(entries.map((e) => e.eventType)))],
    [entries],
  );

  // Sort chronological asc, then filter
  const filtered = useMemo(() => {
    let r = [...entries].sort(
      (a, b) =>
        new Date(a.effectiveDate).getTime() - new Date(b.effectiveDate).getTime(),
    );
    if (empFilter) {
      const q = empFilter.toLowerCase();
      r = r.filter(
        (e) =>
          (e.employee ?? "").toLowerCase().includes(q) ||
          (e.employeeId ?? "").toLowerCase().includes(q),
      );
    }
    if (typeFilter !== "all") r = r.filter((e) => e.eventType === typeFilter);
    return r;
  }, [entries, empFilter, typeFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  // Clamp current page if filter reduced results
  const safePage   = Math.min(page, totalPages - 1);
  const slice      = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  function gotoPage(p: number) {
    setPage(Math.max(0, Math.min(totalPages - 1, p)));
  }

  const pageNumbers: number[] = [];
  const start = Math.max(0, Math.min(safePage - 2, totalPages - 5));
  for (let i = start; i < Math.min(start + 5, totalPages); i++) pageNumbers.push(i);

  return (
    <div>
      {/* Filter bar */}
      <div
        style={{
          display: "flex", gap: 10, marginBottom: 14,
          flexWrap: "wrap", alignItems: "center",
        }}
      >
        <input
          type="search"
          placeholder="Search employee…"
          value={empFilter}
          onChange={(e) => { setEmpFilter(e.target.value); setPage(0); }}
          style={{
            padding: "7px 12px", borderRadius: 6,
            border: "1px solid var(--line, #e2e8f0)",
            fontSize: "0.875rem", background: "var(--bg, #fff)",
            color: "var(--ink)", flex: "1 1 180px", minWidth: 160,
          }}
          aria-label="Filter by employee name"
        />
        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(0); }}
          style={{
            padding: "7px 12px", borderRadius: 6,
            border: "1px solid var(--line, #e2e8f0)",
            fontSize: "0.875rem", background: "var(--bg, #fff)",
            color: "var(--ink)",
          }}
          aria-label="Filter by event type"
        >
          {eventTypes.map((t) => (
            <option key={t} value={t}>
              {t === "all" ? "All Event Types" : (EVENT_CFG[t]?.label ?? t)}
            </option>
          ))}
        </select>
        <span style={{ fontSize: "0.8125rem", color: "var(--ink3)", marginLeft: "auto" }}>
          {filtered.length} {filtered.length === 1 ? "entry" : "entries"}
        </span>
      </div>

      {/* Table */}
      <div style={{ overflowX: "auto" }}>
        <table
          style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}
          aria-label="Service book entries"
        >
          <thead>
            <tr style={{ background: "var(--bg2, #f8fafc)" }}>
              {["#", "Date", "Event", "Employee", "From", "To / Detail", "Order Ref"].map(
                (h) => (
                  <th
                    key={h}
                    style={{
                      padding: "9px 12px", textAlign: "left",
                      fontWeight: 600, fontSize: "0.75rem",
                      color: "var(--ink2)", whiteSpace: "nowrap",
                      borderBottom: "1px solid var(--line, #e2e8f0)",
                    }}
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {slice.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  style={{
                    padding: "36px 12px", textAlign: "center",
                    color: "var(--ink3)", fontSize: "0.875rem",
                  }}
                >
                  No service entries match the current filter.
                </td>
              </tr>
            ) : (
              slice.map((entry, idx) => {
                const rowNum = safePage * PAGE_SIZE + idx + 1;
                return (
                  <tr
                    key={entry.id}
                    style={{
                      borderBottom: "1px solid var(--line, #f1f5f9)",
                      background:
                        idx % 2 === 0
                          ? "transparent"
                          : "var(--bg2, #f8fafc)",
                    }}
                  >
                    <td
                      style={{
                        padding: "10px 12px", color: "var(--ink3)",
                        width: 36, fontSize: "0.75rem",
                      }}
                    >
                      {rowNum}
                    </td>
                    <td style={{ padding: "10px 12px", whiteSpace: "nowrap", fontWeight: 500 }}>
                      {formatIndianDate(entry.effectiveDate)}
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <EventBadge type={entry.eventType} />
                    </td>
                    <td style={{ padding: "10px 12px", fontWeight: 500 }}>
                      {entry.employee ?? entry.employeeId ?? "—"}
                    </td>
                    <td
                      style={{
                        padding: "10px 12px", color: "var(--ink2)",
                        maxWidth: 160, overflow: "hidden",
                        textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}
                    >
                      {entry.fromPosting ?? "—"}
                    </td>
                    <td
                      style={{
                        padding: "10px 12px", color: "var(--ink2)",
                        maxWidth: 180, overflow: "hidden",
                        textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}
                    >
                      {entry.toPosting ?? entry.detail ?? "—"}
                    </td>
                    <td
                      style={{
                        padding: "10px 12px",
                        fontFamily: "'Courier New', monospace",
                        fontSize: "0.8125rem", color: "var(--ink3)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {entry.orderNo ?? "—"}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div
          style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            marginTop: 14, fontSize: "0.8125rem",
          }}
        >
          <span style={{ color: "var(--ink3)" }}>
            {safePage * PAGE_SIZE + 1}–
            {Math.min(safePage * PAGE_SIZE + PAGE_SIZE, filtered.length)} of{" "}
            {filtered.length}
          </span>
          <div style={{ display: "flex", gap: 4 }}>
            <button
              onClick={() => gotoPage(safePage - 1)}
              disabled={safePage === 0}
              style={{
                padding: "5px 12px", borderRadius: 5,
                border: "1px solid var(--line)",
                background: "var(--bg)",
                cursor: safePage === 0 ? "not-allowed" : "pointer",
                opacity: safePage === 0 ? 0.4 : 1,
              }}
            >
              ←
            </button>
            {pageNumbers.map((pg) => (
              <button
                key={pg}
                onClick={() => gotoPage(pg)}
                style={{
                  padding: "5px 11px", borderRadius: 5, border: "none",
                  background:
                    pg === safePage ? "var(--primary, #2563eb)" : "var(--bg2)",
                  color: pg === safePage ? "#fff" : "var(--ink)",
                  cursor: "pointer",
                }}
              >
                {pg + 1}
              </button>
            ))}
            <button
              onClick={() => gotoPage(safePage + 1)}
              disabled={safePage >= totalPages - 1}
              style={{
                padding: "5px 12px", borderRadius: 5,
                border: "1px solid var(--line)",
                background: "var(--bg)",
                cursor: safePage >= totalPages - 1 ? "not-allowed" : "pointer",
                opacity: safePage >= totalPages - 1 ? 0.4 : 1,
              }}
            >
              →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
