import { PageHeader, Card, RefreshErrorState } from "../../../../_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { ScheduleMaintenanceForm } from "./ScheduleMaintenanceForm";
import { MaintenanceTable, type MaintenanceTableRow } from "./MaintenanceTable";
import { getVehicles } from "../_data/vehicles";
import { vehicleLabel, vehicleOptions } from "../_data/labels";
import { formatIndianDate } from "@/lib/formatters";
import { displayStatus } from "../_data/maintenanceStatus";
import { toHumanError } from "@/lib/messages";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { canWriteFleet } from "@/lib/auth/workRoles";

/**
 * GET /v1/assets/fleet/maintenance (asset-service, port 3015, gateway prefix
 * /api/v1/assets). Field names are inferred from the schedule payload
 * (vehicleId, type, scheduledDate, odometerThresholdKm, status) and match the
 * DB-backed list in the asset-service fleet routes module (GAP-ASSETS-FLEET-MAINTENANCE-07:
 * verified -- scheduledDate is a bare calendar date; only the date drives
 * "overdue", the odometer threshold is stored but not evaluated).
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
  scheduledLabel: string;
  odometerThresholdKm: string;
  /** Raw service status (scheduled | completed | cancelled). */
  status: string;
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
      // GAP-ASSETS-FLEET-MAINTENANCE-04: dd Mon yyyy (IST-safe), "—" when absent.
      scheduledLabel: formatIndianDate(row.scheduledDate ? String(row.scheduledDate) : null),
      odometerThresholdKm:
        typeof row.odometerThresholdKm === "number" ? `${row.odometerThresholdKm.toLocaleString("en-IN")} km` : "—",
      status: String(row.status ?? "scheduled"),
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
  const [{ data: jobs, source }, { data: vehicles, source: vehiclesSource }] = await Promise.all([getMaintenance(), getVehicles()]);

  // GAP-ASSETS-FLEET-MAINTENANCE-02: show the registration number, never the raw UUID.
  const byId = new Map(vehicles.map((v) => [v.id, vehicleLabel(v)]));
  const rows: MaintenanceTableRow[] = jobs.map((j) => {
    const statusLabel = displayStatus(j.status, j.scheduledDate);
    return {
      id: j.id,
      vehicle: byId.get(j.vehicleId) ?? "Unknown vehicle",
      typeLabel: j.typeLabel,
      scheduledLabel: j.scheduledLabel,
      odometerThresholdKm: j.odometerThresholdKm,
      statusLabel,
      open: statusLabel === "scheduled" || statusLabel === "overdue",
    };
  });

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Fleet Maintenance"
        subtitle="Preventive maintenance scheduling for government vehicles."
        back="/assets/fleet"
        backLabel="Fleet & Telematics"
      />

      <ScheduleMaintenanceForm options={vehicleOptions(vehicles)} vehiclesError={vehiclesSource === "error"} />

      <Card title="Scheduled Maintenance">
        {/* GAP-ASSETS-FLEET-MAINTENANCE-03: a failed load is an error, never "No maintenance scheduled yet". */}
        {source === "error" ? (
          <RefreshErrorState error={toHumanError("load", { area: "maintenance schedule" })} />
        ) : (
          <MaintenanceTable rows={rows} canAct={canWriteFleet(getSessionRoles())} />
        )}
      </Card>
    </div>
  );
}
