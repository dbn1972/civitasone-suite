"use client";

import { DataTable, EmptyState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";

export type ProjectRow = {
  id: string; projectCode: string; name: string; scheme: string; department: string;
  totalBudget: number; completionPct: string; status: string;
};

const COLUMNS: { key: keyof ProjectRow & string; label: string; align?: "left" | "right"; cellType?: "status" | "amount" }[] = [
  { key: "projectCode", label: "Project Code" },
  { key: "name", label: "Name" },
  { key: "scheme", label: "Scheme" },
  { key: "department", label: "Agency / Dept" },
  { key: "totalBudget", label: "Cost (Budget)", align: "right", cellType: "amount" },
  { key: "completionPct", label: "Completion %", align: "right" },
  { key: "status", label: "Status", cellType: "status" },
];

export function ProjectsTable({ rows, source = "api" }: { rows: ProjectRow[]; source?: "api" | "error" }) {
  const { data, provenance, offline, cachedAt } = useSeededResource<ProjectRow[]>(
    "projects.list",
    rows,
    source,
    (d) => d.length === 0,
  );

  return (
    <>
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `data`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      {data.length === 0 ? (
        <EmptyState
          icon="📁"
          title="No projects yet"
          message="Projects will appear here once schemes are sanctioned and projects created."
        />
      ) : (
        <DataTable<ProjectRow> columns={COLUMNS} rows={data} rowLinkPrefix="/projects/" rowLinkKey="id" identifyingColumnKey="name" />
      )}
    </>
  );
}
