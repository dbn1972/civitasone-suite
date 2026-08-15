"use client";

import Link from "next/link";
import { DataTable, StatusPill } from "../../../_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
import type { CrmGrievanceRow } from "../../../_data/loaders";

const PRIORITY_TONE: Record<string, string> = {
  urgent: "var(--bad)",
  high: "var(--warn)",
  normal: "var(--ink2)",
  low: "var(--ink2)",
};

function titleCase(v: string): string {
  return v.charAt(0).toUpperCase() + v.slice(1);
}

/**
 * Grievance register table.
 *
 * Replaces a hand-rolled `<table>` so the register gains sorting, filtering,
 * pagination and CSV export — a grievance queue is worked by reference number
 * and by age, neither of which was reachable before.
 */
export function GrievancesTable({
  grievances,
  source = "api",
}: {
  grievances: CrmGrievanceRow[];
  source?: "api" | "error";
}) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<CrmGrievanceRow[]>(
    "crm.grievances",
    grievances,
    source,
    (d) => d.length === 0,
  );

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <>
      {cacheNote && (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>
          {cacheNote}
        </p>
      )}
      <DataTable<CrmGrievanceRow>
        columns={[
          {
            key: "referenceNo",
            label: "Ref No.",
            render: (r) => (
              <code style={{ fontSize: 12, color: "var(--ink2)" }}>{r.referenceNo ?? "—"}</code>
            ),
          },
          { key: "citizenName", label: "Citizen", render: (r) => r.citizenName ?? "—" },
          { key: "category", label: "Category", render: (r) => r.category ?? "—" },
          { key: "subject", label: "Subject", render: (r) => r.subject ?? "—" },
          {
            key: "priority",
            label: "Priority",
            render: (r) => (
              <span
                style={{
                  display: "inline-block",
                  padding: "2px 8px",
                  borderRadius: 4,
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--bg)",
                  background: PRIORITY_TONE[r.priority] ?? "var(--ink2)",
                }}
              >
                {titleCase(r.priority)}
              </span>
            ),
          },
          { key: "status", label: "Status", render: (r) => <StatusPill status={r.status} /> },
          {
            key: "createdAt",
            label: "Logged",
            render: (r) => (
              <span style={{ color: "var(--ink2)", fontSize: 13 }}>
                {r.createdAt ? new Date(r.createdAt).toLocaleDateString("en-IN") : "—"}
              </span>
            ),
          },
          {
            key: "id",
            label: "",
            render: (r) => (
              <Link href={`/crm/grievances/${r.id}`} className="btn" style={{ fontSize: 13 }}>
                View
              </Link>
            ),
          },
        ]}
        rows={rows}
        sortable
        filterable
        filterPlaceholder="Search reference, citizen, subject…"
        pageSize={15}
        exportable
        exportFilename="grievances"
        emptyIcon="📭"
        emptyTitle="No grievances yet"
        emptyMessage="Use the button above to log the first citizen grievance."
      />
    </>
  );
}
