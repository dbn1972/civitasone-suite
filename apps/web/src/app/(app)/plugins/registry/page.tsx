import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getPluginRegistry } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getPluginRegistry();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/plugins">Plugins</a>
      </nav>
      <ModuleListPage
        title="Plugins — Registry"
        description="Installed plugin registry."
        rows={data}
        source={source}
      />
    </main>
  );
}
