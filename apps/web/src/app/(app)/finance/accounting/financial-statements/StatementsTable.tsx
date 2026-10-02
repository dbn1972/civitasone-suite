"use client";

import { useState } from "react";
import { DataTable, Segmented, EmptyState, RefreshErrorState, StatGrid, StatCard } from "../../../../_components/ds";
import { toHumanError } from "@/lib/messages";
import { balanceSheetTotals, incomeExpenditureTotals, parseRupeesExact } from "./statementTotals";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
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

/** "—" for anything that is not a clean money value (never a fabricated 0). */
function cellMoney(v: unknown): string {
  const p = parseRupeesExact(v);
  return p === null ? "—" : formatMoney(p);
}

const MONEY_FIELDS = ["openingBalance", "receipts", "payments", "closingBalance"] as const;

type StatRow = FinancialStatementSummary & Record<string, unknown>;

export function StatementsTable({ statements, source = "api" }: StatementsTableProps) {
  const [activeType, setActiveType] = useState<StatementType>("R&P");
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<FinancialStatementSummary[]>(
    "finance.financialStatements",
    statements,
    source,
    (d) => d.length === 0,
  );

  const filterFn = TYPE_FILTER[activeType];
  const filtered = (filterFn ? rows.filter(filterFn) : rows) as StatRow[];

  // GAP-FINANCE-ACCOUNTING-FINANCIAL-STATEMENTS-02: totals are derived per
  // statement (never summed across account classes).
  const ie = incomeExpenditureTotals(rows);
  const bs = balanceSheetTotals(rows);

  // Any unreadable figure anywhere: flag it, show "—" in the cell, and withhold
  // totals and the balance verdict that would silently exclude it.
  const badCells = rows.reduce(
    (n, r) => n + MONEY_FIELDS.filter((f) => parseRupeesExact((r as unknown as Record<string, unknown>)[f]) === null).length,
    0,
  );

  // GAP-FINANCE-ACCOUNTING-FINANCIAL-STATEMENTS-01: a failed load with nothing
  // cached is an error, not a table of zeros.
  if (provenance === "error-no-data") {
    return <RefreshErrorState error={toHumanError("load", { area: "financial statements" })} backHref="/finance" />;
  }

  return (
    <div>
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `rows`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      {badCells > 0 ? (
        <p role="alert" style={{ margin: "0 0 12px", color: "#b91c1c", fontSize: "0.85rem" }}>
          Data error: {badCells} figure{badCells === 1 ? "" : "s"} could not be read and {badCells === 1 ? "is" : "are"} shown as
          &quot;—&quot;. Totals and the balance check are withheld until the source data is corrected.
        </p>
      ) : null}
      {activeType === "I&E" && rows.length > 0 ? (
        <StatGrid>
          <StatCard icon="📥" iconBg="#ecfdf3" label="Total Income" value={ie.invalidRows ? "—" : formatMoney(ie.totalIncome)} />
          <StatCard icon="📤" iconBg="#fef3f2" label="Total Expenditure" value={ie.invalidRows ? "—" : formatMoney(ie.totalExpenditure)} />
          <StatCard
            icon="💰"
            iconBg="#eff6ff"
            label={ie.surplus < 0n ? "Deficit" : "Surplus"}
            value={ie.invalidRows ? "—" : formatMoney(ie.surplus < 0n ? -ie.surplus : ie.surplus)}
            {...(ie.invalidRows ? {} : { delta: ie.surplus < 0n ? "Deficit" : "Surplus", up: ie.surplus >= 0n })}
          />
        </StatGrid>
      ) : null}
      {activeType === "Balance Sheet" && rows.length > 0 ? (
        <StatGrid>
          <StatCard icon="🏛️" iconBg="#e7edfd" label="Total Assets" value={bs.invalidRows ? "—" : formatMoney(bs.totalAssets)} />
          <StatCard icon="📑" iconBg="#fef3f2" label="Total Liabilities" value={bs.invalidRows ? "—" : formatMoney(bs.totalLiabilities)} />
          <StatCard
            icon="💰"
            iconBg="#eff6ff"
            label={bs.surplus < 0n ? "Current-period deficit" : "Current-period surplus"}
            value={bs.invalidRows ? "—" : formatMoney(bs.surplus < 0n ? -bs.surplus : bs.surplus)}
          />
          <StatCard
            icon="⚖️"
            iconBg="#ecfdf3"
            label="Balance check"
            value={bs.invalidRows ? "Cannot verify" : bs.balanced ? "Balanced" : "Unbalanced"}
            {...(bs.invalidRows
              ? { delta: "Unreadable figures in the data" , up: false }
              : {
                  delta: bs.balanced ? "Assets = Liabilities + surplus" : `Difference ${formatMoney(bs.difference < 0n ? -bs.difference : bs.difference)}`,
                  up: bs.balanced,
                })}
          />
        </StatGrid>
      ) : null}
      <div className="card-h" style={{ marginBottom: "1rem" }}>
        <span style={{ fontWeight: 500, color: "var(--ink2)" }}>
          {TYPE_LABEL[activeType]} · cumulative, all periods
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
                  <span aria-label={`Opening ${cellMoney(st.openingBalance)}`}>
                    {cellMoney(st.openingBalance)}
                  </span>
                ),
              },
              {
                key: "receipts",
                label: "Receipts",
                align: "right",
                render: (st) => (
                  <span aria-label={`Receipts ${cellMoney(st.receipts)}`}>
                    {cellMoney(st.receipts)}
                  </span>
                ),
              },
              {
                key: "payments",
                label: "Payments",
                align: "right",
                render: (st) => (
                  <span aria-label={`Payments ${cellMoney(st.payments)}`}>
                    {cellMoney(st.payments)}
                  </span>
                ),
              },
              {
                key: "closingBalance",
                label: "Closing",
                align: "right",
                render: (st) => (
                  <span aria-label={`Closing ${cellMoney(st.closingBalance)}`}>
                    {cellMoney(st.closingBalance)}
                  </span>
                ),
              },
            ]}
            rows={filtered}
            sortable
          />
          {activeType === "R&P" ? (
            <p style={{ fontSize: 13, color: "var(--ink2)", margin: "8px 0 0" }}>
              Grand totals are not shown: the statements feed does not mark which heads are cash or bank, and a
              total across all account classes has no accounting meaning.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
