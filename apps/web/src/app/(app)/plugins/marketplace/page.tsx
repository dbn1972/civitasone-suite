import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getPluginMarketplace } from "../_data";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getPluginMarketplace();
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/plugins">Plugins</a>
      </nav>
      <ModuleListPage
        title="Plugins — Marketplace"
        description="Marketplace listings from plugin-service."
        rows={data}
        source={source}
      />
    </div>
  );
}
