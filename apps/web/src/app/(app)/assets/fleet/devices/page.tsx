import { PageHeader, Card, DataTable, RefreshErrorState } from "../../../../_components/ds";
import { toHumanError } from "@/lib/messages";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { RegisterDeviceForm } from "./RegisterDeviceForm";
import { TelemetryForm } from "./TelemetryForm";
import { getVehicles } from "../_data/vehicles";
import { vehicleLabel } from "../_data/labels";

/**
 * GET /v1/assets/fleet/devices (asset-service, port 3015, gateway prefix
 * /api/v1/assets). Field names are inferred from the register payload
 * (vehicleId, deviceImei, protocol, simIccid, status) and match the
 * DB-backed list the asset-service fleet-devices route returns
 * (GAP-ASSETS-FLEET-DEVICES-07: verified against listDevicesByTenant; the
 * service stores no last-seen/offline status, so none is shown).
 */
type RawRow = {
  id: string;
  vehicleId: string;
  deviceImei: string;
  protocol: string;
  simIccid?: string;
  status?: string;
} & Record<string, unknown>;

export type DeviceRow = {
  id: string;
  vehicleId: string;
  deviceImei: string;
  protocol: string;
  simIccid: string;
  statusLabel: string;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function mapDevices(payload: unknown): DeviceRow[] | null {
  const rows = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray((payload as { data?: unknown }).data)
      ? ((payload as { data: unknown[] }).data)
      : null;
  if (!rows) return null;

  const mapped: DeviceRow[] = [];
  for (const raw of rows) {
    if (!isRecord(raw)) continue;
    const row = raw as RawRow;
    if (typeof row.id !== "string" || typeof row.deviceImei !== "string") continue;
    mapped.push({
      id: row.id,
      vehicleId: String(row.vehicleId ?? ""),
      deviceImei: row.deviceImei,
      protocol: String(row.protocol ?? ""),
      simIccid: row.simIccid ? String(row.simIccid) : "—",
      statusLabel: String(row.status ?? "registered"),
    });
  }
  return mapped;
}

async function getDevices(): Promise<LoaderResult<DeviceRow[]>> {
  return fetchJson<unknown, DeviceRow[]>("/api/v1/assets/fleet/devices", [], {
    telemetryKey: "assets.fleet.devices",
    mapResponse: mapDevices,
  });
}

type DeviceTableRow = DeviceRow & { vehicle: string };

export default async function FleetDevicesPage() {
  const [{ data: devices, source }, { data: vehicles }] = await Promise.all([getDevices(), getVehicles()]);

  // GAP-ASSETS-FLEET-DEVICES-01: devices are chosen as "IMEI — vehicle", and
  // the table names the vehicle by registration, not by UUID.
  const byId = new Map(vehicles.map((v) => [v.id, vehicleLabel(v)]));
  const rows: DeviceTableRow[] = devices.map((d) => ({ ...d, vehicle: byId.get(d.vehicleId) ?? "Unknown vehicle" }));
  const deviceOptions = rows.map((d) => ({ id: d.id, label: `${d.deviceImei} — ${d.vehicle}` }));

  const columns: { key: keyof DeviceTableRow; label: string; cellType?: "status" }[] = [
    { key: "deviceImei", label: "Device IMEI" },
    { key: "vehicle", label: "Vehicle" },
    { key: "protocol", label: "Protocol" },
    { key: "simIccid", label: "SIM ICCID" },
    { key: "statusLabel", label: "Status", cellType: "status" },
  ];

  return (
    <div className="page-main wrap">
      <PageHeader
        title="Fleet IoT Devices"
        subtitle="Telematics devices mounted on government vehicles."
        back="/assets/fleet"
        backLabel="Fleet & Telematics"
      />

      <RegisterDeviceForm />

      <Card title="Devices">
        {/* GAP-ASSETS-FLEET-DEVICES-04: a failed load is an error, not "No devices registered yet". */}
        {source === "error" ? (
          <RefreshErrorState error={toHumanError("load", { area: "fleet devices" })} />
        ) : (
          <DataTable<DeviceTableRow>
            columns={columns}
            rows={rows}
            sortable
            filterable
            filterPlaceholder="Filter by IMEI, vehicle, protocol…"
            pageSize={15}
            emptyIcon="📡"
            emptyTitle="No devices registered yet"
            emptyMessage="Register your first telematics device using the form above."
          />
        )}
      </Card>

      <TelemetryForm options={deviceOptions} devicesError={source === "error"} />
    </div>
  );
}
