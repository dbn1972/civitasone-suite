import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getTenantQuotas } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getTenantQuotas();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/tenant">Tenant</a>
      </nav>
      <ModuleListPage
        title="Tenant — Quotas & Usage"
        description="Resource consumption and plan limits for this tenant."
        rows={data}
        source={source}
      />
    </main>
  );
}
