"use client";

import { DataTable, StatusPill } from "../../../_components/ds";

export type RecentDocRow = {
  id: string;
  title: string;
  category: string;
  author: string;
  createdAt: string;
  statusLabel: string;
  statusPill: string;
} & Record<string, unknown>;

export function RecentDocsTable({ rows }: { rows: RecentDocRow[] }) {
  return (
    <DataTable<RecentDocRow>
      columns={[
        { key: "title", label: "Document" },
        { key: "category", label: "Type" },
        { key: "author", label: "Dept" },
        { key: "createdAt", label: "Date" },
        {
          key: "statusLabel",
          label: "Status",
          render: (row) => <StatusPill status={row.statusPill} label={row.statusLabel} />,
        },
      ]}
      rows={rows}
      sortable
      filterable
      pageSize={15}
    />
  );
}
