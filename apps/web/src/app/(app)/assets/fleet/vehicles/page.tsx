import { PageHeader, Card, DataTable } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { RegisterVehicleForm } from "./RegisterVehicleForm";
import { RecordGpsForm } from "./RecordGpsForm";

/**
 * GET /v1/assets/fleet/vehicles (asset-service, port 3015, gateway prefix
 * /api/v1/assets). Field names are inferred from the register payload
 * (registrationNo, make, model, year, fuelType) — the route as read from
 * services/asset-service/src/modules/fleet/routes.ts currently always
 * returns `{ data: [] }` (no DB-backed list yet); see BACKEND FOLLOW-UPS.
 */
type RawRow = {
  id: string;
  registrationNo: string;
  make: string;
  model: string;
  year: number;
  fuelType: string;
  status?: string;
} & Record<string, unknown>;

export type VehicleRow = {
  id: string;
  registrationNo: string;
  make: string;
  model: string;
  year: number;
  fuelType: string;
  statusLabel: string;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function mapVehicles(payload: unknown): VehicleRow[] | null {
  const rows = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray((payload as { data?: unknown }).data)
      ? ((payload as { data: unknown[] }).data)
      : null;
  if (!rows) return null;

  const mapped: VehicleRow[] = [];
  for (const raw of rows) {
    if (!isRecord(raw)) continue;
    const row = raw as RawRow;
    if (typeof row.id !== "string" || typeof row.registrationNo !== "string") continue;
    mapped.push({
      id: row.id,
      registrationNo: row.registrationNo,
      make: String(row.make ?? ""),
      model: String(row.model ?? ""),
      year: typeof row.year === "number" ? row.year : Number(row.year ?? 0),
      fuelType: String(row.fuelType ?? ""),
      statusLabel: String(row.status ?? "active"),
    });
  }
  return mapped;
}

async function getVehicles(): Promise<LoaderResult<VehicleRow[]>> {
  return fetchJson<unknown, VehicleRow[]>("/api/v1/assets/fleet/vehicles", [], {
    telemetryKey: "assets.fleet.vehicles",
    mapResponse: mapVehicles,
  });
}

export default async function FleetVehiclesPage() {
  const { data: vehicles, source } = await getVehicles();

  const columns: { key: keyof VehicleRow; label: string; cellType?: "status" }[] = [
    { key: "registrationNo", label: "Registration No." },
    { key: "make", label: "Make" },
    { key: "model", label: "Model" },
    { key: "year", label: "Year" },
    { key: "fuelType", label: "Fuel Type" },
    { key: "statusLabel", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Fleet Vehicles"
        subtitle="Government vehicles registered to the fleet."
        back="/assets/fleet"
        backLabel="Fleet & Telematics"
        actions={source === "error" ? <DataSourceBadge source="error" /> : null}
      />

      <RegisterVehicleForm />

      <Card title="Vehicles">
        <DataTable<VehicleRow>
          columns={columns}
          rows={vehicles}
          sortable
          filterable
          filterPlaceholder="Filter by registration, make, model…"
          pageSize={15}
          emptyIcon="🚚"
          emptyTitle="No vehicles registered yet"
          emptyMessage="Register your first government vehicle using the form above."
        />
      </Card>

      <RecordGpsForm />
    </main>
  );
}
