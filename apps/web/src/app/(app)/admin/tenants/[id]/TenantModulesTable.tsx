"use client";

import { DataTable } from "@/app/_components/ds";
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
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<AdminTenantModuleUsage[]>(
    "admin.tenant.modules",
    modules,
    source,
    (d) => d.length === 0,
  );

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <>
      {cacheNote && <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>{cacheNote}</p>}
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
