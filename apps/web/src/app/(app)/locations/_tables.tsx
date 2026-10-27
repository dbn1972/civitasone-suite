"use client";

/**
 * GAP2-LOCATIONS-INFRASTRUCTURE-01 — typed tables for the location child pages.
 *
 * The three child pages previously used the generic ModuleListPage, which
 * flattened every record to ID/Name/Detail/Status/Meta and rendered
 * a truncated id as a raw-UUID column — dropping the attributes that define
 * each record. These typed tables render the real defining attributes and NO
 * raw-UUID column:
 *   • InfrastructureTable: Name / Type / Condition / Status
 *   • GeofencesTable:      Name / Type / Shape / Radius / Status
 *   • JurisdictionsTable:  Level / Office / Unit / Primary
 *
 * Client components (hence `render:`/cellType is allowed per
 * datatable-render-guard) so the Server pages fetch typed rows and pass them in.
 */
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Card, DataTable, EmptyState } from "../../_components/ds";
import type { InfrastructureRow, GeofenceRow, JurisdictionRow } from "./_data";
import { GeofenceToggle } from "./geofences/GeofenceActions";

type InfraRow = InfrastructureRow & Record<string, unknown>;
type GeoRow = GeofenceRow & Record<string, unknown>;
type JurisRow = JurisdictionRow & Record<string, unknown>;

export function InfrastructureTable({ rows }: { rows: InfrastructureRow[] }) {
  const t = useTranslations("locationsOps.infra");
  return (
    <Card title={t("cardTitle")}>
      {rows.length === 0 ? (
        <EmptyState icon="🏗️" title={t("emptyTitle")} message={t("emptyMessage")} />
      ) : (
        <DataTable<InfraRow>
          columns={[
            {
              key: "name",
              label: t("colName"),
              // GAP-LOCATIONS-INFRASTRUCTURE-06: link to the asset-register record when one is recorded.
              render: (row: InfraRow) => (row.assetId ? <Link href={`/assets/${encodeURIComponent(row.assetId)}`}>{row.name}</Link> : row.name),
            },
            { key: "type", label: t("colType") },
            { key: "condition", label: t("colCondition"), align: "right" },
            { key: "status", label: t("colStatus"), cellType: "status" },
          ]}
          rows={rows as InfraRow[]}
          sortable
          filterable
          filterPlaceholder={t("filterPlaceholder")}
          pageSize={15}
        />
      )}
    </Card>
  );
}

export function GeofencesTable({ rows, canManage = false }: { rows: GeofenceRow[]; canManage?: boolean }) {
  const t = useTranslations("locationsOps.geofences");
  return (
    <Card title={t("cardTitle")}>
      {rows.length === 0 ? (
        <EmptyState icon="🗺️" title={t("emptyTitle")} message={t("emptyMessage")} />
      ) : (
        <DataTable<GeoRow>
          columns={[
            { key: "name", label: t("colName") },
            { key: "type", label: t("colType") },
            { key: "shape", label: t("colShape") },
            { key: "radius", label: t("colRadius"), align: "right" },
            { key: "center", label: t("colCenter"), align: "right" },
            { key: "status", label: t("colStatus"), cellType: "status" },
            ...(canManage
              ? [{ key: "actions", label: "", render: (row: GeoRow) => <GeofenceToggle id={row.id} name={row.name} active={row.status === "active"} /> }]
              : []),
          ]}
          rows={rows as GeoRow[]}
          sortable
          filterable
          filterPlaceholder={t("filterPlaceholder")}
          pageSize={15}
        />
      )}
    </Card>
  );
}

export function JurisdictionsTable({ rows }: { rows: JurisdictionRow[] }) {
  const t = useTranslations("locationsOps.jurisdictions");
  return (
    <Card title={t("cardTitle")}>
      {rows.length === 0 ? (
        <EmptyState icon="🏛️" title={t("emptyTitle")} message={t("emptyMessage")} />
      ) : (
        <DataTable<JurisRow>
          columns={[
            { key: "level", label: t("colLevel") },
            { key: "office", label: t("colOffice"), render: (row: JurisRow) => row.office || t("unresolved") },
            { key: "unit", label: t("colUnit"), render: (row: JurisRow) => row.unit || t("unresolved") },
            { key: "primary", label: t("colPrimary"), render: (row: JurisRow) => (row.primary ? t("yes") : t("no")) },
          ]}
          rows={rows as JurisRow[]}
          sortable
          filterable
          filterPlaceholder={t("filterPlaceholder")}
          pageSize={15}
        />
      )}
    </Card>
  );
}
