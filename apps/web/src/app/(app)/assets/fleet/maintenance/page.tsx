import { PageHeader, Card, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { ScheduleMaintenanceForm } from "./ScheduleMaintenanceForm";

/**
 * GET /v1/assets/fleet/maintenance (asset-service, port 3015, gateway prefix
 * /api/v1/assets). Field names are inferred from the schedule payload
 * (vehicleId, type, scheduledDate, odometerThresholdKm) — the route as read
 * from services/asset-service/src/modules/fleet/routes.ts currently always
 * returns `{ data: [] }` (no DB-backed list yet); see BACKEND FOLLOW-UPS.
 */
type RawRow = {
  id: string;
  vehicleId: string;
  type: string;
  scheduledDate: string;
  odometerThresholdKm?: number;
  status?: string;
} & Record<string, unknown>;

export type MaintenanceRow = {
  id: string;
  vehicleId: string;
  typeLabel: string;
  scheduledDate: string;
  odometerThresholdKm: string;
  statusLabel: string;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function mapMaintenance(payload: unknown): MaintenanceRow[] | null {
  const rows = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray((payload as { data?: unknown }).data)
      ? ((payload as { data: unknown[] }).data)
      : null;
  if (!rows) return null;

  const mapped: MaintenanceRow[] = [];
  for (const raw of rows) {
    if (!isRecord(raw)) continue;
    const row = raw as RawRow;
    if (typeof row.id !== "string" || typeof row.vehicleId !== "string") continue;
    mapped.push({
      id: row.id,
      vehicleId: row.vehicleId,
      typeLabel: String(row.type ?? "").replace(/_/g, " "),
      scheduledDate: String(row.scheduledDate ?? ""),
      odometerThresholdKm:
        typeof row.odometerThresholdKm === "number" ? `${row.odometerThresholdKm.toLocaleString("en-IN")} km` : "—",
      statusLabel: String(row.status ?? "scheduled"),
    });
  }
  return mapped;
}

async function getMaintenance(): Promise<LoaderResult<MaintenanceRow[]>> {
  return fetchJson<unknown, MaintenanceRow[]>("/api/v1/assets/fleet/maintenance", [], {
    telemetryKey: "assets.fleet.maintenance",
    mapResponse: mapMaintenance,
  });
}

export default async function FleetMaintenancePage() {
  const { data: jobs, source } = await getMaintenance();

  const columns: { key: keyof MaintenanceRow; label: string; cellType?: "status" }[] = [
    { key: "vehicleId", label: "Vehicle ID" },
    { key: "typeLabel", label: "Type" },
    { key: "scheduledDate", label: "Scheduled Date" },
    { key: "odometerThresholdKm", label: "Odometer Threshold" },
    { key: "statusLabel", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Fleet Maintenance"
        subtitle="Preventive maintenance scheduling for government vehicles."
        back="/assets/fleet"
        backLabel="Fleet & Telematics"
        actions={source === "error" ? <DataSourceBadge source="error" /> : null}
      />

      <ScheduleMaintenanceForm />

      <Card title="Scheduled Maintenance">
        <DataTable<MaintenanceRow>
          columns={columns}
          rows={jobs}
          sortable
          filterable
          filterPlaceholder="Filter by vehicle ID, type…"
          pageSize={15}
          emptyIcon="🛠️"
          emptyTitle="No maintenance scheduled yet"
          emptyMessage="Schedule your first maintenance job using the form above."
        />
      </Card>
    </main>
  );
}
