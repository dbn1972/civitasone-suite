"use client";

import { DataTable, StatusPill } from "../../../_components/ds";

export type DocRow = {
  id: string;
  title: string;
  category: string;
  author: string;
  version: string;
  accessLevel: string;
  statusLabel: string;
  statusPill: string;
} & Record<string, unknown>;

export function KnowledgeDocsTable({ rows }: { rows: DocRow[] }) {
  return (
    <DataTable<DocRow>
      columns={[
        { key: "id", label: "Doc ID" },
        { key: "title", label: "Title" },
        { key: "category", label: "Category" },
        { key: "author", label: "Author" },
        { key: "version", label: "Version" },
        { key: "accessLevel", label: "Access" },
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
