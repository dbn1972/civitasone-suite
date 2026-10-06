"use client";

import { DataTable, StatusPill } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { endpointOrigin, formatDateTimeIST } from "@/lib/formatters";
import type { IdpProviderSummary } from "@/app/_data/loaders";

export function IdpTable({ providers, source }: { providers: IdpProviderSummary[]; source: "api" | "error" }) {
  const { data, provenance, offline, cachedAt } = useSeededResource("admin.idp.providers", providers, source, (d) => d.length === 0);

  // GAP-TENANT-ADMIN-IDP-04: record a CSV export as an audit event (fire-and-
  // forget; never blocks the user's download). Endpoint identifiers would be
  // sensitive, so that column is excluded from the CSV (see csvExclude below).
  function recordExport(info: { rowCount: number; filter: string }) {
    void fetch("/api/proxy/v1/admin/idp/providers/export-audit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ rowCount: info.rowCount, filter: info.filter || null }),
    }).catch(() => {
      /* audit is best-effort; a failed beacon must not block the export */
    });
  }

  return (
    <>
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <DataTable<IdpProviderSummary & Record<string, unknown>>
      columns={[
        { key: "name", label: "Provider" },
        { key: "protocol", label: "Protocol" },
        { key: "status", label: "Status", render: (row) => <StatusPill status={row.status as string} /> },
        { key: "usersSynced", label: "Users Synced" },
        {
          key: "endpoint",
          label: "Endpoint",
          // GAP-TENANT-ADMIN-IDP-03: scheme+host only (no realm/bind/query);
          // GAP-TENANT-ADMIN-IDP-04: and never written to the CSV.
          render: (row) => <span className="mono" style={{ fontSize: 11 }}>{endpointOrigin(row.endpoint as string)}</span>,
          csvExclude: true,
        },
        {
          key: "lastSync",
          label: "Last Sync",
          // GAP-TENANT-ADMIN-IDP-03: IST-labelled, "—" for null/invalid.
          render: (row) => formatDateTimeIST(row.lastSync as string),
        },
      ]}
      rows={data as (IdpProviderSummary & Record<string, unknown>)[]}
      sortable
      filterable
      filterPlaceholder="Search providers..."
      pageSize={15}
      exportable
      exportFilename="idp-providers"
      onExport={recordExport}
      exportNotice="Export excludes endpoint URLs and is recorded in the audit log."
      />
    </>
  );
}
