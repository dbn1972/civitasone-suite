"use client";
import { DataTable, StatusPill } from "../../../_components/ds";
import { BAND_LABEL, type NamedAccountHealthEntry } from "./health";

type WatchlistRow = {
  accountId: string;
  accountName: string;
  score: number;
  band: string;
  computedAt: string;
};

function formatDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function WatchlistTable({ entries }: { entries: NamedAccountHealthEntry[] }) {
  const rows: WatchlistRow[] = entries.map((entry) => ({
    accountId: entry.accountId,
    accountName: entry.accountName,
    score: entry.score,
    band: entry.band,
    computedAt: entry.computedAt,
  }));

  return (
    <DataTable<WatchlistRow>
      columns={[
        { key: "accountName", label: "Account" },
        {
          key: "band",
          label: "Band",
          render: (row) => <StatusPill status={BAND_LABEL[row.band as keyof typeof BAND_LABEL] ?? row.band} />,
        },
        { key: "score", label: "Health Score", align: "right", render: (row) => `${row.score}/100` },
        { key: "computedAt", label: "Last Scored", render: (row) => formatDate(row.computedAt) },
      ]}
      rows={rows}
      rowHref={(row) => `/crm/health/${row.accountId}`}
      sortable
      filterable
      filterPlaceholder="Filter by account…"
      exportable
      exportFilename="account-health-watchlist"
      emptyIcon="💚"
      emptyTitle="No accounts at risk"
      emptyMessage="Every scored account is currently healthy or thriving. Accounts appear here once their health score falls to 50 or below."
    />
  );
}
