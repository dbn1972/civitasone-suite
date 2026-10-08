"use client";

import type React from "react";
import { DataTable, StatusPill } from "@/app/_components/ds";
import { maskLast4 } from "@/app/_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { useSeededResource } from "@/lib/sync/resource";
import { DprActions } from "./DprActions";

export type DprRow = {
  // GAP-PROJECTS-DPR-TRACKING-01: the DPR id, emitted server-side, is the path
  // segment for the review-transition route.
  id?: string;
  dprNo: string;
  projectId?: string;
  projectTitle: string;
  submittedBy: string;
  submittedDate: string;
  estimatedCost: string;
  status: string;
  reviewingAuthority: string;
} & Record<string, unknown>;

// GAP-PROJECTS-DPR-TRACKING-01: the DPR status machine is submitted →
// under_review → approved | revision. The global StatusPill maps 'approved'
// (good), 'under review'/'submitted' (warn) and 'rejected' (bad), but has NO
// key for 'revision' (the real "returned to submitter" state — it would fall
// through to the neutral info blue). Scope the tones here so a returned DPR
// reads as attention-needing (warn) and carries the word "Returned for
// revision" consistently with the tile, without recolouring 'revision'
// app-wide. Keyed on the normalized backend values.
const DPR_STATUS_VARIANT: Record<string, "good" | "warn" | "bad" | "mut" | "info"> = {
  submitted: "warn",
  under_review: "warn",
  approved: "good",
  revision: "warn",
};
const DPR_STATUS_LABEL: Record<string, string> = {
  under_review: "Under review",
  revision: "Returned for revision",
};

const COLUMNS: {
  key: keyof DprRow & string;
  label: string;
  cellType?: "status" | "amount";
  csvExclude?: boolean;
  sortable?: boolean;
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
  // GAP-PROJECTS-DPR-TRACKING-01: render the status with a DPR-scoped tone +
  // label so 'revision' reads "Returned for revision" (warn), not the neutral
  // info fallback, and the word matches the tile.
  {
    key: "status",
    label: "Status",
    render: (r) => (
      <StatusPill
        status={r.status}
        label={DPR_STATUS_LABEL[r.status.toLowerCase().replace(/\s+/g, "_")]}
        variant={DPR_STATUS_VARIANT[r.status.toLowerCase().replace(/\s+/g, "_")]}
      />
    ),
  },
  { key: "reviewingAuthority", label: "Reviewing Authority" },
];

export function DprTrackingTable({ rows, source = "api", canReview = false }: { rows: DprRow[]; source?: "api" | "error"; canReview?: boolean }) {
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

  // GAP-PROJECTS-DPR-TRACKING-01: the Actions column (Start review / Approve /
  // Return for revision) only exists for a user whose role the server would
  // accept, and only on a DPR that still has a reachable transition and a
  // server-emitted id. Non-reviewers see no action controls (defence-in-depth;
  // the server still 403s).
  const columns = canReview
    ? [
        ...COLUMNS,
        {
          key: "id" as keyof DprRow & string,
          label: "Actions",
          sortable: false,
          render: (r: DprRow) => {
            if (!r.id || !r.projectId) return null;
            return (
              <DprActions
                projectId={r.projectId}
                dprId={r.id}
                dprNo={r.dprNo}
                status={String(r.status).toLowerCase().replace(/\s+/g, "_")}
              />
            );
          },
        },
      ]
    : COLUMNS;

  return (
    <>
      {cacheNote && <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>{cacheNote}</p>}
      <DataTable<DprRow>
        columns={columns}
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
