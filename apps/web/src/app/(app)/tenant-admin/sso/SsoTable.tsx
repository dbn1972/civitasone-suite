"use client";

import { DataTable, StatusPill } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
import type { SsoProvider } from "@/app/_data/loaders";

export function SsoTable({ providers, source }: { providers: SsoProvider[]; source: "api" | "error" }) {
  const { data } = useSeededResource("admin.sso.providers", providers, source, (d) => d.length === 0);

  return (
    <DataTable<SsoProvider & Record<string, unknown>>
      columns={[
        { key: "name", label: "Provider Name" },
        { key: "protocol", label: "Protocol" },
        { key: "entityId", label: "Entity ID", render: (row) => <span className="mono" style={{ fontSize: 12 }}>{row.entityId as string}</span> },
        { key: "status", label: "Status", render: (row) => <StatusPill status={row.status as string} /> },
        { key: "lastSync", label: "Last Sync", render: (row) => new Date(row.lastSync as string).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) },
      ]}
      rows={data as (SsoProvider & Record<string, unknown>)[]}
      sortable
      filterable
      filterPlaceholder="Search providers..."
      pageSize={15}
      exportable
      exportFilename="sso-providers"
    />
  );
}
