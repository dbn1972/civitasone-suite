"use client";

import { useState } from "react";
import { DataTable, EmptyState, Segmented, StatusPill } from "../../../_components/ds";
import type { DocRow } from "./page";

const SEG_OPTIONS = ["All", "Circulars", "Policies", "Notifications"];

/**
 * GAP-KNOWLEDGE-LIST-06: access level is shown as a pill, with a lock and the
 * level spelled out for restricted / confidential documents so the cue is not
 * colour-only. Display only - the service enforces access (clearance filter).
 */
function AccessCell({ level, label }: { level: string; label: string }) {
  const restricted = level === "restricted" || level === "confidential";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      {restricted && <span aria-hidden="true">🔒</span>}
      <StatusPill status={restricted ? "rejected" : level === "public" ? "active" : "info"} label={label} />
    </span>
  );
}

export function RepositoryClient({ rows, accessHeader }: { rows: DocRow[]; accessHeader: string }) {
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
            { key: "accessLabel", label: accessHeader, render: (row) => <AccessCell level={row.accessLevel} label={row.accessLabel} /> },
            {
              key: "statusLabel",
              label: "Status",
              render: (row) => <StatusPill status={row.statusPill} label={row.statusLabel} />,
            },
          ]}
          rows={filtered}
          rowLinkKey="fullId"
          rowLinkPrefix="/knowledge/documents/"
          sortable
          filterable
          pageSize={15}
        />
      )}
    </>
  );
}
