"use client";

import { DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import type { AdminTenantModuleUsage } from "@/app/_data/loaders";

const COLUMNS: { key: keyof AdminTenantModuleUsage & string; label: string; align?: "right"; cellType?: "status" }[] = [
  { key: "module", label: "Module" },
  { key: "enabled", label: "Enabled" },
  { key: "users", label: "Active Users", align: "right" },
  { key: "lastActivity", label: "Last Activity" },
  { key: "usage", label: "Usage Level", cellType: "status" },
];

export function TenantModulesTable({ modules, source = "api" }: { modules: AdminTenantModuleUsage[]; source?: "api" | "error" }) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<AdminTenantModuleUsage[]>(
    "admin.tenant.modules",
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
        columns={COLUMNS}
        rows={rows}
        sortable
        filterable
        filterPlaceholder="Search modules…"
        pageSize={15}
        exportable
        exportFilename="tenant-modules"
        emptyIcon="📦"
        emptyTitle="No modules"
        emptyMessage="No modules have been configured for this tenant."
      />
    </>
  );
}
