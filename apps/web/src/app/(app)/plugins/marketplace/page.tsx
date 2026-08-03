import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getPluginMarketplace } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getPluginMarketplace();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/plugins">Plugins</a>
      </nav>
      <ModuleListPage
        title="Plugins — Marketplace"
        description="Marketplace listings from plugin-service."
        rows={data}
        source={source}
      />
    </main>
  );
}
