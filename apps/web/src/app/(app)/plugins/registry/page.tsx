import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getPluginRegistry } from "../_data";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getPluginRegistry();
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/plugins">Plugins</a>
      </nav>
      <ModuleListPage
        title="Plugins — Registry"
        description="Installed plugin registry."
        rows={data}
        source={source}
      />
    </div>
  );
}
