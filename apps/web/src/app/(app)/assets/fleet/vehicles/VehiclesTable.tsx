"use client";

import { DataTable } from "../../../../_components/ds";
import type { VehicleRow } from "../_data/vehicles";

type VehicleTableRow = VehicleRow & { action: string };

/**
 * Client table so the per-row "Record GPS" link (a render function) never
 * crosses the Server->Client boundary (DataTable is a Client Component).
 * GAP-ASSETS-FLEET-VEHICLES-01: the action preselects the vehicle in the GPS form.
 */
export function VehiclesTable({ vehicles }: { vehicles: VehicleRow[] }) {
  const rows: VehicleTableRow[] = vehicles.map((v) => ({ ...v, action: "Record GPS" }));
  return (
    <DataTable<VehicleTableRow>
      columns={[
        { key: "registrationNo", label: "Registration No." },
        { key: "make", label: "Make" },
        { key: "model", label: "Model" },
        { key: "year", label: "Year" },
        { key: "fuelType", label: "Fuel Type" },
        { key: "statusLabel", label: "Status", cellType: "status" },
        {
          key: "action",
          label: "Actions",
          render: (r) => (
            <a className="lnk" href={`/assets/fleet/vehicles?vehicleId=${encodeURIComponent(r.id)}#record-gps`} aria-label={`Record GPS for ${r.registrationNo}`}>
              Record GPS
            </a>
          ),
        },
      ]}
      rows={rows}
      sortable
      filterable
      filterPlaceholder="Filter by registration, make, model…"
      pageSize={15}
      emptyIcon="🚚"
      emptyTitle="No vehicles registered yet"
      emptyMessage="Register your first government vehicle using the form above."
    />
  );
}
