"use client";

import { DataTable, StatusPill } from "@/app/_components/ds";
import { formatIndianDate } from "@/lib/formatters";

export type RunRow = {
  id: string;
  provider: string;
  sourceSystem: string;
  targetSystem: string;
  status: string;
  sourceCount: number;
  targetCount: number;
  matchedCount: number;
  breakCount: number;
  balanced: boolean;
  startedAt: string;
  completedAt: string | null;
} & Record<string, unknown>;

type Row = RunRow & { balancedLabel: string; startedLabel: string };

export function RunsTable({ runs }: { runs: RunRow[] }) {
  const rows: Row[] = runs.map((r) => ({
    ...r,
    balancedLabel: r.balanced ? "Balanced" : "Unbalanced",
    startedLabel: formatIndianDate(r.startedAt),
  }));

  return (
    <DataTable<Row>
      columns={[
        { key: "provider", label: "Provider" },
        { key: "sourceSystem", label: "Source" },
        { key: "targetSystem", label: "Target" },
        { key: "startedLabel", label: "Started", sortable: false },
        { key: "sourceCount", label: "Source Count", align: "right" },
        { key: "targetCount", label: "Target Count", align: "right" },
        { key: "matchedCount", label: "Matched", align: "right" },
        { key: "breakCount", label: "Breaks", align: "right" },
        {
          key: "balancedLabel",
          label: "Balance",
          sortable: false,
          render: (row) => <StatusPill status={row.balanced ? "cleared" : "breached"} label={row.balancedLabel} />,
        },
        { key: "status", label: "Run Status", cellType: "status" },
      ]}
      rows={rows}
      rowLinkKey="id"
      rowLinkPrefix="/finance/reconciliation/"
      sortable
      filterable
      filterPlaceholder="Filter by provider or source…"
      pageSize={15}
      emptyIcon="🔁"
      emptyTitle="No reconciliation runs yet"
      emptyMessage="Reconciliation runs will appear here once the reconciliation engine has executed."
    />
  );
}
