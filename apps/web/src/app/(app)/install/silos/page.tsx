import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getInstallSilos } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getInstallSilos();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/install/console">Install console</a>
      </nav>
      <ModuleListPage
        title="Install — Silo provisions"
        description="Silo provision records."
        rows={data}
        source={source}
      />
    </main>
  );
}
