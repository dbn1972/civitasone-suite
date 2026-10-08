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
import { Card, DataTable, EmptyState } from "../../_components/ds";
import type { InfrastructureRow, GeofenceRow, JurisdictionRow } from "./_data";

type InfraRow = InfrastructureRow & Record<string, unknown>;
type GeoRow = GeofenceRow & Record<string, unknown>;
type JurisRow = JurisdictionRow & Record<string, unknown>;

export function InfrastructureTable({ rows }: { rows: InfrastructureRow[] }) {
  return (
    <Card title="Infrastructure assets">
      {rows.length === 0 ? (
        <EmptyState icon="🏗️" title="No assets" message="No infrastructure assets to show yet." />
      ) : (
        <DataTable<InfraRow>
          columns={[
            { key: "name", label: "Name" },
            { key: "type", label: "Type" },
            { key: "condition", label: "Condition", align: "right" },
            { key: "status", label: "Status", cellType: "status" },
          ]}
          rows={rows as InfraRow[]}
          sortable
          filterable
          filterPlaceholder="Filter assets…"
          pageSize={15}
        />
      )}
    </Card>
  );
}

export function GeofencesTable({ rows }: { rows: GeofenceRow[] }) {
  return (
    <Card title="Geofences">
      {rows.length === 0 ? (
        <EmptyState icon="🗺️" title="No geofences" message="No geofence definitions to show yet." />
      ) : (
        <DataTable<GeoRow>
          columns={[
            { key: "name", label: "Name" },
            { key: "type", label: "Type" },
            { key: "shape", label: "Shape" },
            { key: "radius", label: "Radius", align: "right" },
            { key: "status", label: "Status", cellType: "status" },
          ]}
          rows={rows as GeoRow[]}
          sortable
          filterable
          filterPlaceholder="Filter geofences…"
          pageSize={15}
        />
      )}
    </Card>
  );
}

export function JurisdictionsTable({ rows }: { rows: JurisdictionRow[] }) {
  return (
    <Card title="Jurisdictions">
      {rows.length === 0 ? (
        <EmptyState icon="🏛️" title="No jurisdictions" message="No jurisdiction records to show yet." />
      ) : (
        <DataTable<JurisRow>
          columns={[
            { key: "level", label: "Level" },
            { key: "office", label: "Office" },
            { key: "unit", label: "Unit" },
          ]}
          rows={rows as JurisRow[]}
          sortable
          filterable
          filterPlaceholder="Filter jurisdictions…"
          pageSize={15}
        />
      )}
    </Card>
  );
}
