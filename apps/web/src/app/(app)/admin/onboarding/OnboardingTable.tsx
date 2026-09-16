"use client";
import { DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
type Row = Record<string, unknown>;
export function OnboardingTable({ queue, source = "api" }: { queue: Row[]; source?: "api" | "error" }) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Row[]>("sa.onboarding", queue, source, (d) => d.length === 0);
  return (
    <>
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `rows`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <DataTable<Row>
        columns={[
          { key: "org", label: "Organisation" },
          { key: "contact", label: "Contact" },
          { key: "requested", label: "Requested" },
          { key: "assigned", label: "Assigned To" },
          { key: "stage", label: "Stage", cellType: "status" },
        ]}
        rows={rows} sortable filterable filterPlaceholder="Search onboarding…" pageSize={15} exportable exportFilename="onboarding-queue" emptyIcon="📥" emptyTitle="No requests" emptyMessage="No tenant onboarding requests in queue."
      />
    </>
  );
}
