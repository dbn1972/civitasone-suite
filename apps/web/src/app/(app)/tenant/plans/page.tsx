import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getTenantPlans } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getTenantPlans();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/tenant">Tenant</a>
      </nav>
      <ModuleListPage
        title="Tenant — Plans"
        description="Available plans with pricing and module entitlements."
        rows={data}
        source={source}
      />
    </main>
  );
}
