"use client";

import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";

export type DprRow = {
  dprNo: string;
  projectTitle: string;
  submittedBy: string;
  submittedDate: string;
  estimatedCost: string;
  status: string;
  reviewingAuthority: string;
} & Record<string, unknown>;

const COLUMNS: {
  key: keyof DprRow & string;
  label: string;
  cellType?: "status" | "amount";
}[] = [
  { key: "dprNo", label: "DPR No" },
  { key: "projectTitle", label: "Project Title" },
  { key: "submittedBy", label: "Submitted By" },
  { key: "submittedDate", label: "Submitted Date" },
  { key: "estimatedCost", label: "Estimated Cost (₹ Cr)" },
  { key: "status", label: "Status", cellType: "status" },
  { key: "reviewingAuthority", label: "Reviewing Authority" },
];

export function DprTrackingTable({ rows, source = "api" }: { rows: DprRow[]; source?: "api" | "error" }) {
  const { data, fromCache, offline, cachedAt } = useSeededResource<DprRow[]>(
    "projects.dprs",
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
      {cacheNote && <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>{cacheNote}</p>}
      <DataTable<DprRow>
        columns={COLUMNS}
        rows={data}
        sortable
        filterable
        filterPlaceholder="Filter DPRs…"
        pageSize={15}
        exportable
        exportFilename="project-dprs"
        emptyIcon="📄"
        emptyTitle="No DPRs"
        emptyMessage="No DPRs match the current filter."
      />
    </>
  );
}
