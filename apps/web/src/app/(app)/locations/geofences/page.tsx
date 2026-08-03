import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getLocationGeofences } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getLocationGeofences();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/locations">Locations</a>
      </nav>
      <ModuleListPage
        title="Locations — Geofences"
        description="Geofence definitions from location-service."
        rows={data}
        source={source}
      />
    </main>
  );
}
