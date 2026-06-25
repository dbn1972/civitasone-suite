"use client";

import { useState } from "react";
import { Segmented } from "../../../../_components/ds";
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
}

export function StatementsTable({ statements, source = "api" }: StatementsTableProps) {
  const [activeType, setActiveType] = useState<StatementType>("R&P");
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<FinancialStatementSummary[]>(
    "finance.financialStatements",
    statements,
    source,
    (d) => d.length === 0,
  );

  const filterFn = TYPE_FILTER[activeType];
  const filtered = filterFn ? rows.filter(filterFn) : rows;

  const totalOpening = filtered.reduce((s, st) => s + st.openingBalance, 0);
  const totalReceipts = filtered.reduce((s, st) => s + st.receipts, 0);
  const totalPayments = filtered.reduce((s, st) => s + st.payments, 0);
  const totalClosing = filtered.reduce((s, st) => s + st.closingBalance, 0);

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
          {TYPE_LABEL[activeType]} · FY 2026-27
        </span>
        <Segmented
          options={[...STATEMENT_TYPES]}
          value={activeType}
          onChange={(v) => setActiveType(v as StatementType)}
        />
      </div>

      {filtered.length === 0 ? (
        <div style={{ padding: "2rem", textAlign: "center", color: "var(--ink2)" }}>
          No data for this statement type.
        </div>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>Head</th>
              <th>Type</th>
              <th className="num">Opening</th>
              <th className="num">Receipts</th>
              <th className="num">Payments</th>
              <th className="num">Closing</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((st) => (
              <tr key={st.id}>
                <td>{st.head}</td>
                <td style={{ textTransform: "capitalize" }}>{st.type}</td>
                <td className="num" aria-label={`Opening ${formatMoney(st.openingBalance)}`}>{formatMoney(st.openingBalance)}</td>
                <td className="num" aria-label={`Receipts ${formatMoney(st.receipts)}`}>{formatMoney(st.receipts)}</td>
                <td className="num" aria-label={`Payments ${formatMoney(st.payments)}`}>{formatMoney(st.payments)}</td>
                <td className="num" aria-label={`Closing ${formatMoney(st.closingBalance)}`}>{formatMoney(st.closingBalance)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}><strong>Total</strong></td>
              <td className="num"><strong>{formatMoney(totalOpening)}</strong></td>
              <td className="num"><strong>{formatMoney(totalReceipts)}</strong></td>
              <td className="num"><strong>{formatMoney(totalPayments)}</strong></td>
              <td className="num"><strong>{formatMoney(totalClosing)}</strong></td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}
