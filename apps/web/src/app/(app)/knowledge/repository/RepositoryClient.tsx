"use client";

import { useState } from "react";
import { DataTable, EmptyState, Segmented, StatusPill } from "../../../_components/ds";

type DocRow = {
  id: string;
  title: string;
  category: string;
  author: string;
  version: string;
  statusLabel: string;
  statusPill: string;
  rawCategory: string;
};

const SEG_OPTIONS = ["All", "Circulars", "Policies", "Notifications"];

export function RepositoryClient({ rows }: { rows: DocRow[] }) {
  const [seg, setSeg] = useState("All");

  const filtered = seg === "All"
    ? rows
    : rows.filter((r) => r.rawCategory.toLowerCase().includes(seg.toLowerCase()));

  return (
    <>
      <div className="card-h" style={{ paddingTop: 0 }}>
        <Segmented
          options={SEG_OPTIONS}
          value={seg}
          onChange={setSeg}
        />
      </div>
      {filtered.length === 0 ? (
        <EmptyState icon="📂" title="No documents found" message="No documents found in the repository." />
      ) : (
        <DataTable<DocRow>
          columns={[
            { key: "id", label: "Doc ID" },
            { key: "title", label: "Title" },
            { key: "category", label: "Type" },
            { key: "author", label: "Dept" },
            { key: "version", label: "Version" },
            {
              key: "statusLabel",
              label: "Status",
              render: (row) => <StatusPill status={row.statusPill} label={row.statusLabel} />,
            },
          ]}
          rows={filtered}
          sortable
          filterable
          pageSize={15}
        />
      )}
    </>
  );
}
