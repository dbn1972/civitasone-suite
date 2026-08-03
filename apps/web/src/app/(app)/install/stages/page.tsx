import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getInstallStages } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getInstallStages();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/install/console">Install console</a>
      </nav>
      <ModuleListPage
        title="Install — Stages"
        description="Installer stages from install-service."
        rows={data}
        source={source}
      />
    </main>
  );
}
