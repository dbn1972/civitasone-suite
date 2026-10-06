"use client";

/**
 * GAP-PLUGINS-HOOKS-02 / MARKETPLACE-03 / REGISTRY-02 (theme UUID) and
 * GAP-PLUGINS-HOOKS-04 / MARKETPLACE-05 / REGISTRY-04 (theme CAP):
 *
 * A plugin-specific catalogue table that replaces the generic
 * ID/Name/Detail/Status/Meta ModuleListTable for the Registry and Marketplace
 * lists. It drops the truncated-UUID column (id is only a row key), renders the
 * status through StatusPill (humanised, unknown values kept as-is), formats the
 * Updated date, and uses DataTable's sort / filter / pagination so a long
 * catalogue is navigable like the Installed list is. Version / Publisher
 * columns are only shown when at least one row carries them, so a service that
 * does not send those fields shows no empty columns rather than fabricated
 * placeholders.
 */

import { DataTable } from "../../_components/ds";
import type { PluginCatalogRow } from "./_data";

export function PluginCatalogTable({
  rows,
  emptyMessage,
}: {
  rows: PluginCatalogRow[];
  emptyMessage?: string;
}) {
  const hasVersion = rows.some((r) => r.version);
  const hasPublisher = rows.some((r) => r.publisher);
  const hasUpdated = rows.some((r) => r.updatedAt);

  const columns: React.ComponentProps<typeof DataTable<PluginCatalogRow>>["columns"] = [
    { key: "name", label: "Name" },
    { key: "status", label: "Status", cellType: "status" },
  ];
  if (hasVersion) columns.push({ key: "version", label: "Version" });
  if (hasPublisher) columns.push({ key: "publisher", label: "Publisher" });
  if (hasUpdated) columns.push({ key: "updatedAt", label: "Updated", cellType: "date" });

  return (
    <DataTable<PluginCatalogRow>
      sortable
      filterable
      filterPlaceholder="Filter plugins…"
      filterKeys={["name", "publisher"]}
      pageSize={15}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      emptyIcon="🧩"
      emptyTitle="No plugins"
      emptyMessage={emptyMessage ?? "There are no plugins to show here yet."}
    />
  );
}
