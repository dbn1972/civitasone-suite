"use client";

import { DataTable } from "@/app/_components/ds";
import { maskLast4 } from "@/app/_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { useSeededResource } from "@/lib/sync/resource";

export type DprRow = {
  dprNo: string;
  projectId?: string;
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
  csvExclude?: boolean;
  render?: (row: DprRow) => React.ReactNode;
}[] = [
  { key: "dprNo", label: "DPR No" },
  { key: "projectTitle", label: "Project Title" },
  // GAP-PROJECTS-DPR-TRACKING-03: submittedBy is an opaque user UUID
  // (project_dprs.submitted_by is a uuid, not a name). Showing it raw to every
  // module user — and writing it into the CSV export and the offline cache —
  // is both poor UX and a needless identifier leak. Mask it to the last 4
  // chars for display and exclude it from the CSV. (A real name + audited
  // reveal would need a backend lookup/endpoint — HUMAN REVIEW.)
  { key: "submittedBy", label: "Submitted By", csvExclude: true, render: (r) => maskLast4(String(r.submittedBy)) },
  { key: "submittedDate", label: "Submitted Date", render: (r) => formatIndianDate(r.submittedDate) },
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
        rowLinkPrefix="/projects/"
        rowLinkKey="projectId"
        identifyingColumnKey="projectTitle"
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
