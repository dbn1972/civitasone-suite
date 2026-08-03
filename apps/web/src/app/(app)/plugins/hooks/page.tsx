import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getPluginHooks } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getPluginHooks();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/plugins">Plugins</a>
      </nav>
      <ModuleListPage
        title="Plugins — Hooks"
        description="Registered plugin hooks."
        rows={data}
        source={source}
      />
    </main>
  );
}
