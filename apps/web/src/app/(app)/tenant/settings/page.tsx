import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getTenantSettings } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getTenantSettings();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/tenant">Tenant</a>
      </nav>
      <ModuleListPage
        title="Tenant — Settings"
        description="Tenant-scoped configuration keys and values."
        rows={data}
        source={source}
      />
    </main>
  );
}
