import { PageHeader, Card, DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import Link from "next/link";

type RawRow = {
  id: string;
  registrationNo: string;
  make?: string;
  model?: string;
  year?: number;
  fuelType?: string;
  status?: string;
  assignedDriverId?: string | null;
  odometerKm?: number | null;
} & Record<string, unknown>;

export type VehicleRow = {
  id: string;
  registrationNo: string;
  makeModel: string;
  year: string;
  fuelType: string;
  statusLabel: string;
  driver: string;
};

const STATUS_LABELS: Record<string, string> = {
  active:         "Active",
  in_maintenance: "In Maintenance",
  decommissioned: "Decommissioned",
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function mapVehicles(payload: unknown): VehicleRow[] | null {
  const rows = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : null;
  if (!rows) return null;

  return rows.flatMap((raw) => {
    if (!isRecord(raw)) return [];
    const row = raw as RawRow;
    if (typeof row.id !== "string" || typeof row.registrationNo !== "string") return [];
    return [{
      id: row.id,
      registrationNo: row.registrationNo,
      makeModel: [row.make, row.model].filter(Boolean).join(" ") || "—",
      year: row.year != null ? String(row.year) : "—",
      fuelType: String(row.fuelType ?? "—"),
      statusLabel: STATUS_LABELS[String(row.status ?? "active")] ?? String(row.status ?? "active"),
      driver: row.assignedDriverId ? "Assigned" : "Unassigned",
    }];
  });
}

async function getVehicles(): Promise<LoaderResult<VehicleRow[]>> {
  return fetchJson<unknown, VehicleRow[]>("/api/v1/assets/fleet/vehicles", [], {
    telemetryKey: "fleet.vehicles",
    mapResponse: mapVehicles,
  });
}

const columns: { key: keyof VehicleRow; label: string; cellType?: "status" }[] = [
  { key: "registrationNo", label: "Registration No." },
  { key: "makeModel",      label: "Make / Model" },
  { key: "year",           label: "Year" },
  { key: "fuelType",       label: "Fuel" },
  { key: "statusLabel",    label: "Status", cellType: "status" },
  { key: "driver",         label: "Driver" },
];

export default async function FleetVehiclesPage() {
  const { data: vehicles, source } = await getVehicles();

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Fleet Vehicles"
        subtitle="Government vehicles registered to the fleet."
        back="/fleet"
        backLabel="Fleet Management"
        actions={
          <>
            {source === "error" && <DataSourceBadge source="error" />}
            <Link href="/assets/fleet/vehicles" className="btn secondary">
              Register Vehicle
            </Link>
          </>
        }
      />

      <Card title={`Vehicles (${vehicles.length})`}>
        <DataTable<VehicleRow>
          columns={columns}
          rows={vehicles}
          sortable
          filterable
          filterPlaceholder="Filter by registration, make, model…"
          pageSize={20}
          emptyIcon="🚚"
          emptyTitle="No vehicles registered yet"
          emptyMessage="Register your first government vehicle in the Assets module."
        />
      </Card>
    </main>
  );
}
