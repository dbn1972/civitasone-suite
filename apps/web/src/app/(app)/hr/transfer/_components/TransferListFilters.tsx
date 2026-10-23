"use client";
/**
 * TransferListFilters — Sprint 13 / Lifecycle Phase 1
 * Client wrapper that owns ONE set of filters (employee name, department,
 * status, date range) + CSV export, and renders the filtered result in the
 * view the user picks: the TransferOrderCard grid or the table.
 *
 * GAP-HR-TRANSFER-04: the card grid used to be filtered here while the page
 * rendered a SEPARATE, independently filtered DataTable underneath, so a
 * status/department/date filter never reached the table and the two search
 * boxes were unrelated. Both views now read the same `filtered` array behind a
 * Cards | Table toggle, the result line and the applied-filter count describe
 * that one array, and a date bound excludes rows that have no date at all.
 */
import { useMemo, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import type { TransferRow } from "./TransferOrderCard";
import { TransferOrderCard } from "./TransferOrderCard";
import { Button, Card, DataTable, Segmented } from "@/app/_components/ds";
import { runAuditedCsvExport } from "@/lib/export/csvExport";
import { useTableExportGuard } from "@/lib/export/useTableExportGuard";
import { transferStatusLabel, transferStatusLabels, transferStatusTones } from "@/lib/hr/transferStatus";
import { istDateKey } from "@/lib/formatters";

interface Props {
  transfers: TransferRow[];
}

type View = "cards" | "table";

export interface TransferFilterValues {
  query: string;
  dept: string;
  status: string;
  fromDate: string;
  toDate: string;
}

const EMPTY_FILTERS: TransferFilterValues = { query: "", dept: "", status: "", fromDate: "", toDate: "" };

/** GAP-HR-TRANSFER-05: neutralise CSV formula injection -- a value starting
 * with = + - or @ is interpreted as a formula by Excel/Sheets when the file
 * is opened; prefix with a leading apostrophe (a standard, widely-supported
 * "treat as text" escape) before the existing quote-escaping. */
function csvCell(value: unknown): string {
  const s = String(value ?? "");
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** How many of the five filters currently narrow the list. */
export function appliedFilterCount(f: TransferFilterValues): number {
  return [f.query.trim(), f.dept.trim(), f.status, f.fromDate, f.toDate].filter(Boolean).length;
}

/**
 * The single filter every view shares (pure, so it is unit-testable).
 *  - search matches employee, ids, offices, order no.;
 *  - department matches EITHER side of the move by NAME (fromOffice/toOffice,
 *    or the raw from/toDepartmentName), not the nonexistent `department` field;
 *  - status is an exact match on the raw enum;
 *  - a date bound only keeps rows that HAVE an effective date inside it -- an
 *    undated row cannot be shown to satisfy a date range.
 */
export function filterTransfers(transfers: TransferRow[], f: TransferFilterValues): TransferRow[] {
  const q = f.query.toLowerCase().trim();
  const d = f.dept.toLowerCase().trim();
  return transfers.filter((t) => {
    if (q) {
      const hay = [t.employee, t.employeeId, t.fromOffice, t.toOffice, t.orderNo, t.department]
        .filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (d) {
      const from = String(t.fromOffice ?? t.fromDepartmentName ?? "").toLowerCase();
      const to = String(t.toOffice ?? t.toDepartmentName ?? "").toLowerCase();
      if (!from.includes(d) && !to.includes(d)) return false;
    }
    if (f.status && t.status !== f.status) return false;
    if (f.fromDate || f.toDate) {
      const raw = t.effectiveDate ?? t.transferDate;
      if (!raw) return false;
      const dateVal = String(raw).slice(0, 10);
      if (f.fromDate && dateVal < f.fromDate) return false;
      if (f.toDate && dateVal > f.toDate) return false;
    }
    return true;
  });
}

export function TransferListFilters({ transfers }: Props) {
  // GAP-HR-TRANSFER-10: all copy comes from the transfer / transferUi namespaces.
  const t = useTranslations("transfer");
  const tr = useTranslations("transferUi");
  const [filters, setFilters] = useState<TransferFilterValues>(EMPTY_FILTERS);
  const [view, setView] = useState<View>("cards");
  const setFilter = <K extends keyof TransferFilterValues>(key: K, value: TransferFilterValues[K]) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  const filtered = useMemo(() => filterTransfers(transfers, filters), [transfers, filters]);
  const activeCount = appliedFilterCount(filters);

  // GAP-HR-TRANSFER-07: the dropdown, the cards and the table all label a
  // status through the same transferUi.status.* keys; filtering still matches
  // the raw enum value.
  const statuses = useMemo(() => Array.from(new Set(transfers.map((r) => r.status))).sort(), [transfers]);
  const statusLabels = useMemo(() => transferStatusLabels(tr, statuses), [tr, statuses]);
  const statusTones = useMemo(() => transferStatusTones(), []);

  const exportGuard = useTableExportGuard("hr/transfer");
  const [exportError, setExportError] = useState<string | null>(null);

  const buildCsv = (): string => {
    const headers = [tr("csvEmployee"), tr("csvFromOffice"), tr("csvToOffice"), tr("csvOrderNo"), tr("csvOrderDate"), tr("csvEffectiveDate"), tr("csvRelievedDate"), tr("csvJoinedDate"), tr("csvStatus")];
    const rows = filtered.map((r) => [
      r.employee ?? r.employeeId ?? "",
      r.fromOffice ?? "",
      r.toOffice   ?? "",
      r.orderNo    ?? "",
      r.orderDate  ?? "",
      r.effectiveDate ?? r.transferDate ?? "",
      r.relievedDate  ?? "",
      r.joinedDate    ?? "",
      transferStatusLabel(tr, r.status),
    ]);
    return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  };

  // W1 SF-08: transfer orders name employees; audit first (fail-closed), then build the file.
  const exportCsv = useCallback(async () => {
    setExportError(null);
    const verdict = await runAuditedCsvExport({
      guard: exportGuard,
      rowCount: filtered.length,
      filename: `transfers-${istDateKey(new Date())}.csv`,
      build: buildCsv,
    });
    if (!verdict.ok) setExportError(verdict.message);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- buildCsv closes over filtered/tr, both listed
  }, [filtered, tr, exportGuard]);

  const tableColumns: { key: keyof TransferRow & string; label: string; cellType?: "status" | "date"; statusLabels?: Record<string, string>; statusVariants?: Record<string, "good" | "warn" | "mut" | "bad" | "info"> }[] = [
    { key: "employee",      label: t("colEmployee") },
    { key: "fromOffice",    label: t("colFrom") },
    { key: "toOffice",      label: t("colTo") },
    // GAP-HR-TRANSFER-04: ISO dates render via formatIndianDate (e.g. 01 Sep 2026) through the built-in date cell.
    { key: "effectiveDate", label: t("colEffectiveDate"), cellType: "date" },
    { key: "orderNo",       label: t("colOrderNo") },
    { key: "relievedDate",  label: t("colRelievedDate"), cellType: "date" },
    { key: "status",        label: t("colStatus"), cellType: "status", statusLabels, statusVariants: statusTones },
  ];

  // Nothing to filter at all: show the table's own empty state, not a filter bar
  // over an empty list.
  if (transfers.length === 0) {
    return (
      <Card title={t("cardTitle")}>
        <DataTable<TransferRow>
          columns={tableColumns}
          rows={[]}
          emptyIcon="📍"
          emptyTitle={t("emptyTitle")}
          emptyMessage={t("emptyMessage")}
        />
      </Card>
    );
  }

  const fieldStyle = { padding: "8px 12px", borderRadius: 8, border: "1px solid var(--line)", minHeight: 40, fontSize: "0.875rem" } as const;

  return (
    <div style={{ marginBottom: 24 }}>
      {/* Filter bar */}
      <div
        style={{
          display: "flex", flexWrap: "wrap", gap: 10, padding: "14px 20px",
          background: "var(--panel)", borderRadius: 12,
          border: "1px solid var(--line)", marginBottom: 16,
        }}
      >
        <input
          type="search"
          value={filters.query}
          onChange={(e) => setFilter("query", e.target.value)}
          placeholder={tr("searchPlaceholder")}
          aria-label={tr("searchAria")}
          style={{ flex: "1 1 200px", ...fieldStyle }}
        />
        <input
          type="text"
          value={filters.dept}
          onChange={(e) => setFilter("dept", e.target.value)}
          placeholder={tr("deptPlaceholder")}
          aria-label={tr("deptAria")}
          style={{ flex: "0 0 160px", ...fieldStyle }}
        />
        <select
          value={filters.status}
          onChange={(e) => setFilter("status", e.target.value)}
          aria-label={tr("statusAria")}
          style={{ flex: "0 0 160px", ...fieldStyle }}
        >
          <option value="">{tr("allStatuses")}</option>
          {statuses.map((s) => <option key={s} value={s}>{statusLabels[s]}</option>)}
        </select>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <label htmlFor="transfer-filter-from-date" style={{ fontSize: "0.8125rem", color: "var(--ink2)", whiteSpace: "nowrap" }}>{tr("fromDate")}</label>
          {/* GAP-HR-TRANSFER-11: aria-label duplicated (and overrode) this
              same-page visible <label> with slightly different wording
              ("From") -- redundant naming. The visible label now IS the
              full accessible name; no separate aria-label needed. */}
          <input id="transfer-filter-from-date" type="date" value={filters.fromDate} onChange={(e) => setFilter("fromDate", e.target.value)}
            style={{ ...fieldStyle, padding: "8px 10px" }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <label htmlFor="transfer-filter-to-date" style={{ fontSize: "0.8125rem", color: "var(--ink2)" }}>{tr("toDate")}</label>
          <input id="transfer-filter-to-date" type="date" value={filters.toDate} onChange={(e) => setFilter("toDate", e.target.value)}
            style={{ ...fieldStyle, padding: "8px 10px" }} />
        </div>
        {activeCount > 0 && (
          <Button variant="ghost" onClick={() => setFilters(EMPTY_FILTERS)} style={{ fontSize: 13, whiteSpace: "nowrap" }}>
            {tr("clearFilters")}
          </Button>
        )}
        <Button
          variant="ghost"
          onClick={exportCsv}
          style={{ fontSize: 13, whiteSpace: "nowrap" }}
          aria-label={tr("exportAria")}
        >
          {tr("exportBtn")}
        </Button>
      </div>
      {exportError && <p role="alert" style={{ color: "var(--danger)", fontSize: 13, margin: "0 0 8px" }}>{exportError}</p>}

      {/* Result count + applied-filter count + view toggle: all describe the one filtered array */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10, margin: "0 0 12px" }}>
        <p style={{ fontSize: "0.8125rem", color: "var(--ink3)", margin: 0 }}>
          {tr("showing", { shown: filtered.length, total: transfers.length })}
          {activeCount > 0 && <> · {tr("filtersApplied", { count: activeCount })}</>}
        </p>
        <div role="group" aria-label={tr("viewToggleAria")}>
          <Segmented
            options={[{ value: "cards", label: tr("viewCards") }, { value: "table", label: tr("viewTable") }]}
            value={view}
            onChange={(v) => setView(v as View)}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--ink3)" }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>🔍</div>
          <p style={{ margin: 0, fontWeight: 600 }}>{tr("noMatchTitle")}</p>
          <p style={{ margin: "6px 0 0", fontSize: "0.875rem" }}>{tr("noMatchHint")}</p>
        </div>
      ) : view === "cards" ? (
        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))" }}>
          {filtered.map((r) => (
            <TransferOrderCard key={r.id} transfer={r} />
          ))}
        </div>
      ) : (
        <Card title={t("cardTitle")}>
          <DataTable<TransferRow>
            columns={tableColumns}
            rows={filtered}
            sortable
            pageSize={15}
            emptyIcon="📍"
            emptyTitle={t("emptyTitle")}
            emptyMessage={t("emptyMessage")}
          />
        </Card>
      )}
    </div>
  );
}
