import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getTenantStewardship } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getTenantStewardship();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/tenant">Tenant</a>
      </nav>
      <ModuleListPage
        title="Tenant — Stewardship"
        description="Data governance domains and assigned stewards."
        rows={data}
        source={source}
      />
    </main>
  );
}
