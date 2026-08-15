"use client";
/**
 * TransferListFilters — Sprint 13 / Lifecycle Phase 1
 * Client-side filter bar (employee name, department, date range) + Excel export.
 * Renders TransferOrderCard grid for filtered results.
 */
import { useMemo, useState, useCallback } from "react";
import type { TransferRow } from "./TransferOrderCard";
import { TransferOrderCard } from "./TransferOrderCard";

interface Props {
  transfers: TransferRow[];
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
      if (deptFilter && !(t.department ?? "").toLowerCase().includes(deptFilter.toLowerCase())) return false;
      if (statusFilter && t.status !== statusFilter) return false;
      const dateVal = t.effectiveDate ?? t.transferDate;
      if (fromDate && dateVal && dateVal < fromDate) return false;
      if (toDate   && dateVal && dateVal > toDate)   return false;
      return true;
    });
  }, [transfers, query, deptFilter, fromDate, toDate, statusFilter]);

  const exportExcel = useCallback(() => {
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
      t.status,
    ]);
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `transfers-${new Date().toISOString().split("T")[0]}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }, [filtered]);

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
          {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <label style={{ fontSize: "0.8125rem", color: "var(--ink2)", whiteSpace: "nowrap" }}>From</label>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
            aria-label="From date"
            style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", minHeight: 40, fontSize: "0.875rem" }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <label style={{ fontSize: "0.8125rem", color: "var(--ink2)" }}>To</label>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
            aria-label="To date"
            style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", minHeight: 40, fontSize: "0.875rem" }} />
        </div>
        <button
          onClick={exportExcel}
          className="btn ghost"
          style={{ fontSize: 13, whiteSpace: "nowrap" }}
          aria-label="Export filtered transfers to CSV/Excel"
        >
          ⬇ Export Excel
        </button>
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
