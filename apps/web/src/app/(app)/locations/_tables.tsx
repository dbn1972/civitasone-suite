"use client";

/**
 * GAP2-LOCATIONS-INFRASTRUCTURE-01 — typed tables for the location child pages.
 *
 * The three child pages previously used the generic ModuleListPage, which
 * flattened every record to ID/Name/Detail/Status/Meta and rendered
 * row.id.slice(0,8) as a raw-UUID column — dropping the attributes that define
 * each record. These typed tables render the real defining attributes and NO
 * raw-UUID column:
 *   • InfrastructureTable: Name / Type / Condition / Status
 *   • GeofencesTable:      Name / Type / Shape / Radius / Status
 *   • JurisdictionsTable:  Level / Office / Unit
 *
 * Client components (hence `render:`/cellType is allowed per
 * datatable-render-guard) so the Server pages fetch typed rows and pass them in.
 */
import { useTranslations } from "next-intl";
import { Card, DataTable, EmptyState } from "../../_components/ds";
import type { InfrastructureRow, GeofenceRow, JurisdictionRow } from "./_data";

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
            { key: "name", label: t("colName") },
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

export function GeofencesTable({ rows }: { rows: GeofenceRow[] }) {
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
            { key: "status", label: t("colStatus"), cellType: "status" },
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
            { key: "office", label: t("colOffice") },
            { key: "unit", label: t("colUnit") },
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
