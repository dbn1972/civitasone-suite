"use client";

import { useState } from "react";
import { DataTable, Segmented, EmptyState } from "../../../../_components/ds";
import type { FinancialStatementSummary } from "@civitasone/types";
import { formatMoney } from "@/lib/formatters";
import { useSeededResource } from "@/lib/sync/resource";

const STATEMENT_TYPES = ["R&P", "I&E", "Balance Sheet"] as const;
type StatementType = (typeof STATEMENT_TYPES)[number];

const TYPE_LABEL: Record<StatementType, string> = {
  "R&P": "Receipts & Payments Account",
  "I&E": "Income & Expenditure Account",
  "Balance Sheet": "Balance Sheet",
};

const TYPE_FILTER: Record<StatementType, ((s: FinancialStatementSummary) => boolean) | null> = {
  "R&P": null,
  "I&E": (s) => s.type === "income" || s.type === "expenditure",
  "Balance Sheet": (s) => s.type === "asset" || s.type === "liability",
};

interface StatementsTableProps {
  statements: FinancialStatementSummary[];
  source?: "api" | "error";
  /** Fiscal year label ("2026-27") the caller resolved from `?fy=` — shown in
   * the segmented-control header instead of a hardcoded year. */
  fy?: string;
}

type StatRow = FinancialStatementSummary & Record<string, unknown>;

export function StatementsTable({ statements, source = "api", fy }: StatementsTableProps) {
  const [activeType, setActiveType] = useState<StatementType>("R&P");
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<FinancialStatementSummary[]>(
    "finance.financialStatements",
    statements,
    source,
    (d) => d.length === 0,
  );

  const filterFn = TYPE_FILTER[activeType];
  const filtered = (filterFn ? rows.filter(filterFn) : rows) as StatRow[];

  const totalOpening = filtered.reduce((s, st) => s + (st.openingBalance as number), 0);
  const totalReceipts = filtered.reduce((s, st) => s + (st.receipts as number), 0);
  const totalPayments = filtered.reduce((s, st) => s + (st.payments as number), 0);
  const totalClosing = filtered.reduce((s, st) => s + (st.closingBalance as number), 0);

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <div>
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>
          {cacheNote}
        </p>
      ) : null}
      <div className="card-h" style={{ marginBottom: "1rem" }}>
        <span style={{ fontWeight: 500, color: "var(--ink2)" }}>
          {TYPE_LABEL[activeType]}{fy ? ` · FY ${fy}` : ""}
        </span>
        <Segmented
          options={[...STATEMENT_TYPES]}
          value={activeType}
          onChange={(v) => setActiveType(v as StatementType)}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon="📊" title="No data for this statement type" message="Select a different statement type above." />
      ) : (
        <>
          <DataTable<StatRow>
            columns={[
              { key: "head", label: "Head" },
              { key: "type", label: "Type", render: (st) => <span style={{ textTransform: "capitalize" }}>{st.type as string}</span> },
              {
                key: "openingBalance",
                label: "Opening",
                align: "right",
                render: (st) => (
                  <span aria-label={`Opening ${formatMoney(st.openingBalance as number)}`}>
                    {formatMoney(st.openingBalance as number)}
                  </span>
                ),
              },
              {
                key: "receipts",
                label: "Receipts",
                align: "right",
                render: (st) => (
                  <span aria-label={`Receipts ${formatMoney(st.receipts as number)}`}>
                    {formatMoney(st.receipts as number)}
                  </span>
                ),
              },
              {
                key: "payments",
                label: "Payments",
                align: "right",
                render: (st) => (
                  <span aria-label={`Payments ${formatMoney(st.payments as number)}`}>
                    {formatMoney(st.payments as number)}
                  </span>
                ),
              },
              {
                key: "closingBalance",
                label: "Closing",
                align: "right",
                render: (st) => (
                  <span aria-label={`Closing ${formatMoney(st.closingBalance as number)}`}>
                    {formatMoney(st.closingBalance as number)}
                  </span>
                ),
              },
            ]}
            rows={filtered}
            sortable
          />
          <div className="dt-toolbar" style={{ justifyContent: "flex-end", borderTop: "1px solid var(--line)" }}>
            <span style={{ fontSize: 13, color: "var(--ink2)" }}>
              Total — Opening: <strong>{formatMoney(totalOpening)}</strong> · Receipts: <strong>{formatMoney(totalReceipts)}</strong> · Payments: <strong>{formatMoney(totalPayments)}</strong> · Closing: <strong>{formatMoney(totalClosing)}</strong>
            </span>
          </div>
        </>
      )}
    </div>
  );
}
