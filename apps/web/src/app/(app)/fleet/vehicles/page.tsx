import { PageHeader, Card, DataTable, RefreshErrorState } from "@/app/_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import Link from "next/link";

import { mapVehicles, STATUS_LABELS, type VehicleRow } from "./mapVehicles";

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
