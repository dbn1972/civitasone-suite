import { PageHeader, Card } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { getVehicles, type VehicleRow } from "../_data/vehicles";
import { vehicleOptions } from "../_data/labels";
import { RegisterVehicleForm } from "./RegisterVehicleForm";
import { RecordGpsForm } from "./RecordGpsForm";
import { VehiclesTable } from "./VehiclesTable";

export type { VehicleRow };

export default async function FleetVehiclesPage({ searchParams }: { searchParams?: { vehicleId?: string } }) {
  const { data: vehicles, source } = await getVehicles();

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Fleet Vehicles"
        subtitle="Government vehicles registered to the fleet."
        back="/assets/fleet"
        backLabel="Fleet & Telematics"
        actions={source === "error" ? <DataSourceBadge source="error" /> : null}
      />

      <RegisterVehicleForm />

      <Card title="Vehicles">
        <VehiclesTable vehicles={vehicles} />
      </Card>

      <RecordGpsForm
        key={searchParams?.vehicleId ?? ""}
        options={vehicleOptions(vehicles)}
        vehiclesError={source === "error"}
        initialVehicleId={searchParams?.vehicleId ?? ""}
      />
    </div>
  );
}
