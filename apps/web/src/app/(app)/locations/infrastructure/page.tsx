import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getLocationInfrastructure } from "../_data";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getLocationInfrastructure();
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/locations">Locations</a>
      </nav>
      <ModuleListPage
        title="Locations — Infrastructure"
        description="Infrastructure assets from location-service."
        rows={data}
        source={source}
      />
    </div>
  );
}
