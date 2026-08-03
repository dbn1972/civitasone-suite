import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getInstallModules } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getInstallModules();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/install/console">Install console</a>
      </nav>
      <ModuleListPage
        title="Install — Modules"
        description="Module resolution catalogue."
        rows={data}
        source={source}
      />
    </main>
  );
}
