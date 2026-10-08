import { PageHeader } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getLocationGeofencesTyped } from "../_data";
import { GeofencesTable } from "../_tables";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getLocationGeofencesTyped();
  return (
    <div className="page-main">
      <PageHeader
        title="Locations — Geofences"
        subtitle="Geofence definitions from location-service."
        back="/locations"
        backLabel="Locations"
      />
      <DataSourceBadge source={source === "error" ? "error" : "api"} />
      <GeofencesTable rows={data} />
    </div>
  );
}
