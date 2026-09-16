"use client";

import { DataTable, StatusPill } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import type { IdpProviderSummary } from "@/app/_data/loaders";

export function IdpTable({ providers, source }: { providers: IdpProviderSummary[]; source: "api" | "error" }) {
  const { data, provenance, offline, cachedAt } = useSeededResource("admin.idp.providers", providers, source, (d) => d.length === 0);

  return (
    <>
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `data`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <DataTable<IdpProviderSummary & Record<string, unknown>>
      columns={[
        { key: "name", label: "Provider" },
        { key: "protocol", label: "Protocol" },
        { key: "status", label: "Status", render: (row) => <StatusPill status={row.status as string} /> },
        { key: "usersSynced", label: "Users Synced" },
        { key: "endpoint", label: "Endpoint", render: (row) => <span className="mono" style={{ fontSize: 11 }}>{row.endpoint as string}</span> },
        { key: "lastSync", label: "Last Sync", render: (row) => new Date(row.lastSync as string).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) },
      ]}
      rows={data as (IdpProviderSummary & Record<string, unknown>)[]}
      sortable
      filterable
      filterPlaceholder="Search providers..."
      pageSize={15}
      exportable
      exportFilename="idp-providers"
      />
    </>
  );
}
