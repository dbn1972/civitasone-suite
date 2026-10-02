"use client";
import { DataTable, StatCard, StatGrid, Card, LoadErrorState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { formatMoney, humanizeStatus } from "@/lib/formatters";
import type { FinanceDebtSummary } from "@civitasone/types";
import { summariseDebt } from "./debtStats";

type Row = FinanceDebtSummary;

/** Translated strings, supplied by the server page (next-intl `financeDebt`). */
export type DebtLabels = {
  totalLoans: string;
  active: string;
  closed: string;
  totalPrincipal: string;
  mixedCurrency: string;
  portfolio: string;
  instrument: string;
  source: string;
  principal: string;
  maturity: string;
  status: string;
  search: string;
  emptyTitle: string;
  emptyMessage: string;
  loadArea: string;
  sources: Record<string, string>;
};

/** GAP-FINANCE-DEBT-04: "central_govt" -> "Central Govt"; unknown codes are humanised, never printed raw. */
export function debtSourceLabel(source: string | null | undefined, labels: Record<string, string>): string {
  const raw = (source ?? "").trim();
  if (!raw) return "—";
  return labels[raw.toLowerCase()] ?? humanizeStatus(raw);
}

export function DebtTable({
  loans,
  source = "api",
  errorStatus,
  errorMessage,
  labels,
}: {
  loans: Row[];
  source?: "api" | "error";
  errorStatus?: number;
  errorMessage?: string;
  labels: DebtLabels;
}) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Row[]>("finance.debt", loans, source, (d) => d.length === 0);
  // GAP-FINANCE-DEBT-03: stats are derived from the SAME rows the table shows,
  // and a failed load with nothing cached reads "—", never a believable 0.
  const unknown = provenance === "error-no-data";
  const stats = summariseDebt(rows);
  const dash = (v: string | number) => (unknown ? "—" : v);
  const tableRows = rows.map((r) => ({ ...r, sourceLabel: debtSourceLabel(r.source, labels.sources) }));

  return (
    <>
      <StatGrid>
        <StatCard icon="🏦" iconBg="var(--primary-soft)" label={labels.totalLoans} value={dash(stats.total)} />
        <StatCard icon="📈" iconBg="var(--infobg)" label={labels.active} value={dash(stats.active)} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label={labels.closed} value={dash(stats.closed)} />
        <StatCard icon="💰" iconBg="var(--line2)" label={labels.totalPrincipal} value={dash(stats.allInr ? formatMoney(stats.totalMinor) : "—")} />
      </StatGrid>
      {!unknown && !stats.allInr ? <p role="note" style={{ fontSize: 13, color: "var(--mut)", margin: "0 0 12px" }}>{labels.mixedCurrency}</p> : null}
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `rows` (UX-002's pattern). */}
      <Card title={labels.portfolio}>
        <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
        {unknown ? (
          <div className="pad"><LoadErrorState result={{ status: errorStatus, errorMessage }} area={labels.loadArea} backHref="/finance" backLabel="Finance" /></div>
        ) : (
          <DataTable<(typeof tableRows)[number]>
            columns={[
              { key: "instrument", label: labels.instrument },
              { key: "sourceLabel", label: labels.source },
              { key: "amountMinor", label: labels.principal, align: "right", cellType: "amount" },
              { key: "maturity", label: labels.maturity, cellType: "date" },
              { key: "status", label: labels.status, cellType: "status" },
            ]}
            rows={tableRows}
            sortable
            filterable
            filterPlaceholder={labels.search}
            pageSize={15}
            exportable
            exportFilename="debt-portfolio"
            emptyIcon="🏦"
            emptyTitle={labels.emptyTitle}
            emptyMessage={labels.emptyMessage}
          />
        )}
      </Card>
    </>
  );
}
