"use client";

/**
 * GAP-GRANTS-DASHBOARD-03: the dashboard grants table used to be a bare
 * server-rendered DataTable, so — unlike every sibling grants list — it had no
 * offline/cached fallback and no provenance badge. This mirrors
 * list/GrantsTable.tsx exactly (same useSeededResource key "grants.list" so the
 * two share one cache, same DataSourceBadge), just with the dashboard's own
 * column set and page size.
 */
import { DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import type { GrantSummary } from "@civitasone/types";
import { useSeededResource } from "@/lib/sync/resource";

type Col = {
  key: keyof GrantSummary & string;
  label: string;
  align?: "left" | "right";
  cellType?: "status" | "amount";
};

const columns: Col[] = [
  { key: "grantNo", label: "Grant No" },
  { key: "title", label: "Title" },
  { key: "granteeName", label: "Grantee" },
  { key: "totalAmount", label: "Total Amount", align: "right", cellType: "amount" },
  { key: "disbursedAmount", label: "Disbursed", align: "right", cellType: "amount" },
  { key: "status", label: "Status", cellType: "status" },
];

export function DashboardGrantsTable({ grants, source = "api" }: { grants: GrantSummary[]; source?: "api" | "error" }) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<GrantSummary[]>(
    "grants.list",
    grants,
    source,
    (d) => d.length === 0,
  );

  return (
    <>
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <DataTable<GrantSummary>
        columns={columns}
        rows={rows}
        rowLinkPrefix="/grants/"
        rowLinkKey="id"
        sortable
        filterable
        filterPlaceholder="Filter grants…"
        pageSize={10}
      />
    </>
  );
}
