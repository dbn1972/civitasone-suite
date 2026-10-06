import { PageHeader, Card, DataTable, RefreshErrorState } from "@/app/_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { humanizeStatus } from "@/lib/formatters";
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
  year: number | null;
  fuelType: string;
  status: string;
  statusLabel: string;
  odometer: string;
  driver: string;
};

const STATUS_LABELS: Record<string, string> = {
  active:         "Active",
  in_maintenance: "In Maintenance",
  decommissioned: "Decommissioned",
};

// GAP-FLEET-VEHICLES-04: fuel type is a lower-case enum on the wire ("diesel",
// "cng"). humanizeStatus turns it into a display label ("Diesel", "CNG" via its
// acronym table), instead of printing the raw enum.
const FUEL_LABELS: Record<string, string> = {
  petrol: "Petrol",
  diesel: "Diesel",
  electric: "Electric",
  cng: "CNG",
};
function fuelLabel(raw: string | null | undefined): string {
  if (!raw) return "—";
  return FUEL_LABELS[raw.toLowerCase()] ?? humanizeStatus(raw);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export function mapVehicles(payload: unknown): VehicleRow[] | null {
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
    // GAP-FLEET-VEHICLES-02: do NOT default a missing status to "active". A
    // null/omitted status is unknown, not serviceable -- defaulting it to
    // "active" could show a decommissioned vehicle (whose status the API
    // omitted) as roadworthy. Show "Unknown" with a neutral pill instead.
    const rawStatus = typeof row.status === "string" && row.status.trim() ? row.status : "unknown";
    const statusLabel = STATUS_LABELS[rawStatus] ?? humanizeStatus(rawStatus);
    // GAP-FLEET-VEHICLES-03: odometer is fetched but was never shown; surface
    // it with en-IN grouping. The vehicles API returns no driver NAME and this
    // page has no roster lookup, so an assigned vehicle shows a short id tag
    // rather than inventing a name (keeps the log honest about who is resolvable).
    const odometer =
      typeof row.odometerKm === "number" && Number.isFinite(row.odometerKm)
        ? `${row.odometerKm.toLocaleString("en-IN")} km`
        : "—";
    const driver = row.assignedDriverId
      ? `Assigned (${String(row.assignedDriverId).slice(0, 8)})`
      : "Unassigned";
    return [{
      id: row.id,
      registrationNo: row.registrationNo,
      makeModel: [row.make, row.model].filter(Boolean).join(" ") || "—",
      // GAP-FLEET-VEHICLES-05: keep year as a number so the column sorts
      // numerically (align right), not as a string.
      year: typeof row.year === "number" && Number.isFinite(row.year) ? row.year : null,
      fuelType: fuelLabel(row.fuelType),
      status: rawStatus,
      statusLabel,
      odometer,
      driver,
    }];
  });
}

async function getVehicles(): Promise<LoaderResult<VehicleRow[]>> {
  return fetchJson<unknown, VehicleRow[]>("/api/v1/assets/fleet/vehicles", [], {
    telemetryKey: "fleet.vehicles",
    mapResponse: mapVehicles,
  });
}

const columns: {
  key: keyof VehicleRow;
  label: string;
  cellType?: "status";
  align?: "right";
  statusLabels?: Record<string, string>;
  hideOnMobile?: boolean;
}[] = [
  { key: "registrationNo", label: "Registration No." },
  { key: "makeModel",      label: "Make / Model" },
  { key: "year",           label: "Year", align: "right", hideOnMobile: true },
  { key: "fuelType",       label: "Fuel", hideOnMobile: true },
  { key: "odometer",       label: "Odometer", align: "right", hideOnMobile: true },
  // Pass the raw status to StatusPill (cellType "status") with an explicit
  // label map, so "in_maintenance" -> warn, "decommissioned" -> mut and the
  // unknown fallback stays neutral (GAP-FLEET-VEHICLES-02).
  { key: "status",         label: "Status", cellType: "status", statusLabels: STATUS_LABELS },
  { key: "driver",         label: "Driver", hideOnMobile: true },
];

export default async function FleetVehiclesPage() {
  const { data: vehicles, source, status } = await getVehicles();

  // GAP-FLEET-VEHICLES-01: on a failed load the page used to show
  // "Vehicles (0)" and the "No vehicles registered yet — register your first"
  // empty-state copy, which reads as a confident "the fleet is empty" when the
  // fetch actually failed. Fail honestly with a retryable error state; show the
  // count and the empty-state CTA only on a successful load.
  if (source === "error") {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader
          title="Fleet Vehicles"
          subtitle="Government vehicles registered to the fleet."
          back="/fleet"
          backLabel="Fleet Management"
        />
        <RefreshErrorState
          error={{
            what: "Could not load the vehicle list",
            next: "The fleet service may be temporarily unavailable. Try again in a moment.",
            actions: ["retry", "back"],
          }}
          backHref="/fleet"
          source={{ status, area: "fleet" }}
        />
      </div>
    );
  }

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Fleet Vehicles"
        subtitle="Government vehicles registered to the fleet."
        back="/fleet"
        backLabel="Fleet Management"
        actions={
          // GAP-FLEET-VEHICLES-04: this is the primary action for the screen and
          // registration lives in the Assets module -- label it honestly so the
          // cross-module jump is not a surprise, and style it as the primary CTA.
          <Link href="/assets/fleet/vehicles" className="btn primary">
            Register in Assets
          </Link>
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
    </div>
  );
}
