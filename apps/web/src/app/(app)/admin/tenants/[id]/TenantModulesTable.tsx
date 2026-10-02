"use client";

import { DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import type { AdminTenantModuleUsage } from "@/app/_data/loaders";
import { usagePillClass } from "./tenantDetailView";

const COLUMNS: { key: keyof AdminTenantModuleUsage & string; label: string; align?: "right" }[] = [
  { key: "module", label: "Module" },
  { key: "enabled", label: "Enabled" },
  // GAP-ADMIN-TENANTS-DETAIL-04: per-module seat count (a person on 3 modules is 3 seats).
  { key: "users", label: "Seats in use", align: "right" },
  { key: "lastActivity", label: "Last Activity" },
  { key: "usage", label: "Usage Level" },
];

export function TenantModulesTable({ tenantId, modules, source = "api" }: { tenantId: string; modules: AdminTenantModuleUsage[]; source?: "api" | "error" }) {
  const columns = COLUMNS.map((c) =>
    c.key === "users"
      ? { ...c, render: (r: AdminTenantModuleUsage) => (r.users === null ? "—" : r.users) }
      : c.key === "usage"
        ? { ...c, render: (r: AdminTenantModuleUsage) => <span className={`pill ${usagePillClass(r.usage)}`}>{r.usage}</span> }
        : c,
  );
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<AdminTenantModuleUsage[]>(
    // GAP-ADMIN-TENANTS-DETAIL-06: per-tenant key -- a constant key let a cached
    // fallback show one tenant's modules on another tenant's page.
    `admin.tenant.modules:${tenantId}`,
    modules,
    source,
    (d) => d.length === 0,
  );

  return (
    <>
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `rows`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <DataTable<AdminTenantModuleUsage>
        columns={columns}
        rows={rows}
        sortable
        filterable
        filterPlaceholder="Search modules…"
        pageSize={15}
        exportable
        exportFilename="tenant-modules"
        emptyIcon="📦"
        emptyTitle="No modules"
        emptyMessage="No modules configured for this tenant."
      />
    </>
  );
}
