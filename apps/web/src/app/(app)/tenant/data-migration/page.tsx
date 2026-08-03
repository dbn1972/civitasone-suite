import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getTenantDataMigration } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getTenantDataMigration();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/tenant">Tenant</a>
      </nav>
      <ModuleListPage
        title="Tenant — Data Migration"
        description="Organisation data migrations and reconciliation jobs."
        rows={data}
        source={source}
      />
    </main>
  );
}
