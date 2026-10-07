import { PageHeader, Card, RefreshErrorState } from "../../../../_components/ds";
import { toHumanError } from "@/lib/messages";
import { getVehicles, type VehicleRow } from "../_data/vehicles";
import { vehicleOptions } from "../_data/labels";
import { RegisterVehicleForm } from "./RegisterVehicleForm";
import { RecordGpsForm } from "./RecordGpsForm";
import { VehiclesTable } from "./VehiclesTable";

export type { VehicleRow };

export default async function FleetVehiclesPage({ searchParams }: { searchParams?: { vehicleId?: string } }) {
  const { data: vehicles, source } = await getVehicles();

  return (
    <div className="page-main wrap">
      <PageHeader
        title="Fleet Vehicles"
        subtitle="Government vehicles registered to the fleet."
        back="/assets/fleet"
        backLabel="Fleet & Telematics"
      />

      <RegisterVehicleForm />

      <Card title="Vehicles">
        {/* GAP-ASSETS-FLEET-VEHICLES-03: a failed load is an error, never "No vehicles registered yet". */}
        {source === "error" ? (
          <RefreshErrorState error={toHumanError("load", { area: "fleet vehicles" })} />
        ) : (
          <VehiclesTable vehicles={vehicles} />
        )}
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
