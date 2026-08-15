"use client";

import Link from "next/link";
import { DataTable, StatusPill } from "../../../_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
import type { CrmServiceRequestRow } from "../../../_data/loaders";

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
 * Service request queue table.
 *
 * Previously a raw `<table>` that rendered the subject in both the Citizen and
 * Subject columns, had a permanently empty "Logged" column, and showed no
 * priority at all despite the API returning one.
 */
export function ServiceRequestsTable({
  requests,
  source = "api",
}: {
  requests: CrmServiceRequestRow[];
  source?: "api" | "error";
}) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<CrmServiceRequestRow[]>(
    "crm.service-requests",
    requests,
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
      <DataTable<CrmServiceRequestRow>
        columns={[
          {
            key: "referenceNo",
            label: "Ref No.",
            render: (r) => (
              <code style={{ fontSize: 12, color: "var(--ink2)" }}>{r.referenceNo ?? "—"}</code>
            ),
          },
          { key: "citizenName", label: "Citizen", render: (r) => r.citizenName ?? "—" },
          { key: "serviceType", label: "Service Type", render: (r) => r.serviceType ?? "—" },
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
              <Link href={`/crm/service-requests/${r.id}`} className="btn" style={{ fontSize: 13 }}>
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
        exportFilename="service-requests"
        emptyIcon="📭"
        emptyTitle="No service requests yet"
        emptyMessage="Service requests submitted by citizens will appear here."
      />
    </>
  );
}
