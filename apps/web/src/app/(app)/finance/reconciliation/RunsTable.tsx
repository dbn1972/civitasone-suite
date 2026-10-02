"use client";

import { useState } from "react";
import { DataTable, Segmented, StatusPill } from "@/app/_components/ds";
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

const ALL_RUNS = "All runs";
const UNBALANCED_ONLY = "Unbalanced only";

export function RunsTable({ runs }: { runs: RunRow[] }) {
  // GAP-FINANCE-RECONCILIATION-07: a clean run is noise when triaging.
  const [view, setView] = useState<string>(ALL_RUNS);
  const visibleRuns = view === UNBALANCED_ONLY ? runs.filter((r) => !r.balanced) : runs;
  const rows: Row[] = visibleRuns.map((r) => ({
    ...r,
    balancedLabel: r.balanced ? "Balanced" : "Unbalanced",
    startedLabel: formatIndianDate(r.startedAt),
  }));

  return (
    <>
    <div style={{ marginBottom: 12 }}>
      <Segmented options={[ALL_RUNS, UNBALANCED_ONLY]} value={view} onChange={setView} />
    </div>
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
      emptyTitle={view === UNBALANCED_ONLY ? "No unbalanced runs" : "No reconciliation runs yet"}
      emptyMessage={
        view === UNBALANCED_ONLY
          ? "Every run is balanced."
          : "Reconciliation runs will appear here once the reconciliation engine has executed."
      }
    />
    </>
  );
}
