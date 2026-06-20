import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getLocations } from "../../../_data/loaders";

export default async function Page() {
  const { data, source } = await getLocations();
  return (
    <ModuleListPage
      title="Locations — Locations"
      description="Read-only list loaded from the Locations service API."
      rows={data}
      source={source}
    />
  );
}
