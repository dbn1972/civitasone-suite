"use client";

import { DataTable, EmptyState, RagPill, RefreshErrorState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { toHumanError } from "@/lib/messages";

export type ProjectRow = {
  id: string; projectCode: string; name: string; scheme: string; department: string;
  totalBudget: number;
  // GAP-PROJECTS-LIST-03: numeric so the column sorts numerically; formatted
  // in a render below (not pre-formatted to a "12.5%" string upstream).
  completionPct: number;
  status: string;
  // GAP-PROJECTS-LIST-05: the per-row RAG health signal, shown as its own
  // coloured column (previously fetched only for the tiles, never displayed).
  rag: string | null;
};

const COLUMNS: {
  key: keyof ProjectRow & string;
  label: string;
  align?: "left" | "right";
  cellType?: "status" | "amount";
  render?: (row: ProjectRow) => React.ReactNode;
}[] = [
  { key: "projectCode", label: "Project Code" },
  { key: "name", label: "Name" },
  { key: "scheme", label: "Scheme" },
  { key: "department", label: "Agency / Dept" },
  { key: "totalBudget", label: "Cost (Budget)", align: "right", cellType: "amount" },
  { key: "completionPct", label: "Completion %", align: "right", render: (r) => `${r.completionPct.toFixed(1)}%` },
  { key: "status", label: "Status", cellType: "status" },
  { key: "rag", label: "RAG", render: (r) => <RagPill rag={r.rag} /> },
];

export function ProjectsTable({ rows, source = "api" }: { rows: ProjectRow[]; source?: "api" | "error" }) {
  const { data, provenance, offline, cachedAt } = useSeededResource<ProjectRow[]>(
    "projects.list",
    rows,
    source,
    (d) => d.length === 0,
  );

  // GAP-PROJECTS-LIST-01: a failed fetch with no cached fallback must read as
  // an ERROR (with a retry), not the cheerful "No projects yet" empty prompt
  // that made an outage look like a brand-new tenant. The cached path
  // (provenance 'cached') still shows the table + a saved-data badge.
  if (provenance === "error-no-data") {
    return (
      <div className="pad">
        <RefreshErrorState error={toHumanError("load", { area: "projects" })} backHref="/projects" />
      </div>
    );
  }

  return (
    <>
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      {data.length === 0 ? (
        <EmptyState
          icon="📁"
          title="No projects yet"
          message="Projects will appear here once schemes are sanctioned and projects created."
        />
      ) : (
        <DataTable<ProjectRow>
          columns={COLUMNS}
          rows={data}
          rowLinkPrefix="/projects/"
          rowLinkKey="id"
          identifyingColumnKey="name"
          sortable
          filterable
          filterPlaceholder="Filter projects…"
          pageSize={15}
        />
      )}
    </>
  );
}
