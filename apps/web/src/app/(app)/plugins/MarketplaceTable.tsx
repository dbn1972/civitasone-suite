"use client";

/**
 * GAP-PLUGINS-MARKETPLACE-01 (theme MISSINGFEATURE): the Marketplace list is
 * "Discover and install plugins", but it previously offered no Install action
 * at all. This table mirrors PluginCatalogTable's columns and adds an
 * install-only action per row (MarketplaceInstallButton), gated by canManage
 * (PLUGIN_MARKETPLACE_ROLES). A row already installed shows "Installed" instead.
 *
 * GAP-PLUGINS-MARKETPLACE-03 / -05: plugin-specific columns + StatusPill, and
 * sort / filter / pagination like the Installed list.
 */

import { DataTable } from "../../_components/ds";
import { MarketplaceInstallButton } from "./PluginActions";
import type { PluginCatalogRow } from "./_data";

export function MarketplaceTable({
  rows,
  canManage = false,
}: {
  rows: PluginCatalogRow[];
  canManage?: boolean;
}) {
  const hasVersion = rows.some((r) => r.version);
  const hasPublisher = rows.some((r) => r.publisher);

  const columns: React.ComponentProps<typeof DataTable<PluginCatalogRow>>["columns"] = [
    { key: "name", label: "Name" },
  ];
  if (hasPublisher) columns.push({ key: "publisher", label: "Publisher" });
  if (hasVersion) columns.push({ key: "version", label: "Version" });
  columns.push({
    key: "id",
    label: "Action",
    sortable: false,
    align: "right",
    render: (row) => (
      <MarketplaceInstallButton
        listingId={row.id}
        name={row.name}
        installed={row.status ? ["installed", "enabled", "active"].includes(String(row.status).toLowerCase()) : false}
        canManage={canManage}
      />
    ),
  });

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
      emptyTitle="No plugins available"
      emptyMessage="There are no plugins available to install for your organisation yet."
    />
  );
}
