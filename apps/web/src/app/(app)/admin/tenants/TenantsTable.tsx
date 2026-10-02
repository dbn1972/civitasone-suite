"use client";
import { Card, DataTable, StatGrid, StatCard, StatusPill } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { formatIndianDate } from "@/lib/formatters";
import { tenantStatusTone } from "@/lib/admin/serviceStatus";
import { summariseTenants } from "./tenantsModel";
type Row = Record<string, unknown>;
export function TenantsTable({ tenants, source = "api" }: { tenants: Row[]; source?: "api" | "error" }) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Row[]>("sa.tenants", tenants, source, (d) => d.length === 0);
  // GAP-ADMIN-TENANTS-05: a failed load with nothing cached must not read as "no tenants registered".
  const loadFailed = provenance === "error-no-data";
  const summary = summariseTenants(rows, loadFailed);
  return (
    <>
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `rows`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <StatGrid>
        <StatCard icon="🏢" iconBg="#eef2ff" label="Total Tenants" value={summary.total} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={summary.active} />
        <StatCard icon="🧪" iconBg="#fffaeb" label="Trial" value={summary.trial} />
        <StatCard icon="⛔" iconBg="#fce7ee" label="Suspended" value={summary.suspended} />
      </StatGrid>
      <Card title="Tenant Directory">
      <DataTable<Row>
        columns={[
          { key: "name", label: "Tenant Name" },
          { key: "edition", label: "Edition" },
          { key: "users", label: "Users", align: "right" },
          { key: "createdDate", label: "Created", render: (r) => (r.createdDate ? formatIndianDate(String(r.createdDate)) : "—") },
          { key: "status", label: "Status", render: (r) => (r.status == null || r.status === "" ? "—" : <StatusPill status={String(r.status)} variant={tenantStatusTone(r.status)} />) },
        ]}
        rows={rows} rowLinkKey="id" rowLinkPrefix="/admin/tenants/" sortable filterable filterPlaceholder="Search tenants…" pageSize={15} exportable exportFilename="tenants" emptyIcon="🏢"
        emptyTitle={loadFailed ? "Couldn't load tenants" : "No tenants"}
        emptyMessage={loadFailed ? "The tenant directory could not be loaded. Refresh the page to try again." : "No tenants registered."}
      />
      </Card>
    </>
  );
}
