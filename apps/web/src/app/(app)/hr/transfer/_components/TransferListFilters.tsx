"use client";
/**
 * TransferListFilters — Sprint 13 / Lifecycle Phase 1
 * Client-side filter bar (employee name, department, date range) + CSV export.
 * Renders TransferOrderCard grid for filtered results.
 */
import { useMemo, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import type { TransferRow } from "./TransferOrderCard";
import { TransferOrderCard } from "./TransferOrderCard";
import { Button } from "@/app/_components/ds";

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
  // GAP-HR-TRANSFER-10: all copy comes from the transferUi namespace.
  const tr = useTranslations("transferUi");
  const statusText = (s: string) => (tr.has(`status.${s}`) ? tr(`status.${s}`) : s);
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
    const headers = [tr("csvEmployee"), tr("csvFromOffice"), tr("csvToOffice"), tr("csvOrderNo"), tr("csvOrderDate"), tr("csvEffectiveDate"), tr("csvRelievedDate"), tr("csvJoinedDate"), tr("csvStatus")];
    const rows = filtered.map((t) => [
      t.employee ?? t.employeeId ?? "",
      t.fromOffice ?? "",
      t.toOffice   ?? "",
      t.orderNo    ?? "",
      t.orderDate  ?? "",
      t.effectiveDate ?? t.transferDate ?? "",
      t.relievedDate  ?? "",
      t.joinedDate    ?? "",
      statusText(t.status),
    ]);
    const csv = [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `transfers-${new Date().toISOString().split("T")[0]}.csv`;
    a.click(); URL.revokeObjectURL(url);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- tr/statusText are stable per render for a given locale
  }, [filtered, tr]);

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
          placeholder={tr("searchPlaceholder")}
          aria-label={tr("searchAria")}
          style={{ flex: "1 1 200px", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--line)", minHeight: 40, fontSize: "0.875rem" }}
        />
        <input
          type="text"
          value={deptFilter}
          onChange={(e) => setDeptFilter(e.target.value)}
          placeholder={tr("deptPlaceholder")}
          aria-label={tr("deptAria")}
          style={{ flex: "0 0 160px", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--line)", minHeight: 40, fontSize: "0.875rem" }}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatus(e.target.value)}
          aria-label={tr("statusAria")}
          style={{ flex: "0 0 160px", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--line)", minHeight: 40, fontSize: "0.875rem" }}
        >
          <option value="">{tr("allStatuses")}</option>
          {statuses.map((s) => <option key={s} value={s}>{statusText(s)}</option>)}
        </select>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <label htmlFor="transfer-filter-from-date" style={{ fontSize: "0.8125rem", color: "var(--ink2)", whiteSpace: "nowrap" }}>{tr("fromDate")}</label>
          {/* GAP-HR-TRANSFER-11: aria-label duplicated (and overrode) this
              same-page visible <label> with slightly different wording
              ("From") -- redundant naming. The visible label now IS the
              full accessible name; no separate aria-label needed. */}
          <input id="transfer-filter-from-date" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
            style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", minHeight: 40, fontSize: "0.875rem" }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <label htmlFor="transfer-filter-to-date" style={{ fontSize: "0.8125rem", color: "var(--ink2)" }}>{tr("toDate")}</label>
          <input id="transfer-filter-to-date" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
            style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", minHeight: 40, fontSize: "0.875rem" }} />
        </div>
        <Button
          variant="ghost"
          onClick={exportCsv}
          style={{ fontSize: 13, whiteSpace: "nowrap" }}
          aria-label={tr("exportAria")}
        >
          {tr("exportBtn")}
        </Button>
      </div>

      {/* Result count */}
      <p style={{ fontSize: "0.8125rem", color: "var(--ink3)", margin: "0 0 12px" }}>
        {tr("showing", { shown: filtered.length, total: transfers.length })}
      </p>

      {/* Card grid */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--ink3)" }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>🔍</div>
          <p style={{ margin: 0, fontWeight: 600 }}>{tr("noMatchTitle")}</p>
          <p style={{ margin: "6px 0 0", fontSize: "0.875rem" }}>{tr("noMatchHint")}</p>
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
