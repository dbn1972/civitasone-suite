"use client";
/**
 * TransferListFilters — Sprint 13 / Lifecycle Phase 1
 * Client-side filter bar (employee name, department, date range) + CSV export.
 * Renders TransferOrderCard grid for filtered results.
 */
import { useMemo, useState, useCallback } from "react";
import type { TransferRow } from "./TransferOrderCard";
import { TransferOrderCard } from "./TransferOrderCard";
import { Button } from "@/app/_components/ds";
import { TRANSFER_STATUS_LABEL, transferStatusLabel } from "@/lib/hr/transferStatus";

interface Props {
  transfers: TransferRow[];
}

/** GAP-HR-TRANSFER-05: neutralise CSV formula injection -- a value starting
 * with = + - or @ is interpreted as a formula by Excel/Sheets when the file
 * is opened; prefix with a leading apostrophe (a standard, widely-supported
 * "treat as text" escape) before the existing quote-escaping. */
function csvCell(value: unknown): string {
  const s = String(value ?? "");
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function TransferListFilters({ transfers }: Props) {
  const [query, setQuery]           = useState("");
  const [deptFilter, setDeptFilter] = useState("");
  const [fromDate, setFromDate]     = useState("");
  const [toDate, setToDate]         = useState("");
  const [statusFilter, setStatus]   = useState("");

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return transfers.filter((t) => {
      if (q) {
        const hay = [t.employee, t.employeeId, t.fromOffice, t.toOffice, t.orderNo, t.department]
          .filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      // GAP-HR-TRANSFER-04: this used to test `t.department`, a field the
      // transfers row has never had (the enriched response carries
      // fromDepartmentName/toDepartmentName instead) -- so typing anything
      // here silently zeroed every card. Matches either side of the move.
      if (deptFilter) {
        const d = deptFilter.toLowerCase();
        const from = String(t.fromOffice ?? t.fromDepartmentName ?? "").toLowerCase();
        const to = String(t.toOffice ?? t.toDepartmentName ?? "").toLowerCase();
        if (!from.includes(d) && !to.includes(d)) return false;
      }
      if (statusFilter && t.status !== statusFilter) return false;
      const dateVal = t.effectiveDate ?? t.transferDate;
      if (fromDate && dateVal && dateVal < fromDate) return false;
      if (toDate   && dateVal && dateVal > toDate)   return false;
      return true;
    });
  }, [transfers, query, deptFilter, fromDate, toDate, statusFilter]);

  const exportCsv = useCallback(() => {
    const headers = ["Employee","From Office","To Office","Order No.","Order Date","Effective Date","Relieved Date","Joined Date","Status"];
    const rows = filtered.map((t) => [
      t.employee ?? t.employeeId ?? "",
      t.fromOffice ?? "",
      t.toOffice   ?? "",
      t.orderNo    ?? "",
      t.orderDate  ?? "",
      t.effectiveDate ?? t.transferDate ?? "",
      t.relievedDate  ?? "",
      t.joinedDate    ?? "",
      transferStatusLabel(t.status),
    ]);
    const csv = [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `transfers-${new Date().toISOString().split("T")[0]}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }, [filtered]);

  // GAP-HR-TRANSFER-07: the status dropdown used to render the raw enum
  // value verbatim (e.g. "order_issued") while the cards showed a humanised
  // label -- two vocabularies for the same data on one screen. Filtering
  // still matches on the real, raw status; only the displayed text changes.
  const statuses = useMemo(() => Array.from(new Set(transfers.map((t) => t.status))).sort(), [transfers]);

  return (
    <div style={{ marginBottom: 24 }}>
      {/* Filter bar */}
      <div
        style={{
          display: "flex", flexWrap: "wrap", gap: 10, padding: "14px 20px",
          background: "var(--panel, #f8fafc)", borderRadius: 12,
          border: "1px solid var(--line)", marginBottom: 16,
        }}
      >
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search employee, office or order…"
          aria-label="Search transfers"
          style={{ flex: "1 1 200px", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--line)", minHeight: 40, fontSize: "0.875rem" }}
        />
        <input
          type="text"
          value={deptFilter}
          onChange={(e) => setDeptFilter(e.target.value)}
          placeholder="Department…"
          aria-label="Filter by department"
          style={{ flex: "0 0 160px", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--line)", minHeight: 40, fontSize: "0.875rem" }}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Filter by status"
          style={{ flex: "0 0 160px", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--line)", minHeight: 40, fontSize: "0.875rem" }}
        >
          <option value="">All statuses</option>
          {statuses.map((s) => <option key={s} value={s}>{TRANSFER_STATUS_LABEL[s] ?? transferStatusLabel(s)}</option>)}
        </select>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <label htmlFor="transfer-filter-from-date" style={{ fontSize: "0.8125rem", color: "var(--ink2)", whiteSpace: "nowrap" }}>From date</label>
          {/* GAP-HR-TRANSFER-11: aria-label duplicated (and overrode) this
              same-page visible <label> with slightly different wording
              ("From") -- redundant naming. The visible label now IS the
              full accessible name; no separate aria-label needed. */}
          <input id="transfer-filter-from-date" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
            style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", minHeight: 40, fontSize: "0.875rem" }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <label htmlFor="transfer-filter-to-date" style={{ fontSize: "0.8125rem", color: "var(--ink2)" }}>To date</label>
          <input id="transfer-filter-to-date" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
            style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", minHeight: 40, fontSize: "0.875rem" }} />
        </div>
        <Button
          variant="ghost"
          onClick={exportCsv}
          style={{ fontSize: 13, whiteSpace: "nowrap" }}
          aria-label="Export filtered transfers to CSV"
        >
          ⬇ Export CSV
        </Button>
      </div>

      {/* Result count */}
      <p style={{ fontSize: "0.8125rem", color: "var(--ink3)", margin: "0 0 12px" }}>
        Showing {filtered.length} of {transfers.length} transfers
      </p>

      {/* Card grid */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--ink3)" }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>🔍</div>
          <p style={{ margin: 0, fontWeight: 600 }}>No transfers match your filters</p>
          <p style={{ margin: "6px 0 0", fontSize: "0.875rem" }}>Try clearing the search or adjusting the date range.</p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))" }}>
          {filtered.map((t) => (
            <TransferOrderCard key={t.id} transfer={t} />
          ))}
        </div>
      )}
    </div>
  );
}
