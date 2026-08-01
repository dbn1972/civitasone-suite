import { PageHeader, Card, DataTable } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { RegisterDeviceForm } from "./RegisterDeviceForm";
import { TelemetryForm } from "./TelemetryForm";

/**
 * GET /v1/assets/fleet/devices (asset-service, port 3015, gateway prefix
 * /api/v1/assets). Field names are inferred from the register payload
 * (vehicleId, deviceImei, protocol, simIccid) — the route as read from
 * services/asset-service/src/modules/fleet-devices/routes.ts currently
 * always returns `{ data: [], meta: { total: 0 } }` (no DB-backed list yet);
 * see BACKEND FOLLOW-UPS.
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

export default async function FleetDevicesPage() {
  const { data: devices, source } = await getDevices();

  const columns: { key: keyof DeviceRow; label: string; cellType?: "status" }[] = [
    { key: "deviceImei", label: "Device IMEI" },
    { key: "vehicleId", label: "Vehicle ID" },
    { key: "protocol", label: "Protocol" },
    { key: "simIccid", label: "SIM ICCID" },
    { key: "statusLabel", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Fleet IoT Devices"
        subtitle="Telematics devices mounted on government vehicles."
        back="/assets/fleet"
        backLabel="Fleet & Telematics"
        actions={source === "error" ? <DataSourceBadge source="error" /> : null}
      />

      <RegisterDeviceForm />

      <Card title="Devices">
        <DataTable<DeviceRow>
          columns={columns}
          rows={devices}
          sortable
          filterable
          filterPlaceholder="Filter by IMEI, vehicle ID, protocol…"
          pageSize={15}
          emptyIcon="📡"
          emptyTitle="No devices registered yet"
          emptyMessage="Register your first telematics device using the form above."
        />
      </Card>

      <TelemetryForm />
    </main>
  );
}
