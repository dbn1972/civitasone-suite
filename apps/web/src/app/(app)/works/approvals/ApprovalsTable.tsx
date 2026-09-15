"use client";

import { useState } from "react";
import { DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";

const columns = [
  { key: "workNumber", label: "Work Number", sortable: true },
  { key: "approvalNumber", label: "Approval Number", sortable: true },
  { key: "date", label: "Date", sortable: true },
  { key: "authority", label: "Authority", sortable: true },
  { key: "amount", label: "Amount", align: "right" as const, cellType: "amount" as const, sortable: true },
  { key: "type", label: "Type", sortable: true },
  { key: "status", label: "Status", cellType: "status" as const, sortable: true },
];

type Tab = "aa" | "ts";

export function ApprovalsTable({
  aaApprovals,
  tsApprovals,
  source,
}: {
  aaApprovals: Record<string, unknown>[];
  tsApprovals: Record<string, unknown>[];
  source: "api" | "error";
}) {
  const [tab, setTab] = useState<Tab>("aa");
  const {
    data: aaData,
    provenance: aaProvenance,
    offline: aaOffline,
    cachedAt: aaCachedAt,
  } = useSeededResource("works-approvals-aa", aaApprovals, source, (rows) => rows.length === 0);
  const {
    data: tsData,
    provenance: tsProvenance,
    offline: tsOffline,
    cachedAt: tsCachedAt,
  } = useSeededResource("works-approvals-ts", tsApprovals, source, (rows) => rows.length === 0);
  const rows = tab === "aa" ? aaData : tsData;
  // UX-012: each register has its own independent cache entry, so the two
  // useSeededResource calls can genuinely disagree with each other (e.g. AA
  // has a usable cache while TS does not) even though the page fed both the
  // same upstream `source`. The badge must therefore reflect whichever
  // register's rows are actually on screen right now, not an aggregate.
  const provenance = tab === "aa" ? aaProvenance : tsProvenance;
  const offline = tab === "aa" ? aaOffline : tsOffline;
  const cachedAt = tab === "aa" ? aaCachedAt : tsCachedAt;
  const rowHref =
    tab === "aa"
      ? (row: Record<string, unknown>) => "/works/approvals/aa/" + String(row.id ?? "")
      : (row: Record<string, unknown>) => "/works/approvals/ts/" + String(row.id ?? "");

  return (
    <div>
      <div className="flex gap-2 mb-4" role="tablist" aria-label="Approval type">
        <button
          role="tab"
          aria-selected={tab === "aa"}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === "aa" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
          onClick={() => setTab("aa")}
        >
          AA Register
        </button>
        <button
          role="tab"
          aria-selected={tab === "ts"}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === "ts" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
          onClick={() => setTab("ts")}
        >
          TS Register
        </button>
      </div>
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads from the same useSeededResource
          call (for the active tab) that produces `rows`, so it can never
          disagree with what the table shows (UX-002's pattern; the page
          used to render a second, independent badge from the raw `source`
          prop — removed). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <DataTable
        columns={columns}
        rows={rows}
        sortable
        filterable
        filterPlaceholder="Search approvals..."
        pageSize={15}
        exportable
        exportFilename={`works-approvals-${tab}`}
        rowHref={rowHref}
        emptyIcon="✅"
        emptyTitle="No approvals found"
        emptyMessage={`${tab === "aa" ? "Administrative Approval" : "Technical Sanction"} records will appear here.`}
      />
    </div>
  );
}
