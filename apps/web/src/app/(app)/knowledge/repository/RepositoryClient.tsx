"use client";

import { useState } from "react";
import { DataTable, EmptyState, Segmented, StatusPill } from "../../../_components/ds";
import type { DocRow } from "./page";

const SEG_OPTIONS = ["All", "Circulars", "Policies", "Notifications"];

export function RepositoryClient({ rows }: { rows: DocRow[] }) {
  const [seg, setSeg] = useState("All");

  // GAP-KNOWLEDGE-REPOSITORY-07: match on canonical segment, not substring
  const filtered = seg === "All" ? rows : rows.filter((r) => r.segment === seg);

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
            { key: "title", label: "Title" },
            { key: "category", label: "Type" },
            { key: "author", label: "Author" },
            { key: "version", label: "Version" },
            {
              key: "statusLabel",
              label: "Status",
              render: (row) => <StatusPill status={row.statusPill} label={row.statusLabel} />,
            },
          ]}
          rows={filtered}
          rowLinkKey="fullId"
          rowLinkPrefix="/knowledge/policies/"
          sortable
          filterable
          pageSize={15}
        />
      )}
    </>
  );
}
