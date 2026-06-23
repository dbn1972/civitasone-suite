"use client";

import { DataTable } from "@/app/_components/ds";
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
  const { data, fromCache, offline, cachedAt } = useSeededResource<ProjectRow[]>(
    "projects.list",
    rows,
    source,
    (d) => d.length === 0,
  );

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <>
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>
          {cacheNote}
        </p>
      ) : null}
      <DataTable<ProjectRow> columns={COLUMNS} rows={data} rowLinkPrefix="/projects/" rowLinkKey="id" />
    </>
  );
}
